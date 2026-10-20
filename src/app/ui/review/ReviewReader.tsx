import type { EditorBook } from "@sefer/editor";
import type { BookId } from "@sefer/text/book";
import type { JSX } from "@solidjs/web";
import { Effect } from "effect";
import ArrowDown from "lucide-solid/icons/arrow-down";
import ArrowUp from "lucide-solid/icons/arrow-up";
import BookIcon from "lucide-solid/icons/book";
import BookOpen from "lucide-solid/icons/book-open";
import CheckIcon from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Columns2 from "lucide-solid/icons/columns-2";
import MoreVertical from "lucide-solid/icons/more-vertical";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";

import type { Analysis, DecisionUnit, DiffSkeleton, MergeSide } from "#core/galley";

import { registerCommand } from "../../commands";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import {
  BookDiff,
  DiffCard,
  changed,
  estimate,
  hunksOf,
  isFormatting,
  type BookDiffApi,
  type Controls,
  type DiffSides,
  type Hunk,
} from "../diff";
import type { CardAction } from "../multibuffer/CardAction";
import { CardList } from "../multibuffer/CardList";
import type { ContextStep } from "../multibuffer/cardState";
import { createCardViews } from "../multibuffer/cardViews";
import {
  Button,
  EmptyState,
  IconButton,
  Menu,
  MenuCheckbox,
  MenuItem,
  MenuLabel,
  MenuRadio,
  MenuSeparator,
  SegmentedControl,
  type VirtualSection,
} from "../primitives";
import { ChangesHistorySidebar } from "../workspace/ChangesHistorySidebar";
import { Crumbs, LocationStrip, type CrumbChapter } from "../workspace/Crumbs";
import { FollowToggle } from "../workspace/FollowToggle";
import { claimSidebar } from "../workspace/sidebarSlot";

export interface ReviewBook {
  readonly bookId: BookId;
  readonly name: string;
  readonly currentText: string;
  readonly baselineText: string;
  readonly skeleton: DiffSkeleton;
  readonly hidden?: ReadonlySet<string>;
}

type Layout = "auto" | "split" | "unified";
type Scope = "changes" | "book";
type Filter = "all" | "words" | "formatting";

const AUTO_SPLIT_PX = 960;

const FILTERS: Record<Filter, (unit: DecisionUnit) => boolean> = {
  all: () => true,
  words: (unit) => !isFormatting(unit),
  formatting: isFormatting,
};

interface Prepared {
  readonly book: ReviewBook;
  readonly sides: DiffSides;
  readonly units: readonly DecisionUnit[];
  readonly shown: readonly DecisionUnit[];
  readonly hunks: readonly Hunk[];
}

export function ReviewReader(props: {
  readonly books: readonly ReviewBook[];
  readonly decision: (bookId: BookId, unitId: string) => MergeSide | undefined;
  readonly decide: (
    bookId: BookId,
    units: readonly DecisionUnit[],
    side: MergeSide | undefined,
  ) => void;
  readonly decidable: boolean;
  readonly usfm: boolean;
  readonly onUsfm: (on: boolean) => void;
  readonly originOf?: (
    bookId: BookId,
    units: readonly DecisionUnit[],
  ) => "there" | "here" | "both" | undefined;
  readonly currentLabel: string | ((bookId: BookId) => string);
  readonly baselineLabel: string | ((bookId: BookId) => string);
  readonly currentShort: string;
  readonly baselineShort: string;
  readonly selected: BookId | undefined;
  readonly onSelect: (bookId: BookId) => void;
  readonly seat: (bookId: BookId) => Promise<EditorBook | undefined>;
  readonly onEdited: (bookId: BookId) => void;
  readonly onEditing?: (editing: boolean) => void;
  readonly currentFirst?: boolean;
  readonly writesDecisions?: boolean;
  readonly dimUnchosen?: boolean;
  readonly claimSidebar?: boolean;
  readonly sides?: (
    hunk: Hunk,
    split: boolean,
  ) => {
    readonly baseline: readonly CardAction[];
    readonly current: readonly CardAction[];
    readonly below?: JSX.Element;
  };
}) {
  const shell = useShell();
  const { services } = shell;
  const observability = services.composition.observability;
  const keys = shellKeys(services.settings);

  const [layout, setLayoutSignal] = createSignal<Layout>(
    toLayout(services.settings.get(keys.reviewLayout)),
    { name: "reviewLayout" },
  );
  const [scope, setScopeSignal] = createSignal<Scope>(
    services.settings.get(keys.reviewScope) === "book" ? "book" : "changes",
    { name: "reviewScope" },
  );
  const [filter, setFilter] = createSignal<Filter>("all", { name: "reviewFilter" });
  const [width, setWidth] = createSignal(0, { name: "reviewWidth" });
  const [prepared, setPrepared] = createSignal<readonly Prepared[]>([], {
    name: "reviewPrepared",
  });
  const [place, setPlace] = createSignal<number | undefined>(undefined, { name: "reviewPlace" });
  const [opened, setOpened] = createSignal<
    { readonly unit: DecisionUnit; readonly card: string } | undefined
  >(undefined, { name: "reviewOpened" });

  const setLayout = (value: Layout): void => {
    setLayoutSignal(value);
    void services.run(Effect.result(services.settings.set(keys.reviewLayout, value)));
  };
  const setScope = (value: Scope): void => {
    setScopeSignal(value);
    void services.run(Effect.result(services.settings.set(keys.reviewScope, value)));
  };

  const split = (): boolean =>
    layout() === "split" || (layout() === "auto" && width() >= AUTO_SPLIT_PX);

  const analyzers = new Map<string, (text: string) => Analysis>();
  const analysisOf = (bookId: BookId, side: "current" | "baseline", text: string): Analysis => {
    const key = `${side}\0${bookId}`;
    let analyze = analyzers.get(key);
    if (analyze === undefined) {
      analyze = services.galley.memoize();
      analyzers.set(key, analyze);
    }
    return analyze(text);
  };

  const views = createCardViews<never>("review");
  const expand = (key: string, step: ContextStep): void => {
    const steps = services.settings.get(keys.excerptContext);
    views.send(key, { kind: "step", step, from: { up: steps, down: steps } });
  };
  const extentsOf = (bookId: BookId): string =>
    [...untrack(views.extents).entries()]
      .filter(([key]) => key.startsWith(`${bookId} `))
      .map(
        ([key, extent]) => `${key}=${extent.up}/${extent.down}/${extent.chapter === true ? 1 : 0}`,
      )
      .join(",");

  const prepare = (book: ReviewBook, steps: number, show: Filter, result: boolean): Prepared => {
    const sides: DiffSides = {
      bookId: book.bookId,
      currentText: book.currentText,
      baselineText: book.baselineText,
      current: analysisOf(book.bookId, "current", book.currentText),
      baseline: analysisOf(book.bookId, "baseline", book.baselineText),
    };
    const units = book.skeleton.units;
    const filtered = FILTERS[show];
    const hidden = book.hidden;
    const include =
      hidden === undefined || hidden.size === 0
        ? filtered
        : (unit: DecisionUnit): boolean => filtered(unit) && !hidden.has(unit.id);
    const keep = (unit: DecisionUnit): boolean =>
      result && untrack(() => props.decision(book.bookId, unit.id)) !== undefined;
    return {
      book,
      sides,
      units,
      shown: units.filter((unit) => (changed(unit) && include(unit)) || keep(unit)),
      hunks: hunksOf({
        label: (address) => untrack(() => shell.location.label(address)),
        bookId: book.bookId,
        units,
        baseline: sides.baseline,
        current: sides.current,
        steps,
        extentOf: views.extentOf,
        include,
        keep,
      }),
    };
  };

  let held = new Map<BookId, { readonly key: string; readonly prepared: Prepared }>();
  const keyOf = (book: ReviewBook, show: Filter, result: boolean): string =>
    `${show}\0${result ? "r" : "c"}\0${book.currentText.length}\0${book.baselineText.length}\0${extentsOf(book.bookId)}\0${[...(book.hidden ?? [])].join(",")}`;
  const same = (was: Prepared, book: ReviewBook): boolean =>
    was.book.currentText === book.currentText && was.book.baselineText === book.baselineText;

  createEffect(
    () => ({
      books: props.books,
      show: filter(),
      result: props.decidable,
      widened: views.extents(),
    }),
    ({ books, show, result }) => {
      const steps = services.settings.get(keys.excerptContext);
      const op = observability.operation("review.diff.prepare", {
        "review.books": books.length,
        "review.filter": show,
        "review.mode": result ? "result" : "compare",
      });
      const before = held;
      const kept = new Map<BookId, { readonly key: string; readonly prepared: Prepared }>();
      const queue: ReviewBook[] = [];
      let reused = 0;
      for (const book of books) {
        const key = keyOf(book, show, result);
        const was = before.get(book.bookId);
        if (was !== undefined && was.key === key && same(was.prepared, book)) {
          kept.set(book.bookId, was);
          reused += 1;
        } else queue.push(book);
      }
      held = kept;
      const list = (): Prepared[] => {
        const out: Prepared[] = [];
        for (const book of books) {
          const entry = held.get(book.bookId)?.prepared ?? before.get(book.bookId)?.prepared;
          if (entry !== undefined) out.push(entry);
        }
        return out;
      };
      setPrepared(list());
      let stopped = false;
      let at = 0;
      const next = (): void => {
        if (stopped) return;
        const book = queue[at];
        if (book === undefined) {
          op.end("passed", {
            "review.reused": reused,
            "review.prepared": queue.length,
            "review.cards": list().reduce((sum, entry) => sum + entry.hunks.length, 0),
          });
          return;
        }
        at += 1;
        const done = op.span("review.diff.book", book.bookId);
        const prepared = prepare(book, steps, show, result);
        done({ "review.units": prepared.shown.length, "review.cards": prepared.hunks.length });
        held.set(book.bookId, { key: keyOf(book, show, result), prepared });
        setPrepared(list());
        if (at < queue.length) setTimeout(next, 0);
        else next();
      };
      next();
      return () => {
        stopped = true;
      };
    },
  );

  const selectedBook = (): Prepared | undefined =>
    prepared().find((held) => held.book.bookId === props.selected) ?? prepared()[0];

  const controlsFor = (bookId: BookId): Controls | undefined =>
    props.decidable
      ? {
          decision: (unit) => props.decision(bookId, unit.id),
          decide: (unit, side) => props.decide(bookId, [unit], side),
          keepTitle: t("Keep {source}'s", { source: props.currentShort }),
          takeTitle: t("Take {source}'s", { source: props.baselineShort }),
          live: props.writesDecisions ?? props.decidable,
          dimUnchosen: props.dimUnchosen === true,
        }
      : undefined;

  const controls = createMemo(
    () => new Map(prepared().map((held) => [held.book.bookId, controlsFor(held.book.bookId)])),
    { name: "reviewControls" },
  );

  const decidedOf = (held: Prepared | undefined): number =>
    held === undefined
      ? 0
      : held.shown.filter((unit) => props.decision(held.book.bookId, unit.id) !== undefined).length;

  let goTo: ((key: string) => void) | undefined;
  let book: BookDiffApi | undefined;
  let listRoot: HTMLDivElement | undefined;

  const cardKeys = createMemo(
    () => prepared().flatMap((held) => held.hunks.map((hunk) => hunk.key)),
    { name: "reviewCardKeys" },
  );

  const visibleCard = (): number | undefined => {
    const root = listRoot;
    if (root === undefined) return undefined;
    const top = root.getBoundingClientRect().top;
    const index = new Map(untrack(cardKeys).map((key, at) => [key, at]));
    let best: number | undefined;
    for (const card of root.querySelectorAll<HTMLElement>("[data-diff-card]")) {
      const at = index.get(card.dataset["diffCard"] ?? "");
      if (at === undefined || card.getBoundingClientRect().bottom <= top + 8) continue;
      if (best === undefined || at < best) best = at;
    }
    return best;
  };

  const onScreen = (key: string | undefined): boolean => {
    const root = listRoot;
    if (root === undefined || key === undefined) return false;
    const card = root.querySelector<HTMLElement>(`[data-diff-card="${CSS.escape(key)}"]`);
    if (card === null) return false;
    const box = card.getBoundingClientRect();
    const frame = root.getBoundingClientRect();
    return box.bottom > frame.top + 8 && box.top < frame.bottom - 8;
  };

  const stepCards = (delta: 1 | -1): void => {
    const keysNow = untrack(cardKeys);
    if (keysNow.length === 0) return;
    const at = untrack(place);
    const held = at !== undefined && onScreen(keysNow[at]) ? at : undefined;
    const from = held ?? visibleCard() ?? 0;
    const to =
      held === undefined && delta > 0
        ? at === undefined
          ? from
          : Math.min(keysNow.length - 1, from + delta)
        : Math.max(0, Math.min(keysNow.length - 1, from + delta));
    const key = keysNow[to];
    if (key === undefined) return;
    goTo?.(key);
    setPlace(to);
  };

  let steeredAt = 0;
  const STEER_MS = 800;

  const stepUnits = (delta: 1 | -1): void => {
    steeredAt = performance.now();
    const all = untrack(prepared);
    const held = untrack(selectedBook);
    if (held === undefined) return;
    const shown = held.shown;
    const startOf = (unit: DecisionUnit): number => unit.current?.from ?? unit.place.current;
    const endOf = (unit: DecisionUnit): number => unit.current?.to ?? unit.place.current;
    const mid = book?.middle();
    let to: number | undefined;
    if (mid === undefined) to = delta > 0 ? 0 : shown.length - 1;
    else {
      const on = shown.findIndex((unit) => startOf(unit) <= mid && mid <= endOf(unit));
      if (delta > 0) {
        const found = shown.findIndex((unit, index) => index !== on && startOf(unit) > mid);
        to = found < 0 ? undefined : found;
      } else {
        for (let index = shown.length - 1; index >= 0; index -= 1) {
          const unit = shown[index];
          if (unit !== undefined && index !== on && startOf(unit) < mid) {
            to = index;
            break;
          }
        }
      }
    }
    const unit = to === undefined ? undefined : shown[to];
    if (unit !== undefined && to !== undefined) {
      book?.showUnit(unit);
      setPlace(to);
      return;
    }
    const index = all.indexOf(held);
    for (let other = index + delta; other >= 0 && other < all.length; other += delta) {
      const next = all[other];
      const land = delta > 0 ? next?.shown[0] : next?.shown.at(-1);
      if (next === undefined || land === undefined) continue;
      setOpened({ unit: land, card: "" });
      setPlace(delta > 0 ? 0 : next.shown.length - 1);
      props.onSelect(next.book.bookId);
      return;
    }
    const edge = delta > 0 ? shown.length - 1 : 0;
    const last = shown[edge];
    if (last !== undefined) {
      book?.showUnit(last);
      setPlace(edge);
    }
  };

  const step = (delta: 1 | -1): void => {
    const done = observability.span("review.diff.step", scope());
    if (untrack(scope) === "changes") stepCards(delta);
    else stepUnits(delta);
    done();
  };

  const releaseNext = registerCommand({
    id: "review.change.next",
    title: t("Next change"),
    keys: "Alt-F5",
    run: () => step(1),
  });
  const releasePrevious = registerCommand({
    id: "review.change.previous",
    title: t("Previous change"),
    keys: "Alt-Shift-F5",
    run: () => step(-1),
  });
  onCleanup(() => {
    releaseNext();
    releasePrevious();
  });

  const counter = (): string => {
    const total = scope() === "changes" ? cardKeys().length : (selectedBook()?.shown.length ?? 0);
    const at = place();
    return at === undefined
      ? t("{total} changes", { total })
      : t("{at} of {total}", { at: at + 1, total });
  };

  const placeFrom = (unit: DecisionUnit | undefined): void => {
    if (performance.now() - steeredAt < STEER_MS) return;
    const held = untrack(selectedBook);
    if (held === undefined || unit === undefined) return;
    const from = unit.current?.from ?? 0;
    let at = -1;
    for (const [index, shown] of held.shown.entries())
      if ((shown.current?.from ?? Number.POSITIVE_INFINITY) <= from) at = index;
    setPlace(at < 0 ? undefined : at);
  };

  const openInBook = (hunk: Hunk): void => {
    const first = hunk.units[0];
    if (first === undefined) return;
    steeredAt = performance.now();
    setOpened({ unit: first, card: hunk.key });
    props.onSelect(hunk.bookId);
    setScope("book");
    const held = untrack(prepared).find((entry) => entry.book.bookId === hunk.bookId);
    setPlace(held?.shown.indexOf(first));
  };

  const chapterOf = (unit: DecisionUnit): number => {
    const addr = unit.currentAddr ?? unit.baselineAddr;
    return addr === undefined || addr.kind === "frontMatter" ? 0 : addr.chapter;
  };
  const chaptersOf = (held: Prepared): readonly CrumbChapter[] => {
    const counts = new Map<number, number>();
    for (const unit of held.shown) {
      const chapter = chapterOf(unit);
      counts.set(chapter, (counts.get(chapter) ?? 0) + 1);
    }
    return [...counts]
      .sort((a, b) => a[0] - b[0])
      .map(([chapter, count]) => ({
        ordinal: chapter,
        label: chapter === 0 ? t("Intro") : String(chapter),
        intro: chapter === 0,
        count,
      }));
  };
  const currentChapter = (): number | undefined => {
    const held = selectedBook();
    const unit = held?.shown[place() ?? 0];
    return unit === undefined ? undefined : chapterOf(unit);
  };
  const chapterWords = (chapter: number | undefined): string =>
    chapter === undefined
      ? ""
      : chapter === 0
        ? t("Intro")
        : t("Chapter {label}", { label: chapter });
  const chapterAt = (delta: 1 | -1): number | undefined => {
    const held = selectedBook();
    if (held === undefined) return undefined;
    const list = chaptersOf(held);
    const index = list.findIndex((row) => row.ordinal === currentChapter());
    return list[(index < 0 ? 0 : index) + delta]?.ordinal;
  };
  const stepChapter = (delta: 1 | -1): void => {
    const chapter = untrack(() => chapterAt(delta));
    if (chapter !== undefined) goToChapter(chapter);
  };
  const [linked, setLinked] = createSignal(true, { name: "reviewLinked" });

  const goToChapter = (chapter: number): void => {
    const held = untrack(selectedBook);
    const index = held?.shown.findIndex((unit) => chapterOf(unit) === chapter) ?? -1;
    const unit = held?.shown[index];
    if (unit === undefined) return;
    steeredAt = performance.now();
    book?.showUnit(unit);
    setPlace(index);
  };

  const enterBook = (): void => {
    const first = untrack(selectedBook)?.shown[0];
    if (untrack(opened) === undefined && first !== undefined) {
      steeredAt = performance.now();
      setOpened({ unit: first, card: "" });
      setPlace(0);
    }
    setScope("book");
  };

  const backToCards = (): void => {
    const card = untrack(opened)?.card;
    setScope("changes");
    setPlace(undefined);
    if (card !== undefined && card !== "") requestAnimationFrame(() => goTo?.(card));
  };

  const [activeBook, setActiveBook] = createSignal<BookId | undefined>(undefined, {
    name: "reviewActiveBook",
  });

  const pickBook = (bookId: BookId): void => {
    setActiveBook(bookId);
    props.onSelect(bookId);
    setPlace(undefined);
    setOpened(undefined);
    if (untrack(scope) === "changes") goTo?.(bookId);
  };

  const inScope = (): readonly Prepared[] => {
    if (scope() === "changes") return prepared();
    const held = selectedBook();
    return held === undefined ? [] : [held];
  };
  const scopeCount = (): number => inScope().reduce((sum, held) => sum + held.shown.length, 0);
  const decideAll = (side: MergeSide | undefined): void => {
    for (const held of untrack(inScope))
      if (held.shown.length > 0) props.decide(held.book.bookId, held.shown, side);
  };

  function DecideAll() {
    return (
      <Show when={props.decidable && scopeCount() > 0}>
        <Menu
          label={t("Decide all")}
          side="bottom"
          align="end"
          class="w-72"
          trigger={
            <Button size="sm" variant="tertiary" data-review-decide-all>
              {t("Decide all")}
              <ChevronDown aria-hidden="true" />
            </Button>
          }
        >
          <MenuLabel>
            {(() => {
              const count = scopeCount();
              const changes = t(count === 1 ? "{count} change" : "{count} changes", { count });
              if (scope() !== "changes")
                return t("{changes} in {book}", { changes, book: inScope()[0]?.book.name ?? "" });
              const books = inScope().filter((held) => held.shown.length > 0).length;
              return t("{changes} in {books}", {
                changes,
                books: t(books === 1 ? "{count} book" : "{count} books", { count: books }),
              });
            })()}
          </MenuLabel>
          <MenuItem data-review-take-all onSelect={() => decideAll("baseline")}>
            {t("Take {source}'s for all", { source: props.baselineShort })}
          </MenuItem>
          <MenuItem data-review-keep-all onSelect={() => decideAll("current")}>
            {t("Keep {source}'s for all", { source: props.currentShort })}
          </MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => decideAll(undefined)}>{t("Clear these decisions")}</MenuItem>
        </Menu>
      </Show>
    );
  }

  const cardDecision = (hunk: Hunk): readonly CardAction[] => {
    if (hunk.units.length === 0) return [];
    if (!props.decidable) {
      if (split()) return [];
      const sides = props.sides?.(hunk, false);
      return sides === undefined ? [] : [...sides.baseline, ...sides.current];
    }
    const sides = new Set(hunk.units.map((unit) => props.decision(hunk.bookId, unit.id)));
    const side: MergeSide | "mixed" | undefined = sides.size !== 1 ? "mixed" : [...sides][0];
    const one = hunk.units.length === 1;
    const choose = (chosen: MergeSide): void =>
      props.decide(hunk.bookId, hunk.units, side === chosen ? undefined : chosen);
    return [
      {
        kind: "button",
        id: "take",
        emphasis: "tertiary",
        pressed: side === "baseline",
        label:
          side === "baseline"
            ? t("Taken from {source}", { source: props.baselineShort })
            : one
              ? t("Take {source}'s", { source: props.baselineShort })
              : t("Take all of {source}'s", { source: props.baselineShort }),
        onPress: () => choose("baseline"),
      },
      {
        kind: "button",
        id: "keep",
        emphasis: "tertiary",
        pressed: side === "current",
        label: one
          ? t("Keep {source}'s", { source: props.currentShort })
          : t("Keep all of {source}'s", { source: props.currentShort }),
        onPress: () => choose("current"),
      },
    ];
  };

  const sections = createMemo(
    (): readonly VirtualSection<{ hunk: Hunk; held: Prepared }>[] =>
      prepared()
        .filter((held) => held.hunks.length > 0)
        .map((held) => ({
          key: held.book.bookId,
          rows: held.hunks.map((hunk) => ({
            key: hunk.key,
            item: { hunk, held },
            estimate: estimate(hunk),
          })),
        })),
    { name: "reviewSections" },
  );

  if (untrack(() => props.claimSidebar) !== false)
    onCleanup(
      claimSidebar(() => (
        <ChangesHistorySidebar active="changes" changes={prepared().length}>
          <div class="px-4 pt-3 pb-2">
            <p class="px-2 text-small text-on-surface-secondary">
              {(() => {
                const count = prepared().reduce((sum, held) => sum + held.shown.length, 0);
                const books = prepared().length;
                return t("{changes} in {books}", {
                  changes: t(count === 1 ? "{count} change" : "{count} changes", { count }),
                  books: t(books === 1 ? "{count} book" : "{count} books", { count: books }),
                });
              })()}
            </p>
          </div>
          <nav aria-label={t("Changes")} class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <ul>
              <For each={prepared()}>
                {(held) => {
                  const here = (): boolean =>
                    (scope() === "book"
                      ? selectedBook()?.book.bookId
                      : (activeBook() ?? prepared()[0]?.book.bookId)) === held.book.bookId;
                  const done = (): boolean =>
                    held.shown.length > 0 && decidedOf(held) === held.shown.length;
                  return (
                    <li class="flex items-center gap-0.5">
                      <button
                        type="button"
                        data-outline={held.book.bookId}
                        data-focused={here() ? "" : undefined}
                        aria-current={here() ? "true" : undefined}
                        class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-small transition-colors data-focused:bg-sidebar-surface-active data-focused:font-medium data-focused:text-brand not-data-focused:text-sidebar-on-surface not-data-focused:hover:bg-sidebar-surface-hover"
                        onClick={() => pickBook(held.book.bookId)}
                      >
                        <Show
                          when={done()}
                          fallback={<BookIcon size={15} aria-hidden="true" class="shrink-0" />}
                        >
                          <CheckIcon size={15} aria-hidden="true" class="shrink-0 text-brand" />
                        </Show>
                        <span class="min-w-0 flex-1 truncate">{held.book.name}</span>
                        <span class="shrink-0 text-smallest tabular-nums text-on-surface-tertiary">
                          {props.decidable
                            ? `${decidedOf(held)}/${held.shown.length}`
                            : String(held.shown.length)}
                        </span>
                      </button>
                      <Show when={props.decidable && held.shown.length > 0}>
                        <Menu
                          label={t("Decide {book}", { book: held.book.name })}
                          side="bottom"
                          align="end"
                          class="w-56"
                          trigger={
                            <IconButton
                              size="sm"
                              label={t("Decide all of {book}", { book: held.book.name })}
                              icon={<MoreVertical />}
                              data-review-book-menu={held.book.bookId}
                            />
                          }
                        >
                          <MenuItem
                            onSelect={() => props.decide(held.book.bookId, held.shown, "baseline")}
                          >
                            {t("Take all of {source}'s", { source: props.baselineShort })}
                          </MenuItem>
                          <MenuItem
                            onSelect={() => props.decide(held.book.bookId, held.shown, "current")}
                          >
                            {t("Keep all of {source}'s", { source: props.currentShort })}
                          </MenuItem>
                          <MenuItem
                            onSelect={() => props.decide(held.book.bookId, held.shown, undefined)}
                          >
                            {t("Clear")}
                          </MenuItem>
                        </Menu>
                      </Show>
                    </li>
                  );
                }}
              </For>
            </ul>
          </nav>
        </ChangesHistorySidebar>
      )),
    );

  const editable = (): boolean => props.decidable;

  const [seats, setSeats] = createSignal<ReadonlyMap<BookId, EditorBook>>(new Map(), {
    name: "reviewSeats",
  });
  createEffect(
    () => {
      const bookId = scope() === "book" && editable() ? selectedBook()?.book.bookId : undefined;
      return bookId === undefined ? [] : [bookId];
    },
    (bookIds) => {
      if (bookIds.length === 0) return;
      let current = true;
      for (const bookId of bookIds) {
        if (untrack(seats).has(bookId)) continue;
        void props.seat(bookId).then((book) => {
          if (!current || book === undefined) return;
          setSeats((held) =>
            held.get(bookId) === book ? held : new Map([...held, [bookId, book]]),
          );
        });
      }
      return () => {
        current = false;
      };
    },
  );

  const handles = new WeakMap<
    EditorBook,
    { readonly book: EditorBook; readonly analyze: (text: string) => Analysis }
  >();
  const liveFor = (bookId: BookId) => {
    const book = seats().get(bookId);
    if (book === undefined) return undefined;
    let handle = handles.get(book);
    if (handle === undefined) {
      handle = { book, analyze: (text: string) => analysisOf(bookId, "current", text) };
      handles.set(book, handle);
    }
    return handle;
  };

  let observer: ResizeObserver | undefined;
  const measure = (element: HTMLDivElement): void => {
    observer?.disconnect();
    observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box !== undefined && box.width > 0) setWidth(box.width);
    });
    observer.observe(element);
  };
  onCleanup(() => observer?.disconnect());

  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2" data-review-reader ref={measure}>
      <div class="flex flex-wrap items-center gap-2" data-review-toolbar>
        <SegmentedControl<Scope>
          size="sm"
          label={t("How much to show")}
          value={scope()}
          onChange={(value) => (value === "book" ? enterBook() : backToCards())}
          items={[
            {
              value: "changes",
              label: t("Changes"),
              title: t("Each change as a card, with context, across every book"),
            },
            {
              value: "book",
              label: t("Whole book"),
              title: t("The whole book, with its changes drawn in place"),
            },
          ]}
        />
        <Menu
          label={t("View")}
          side="bottom"
          align="start"
          class="w-64"
          trigger={
            <Button size="sm" variant="tertiary" data-review-view>
              <Columns2 aria-hidden="true" />

              {filter() === "all"
                ? t("View")
                : filter() === "words"
                  ? t("View · words only")
                  : t("View · markup only")}
              <ChevronDown aria-hidden="true" />
            </Button>
          }
        >
          <MenuLabel>{t("Show")}</MenuLabel>
          <For each={["all", "words", "formatting"] as const}>
            {(value) => (
              <MenuRadio
                checked={filter() === value}
                data-review-filter={value}
                onSelect={() => {
                  setFilter(value);
                  setPlace(undefined);
                }}
              >
                {value === "all"
                  ? t("All changes")
                  : value === "words"
                    ? t("Changes to the words")
                    : t("Markup and spacing only")}
              </MenuRadio>
            )}
          </For>
          <MenuSeparator />
          <MenuLabel>{t("Layout")}</MenuLabel>
          <MenuRadio checked={layout() === "auto"} onSelect={() => setLayout("auto")}>
            {t("Side by side when there is room")}
          </MenuRadio>
          <MenuRadio checked={layout() === "split"} onSelect={() => setLayout("split")}>
            {t("Side by side")}
          </MenuRadio>
          <MenuRadio checked={layout() === "unified"} onSelect={() => setLayout("unified")}>
            {t("One text, changes marked")}
          </MenuRadio>
          <MenuSeparator />
          <MenuCheckbox checked={props.usfm} onChange={props.onUsfm}>
            {t("Show USFM markup")}
          </MenuCheckbox>
        </Menu>
        <div class="ms-auto flex items-center gap-1">
          <DecideAll />

          <Show when={place() !== undefined}>
            <span class="text-smallest text-on-surface-tertiary tabular-nums" data-review-counter>
              {counter()}
            </span>
          </Show>
          <IconButton
            size="sm"
            label={t("Previous change (Alt-Shift-F5)")}
            icon={<ArrowUp />}
            onClick={() => step(-1)}
          />
          <IconButton
            size="sm"
            label={t("Next change (Alt-F5)")}
            icon={<ArrowDown />}
            onClick={() => step(1)}
          />
        </div>
      </div>

      <Show
        when={scope() === "changes"}
        fallback={
          <Show
            when={selectedBook()?.book.bookId}
            fallback={<EmptyState title={t("Preparing…")} />}
          >
            {(_bookId) => {
              let last = untrack(selectedBook);
              const held = (): Prepared => {
                const found = selectedBook();
                if (found !== undefined) last = found;
                if (last === undefined) throw new Error("Whole book is showing no book");
                return last;
              };
              return (
                <div class="flex min-h-0 flex-1 flex-col gap-2">
                  <LocationStrip testId="review-location" class="rounded-md border">
                    <Crumbs
                      book={held().book.name}
                      books={() =>
                        prepared().map((entry) => ({
                          id: entry.book.bookId,
                          name: entry.book.name,
                          count: entry.shown.length,
                        }))
                      }
                      currentBook={held().book.bookId}
                      onBook={(picked) => pickBook(picked.id)}
                      chapter={chapterWords(currentChapter())}
                      chapters={() => chaptersOf(held())}
                      currentChapter={currentChapter()}
                      onChapter={goToChapter}
                      step={{
                        onPrevious: () => stepChapter(-1),
                        onNext: () => stepChapter(1),
                        get first() {
                          return chapterAt(-1) === undefined;
                        },
                        get last() {
                          return chapterAt(1) === undefined;
                        },
                      }}
                      end={
                        <FollowToggle
                          testId="review-linked"
                          following={linked()}
                          tooltipSide="bottom"
                          stopLabel={t("Scroll the two texts separately")}
                          startLabel={t("Keep the two texts at the same verse")}
                          onToggle={() => setLinked((on) => !on)}
                        />
                      }
                    />
                  </LocationStrip>

                  <Show when={layout() !== "auto" || width() > 0}>
                    <BookDiff
                      class="min-h-0 flex-1"
                      linked={linked}
                      sides={held().sides}
                      units={held().units}
                      split={split()}
                      usfm={props.usfm}
                      controls={controls().get(held().book.bookId)}
                      currentLabel={labelOf(props.currentLabel, held().book.bookId)}
                      baselineLabel={labelOf(props.baselineLabel, held().book.bookId)}
                      currentFirst={props.currentFirst === true}
                      observability={observability}
                      initial={opened()?.unit}
                      live={liveFor(held().book.bookId)}
                      awaitLive={editable()}
                      ref={(api) => {
                        book = api;
                      }}
                      onPlace={placeFrom}
                    />
                  </Show>
                </div>
              );
            }}
          </Show>
        }
      >
        <div
          class="flex min-h-0 flex-1"
          ref={(element) => {
            listRoot = element;
          }}
        >
          <CardList<{ hunk: Hunk; held: Prepared }>
            sections={sections()}
            bookOf={(item) => item.hunk.bookId}
            seat={props.seat}
            lineLabel={(item) => item.hunk.label}
            goneLabel={t("No longer a change")}
            whenGone={(item) => ({ ...item, hunk: { ...item.hunk, units: [], all: [] } })}
            onEditing={(now) => props.onEditing?.(now)}
            ref={(scrollTo) => {
              goTo = scrollTo;
            }}
            card={(item, _key, session) => (
              <DiffCard
                hunk={item().hunk}
                view={views.view(item().hunk.key)}
                onView={(event) => views.send(item().hunk.key, event)}
                sides={item().held.sides}
                split={split()}
                usfm={props.usfm}
                controls={controls().get(item().hunk.bookId)}
                current={place() !== undefined && cardKeys()[place() ?? -1] === item().hunk.key}
                origin={props.originOf?.(item().hunk.bookId, item().hunk.units)}
                currentLabel={labelOf(props.currentLabel, item().hunk.bookId)}
                baselineLabel={labelOf(props.baselineLabel, item().hunk.bookId)}
                currentFirst={props.currentFirst === true}
                sideActions={split() ? props.sides?.(item().hunk, true) : undefined}
                below={props.sides?.(item().hunk, split()).below}
                editable={editable()}
                editing={session.editing}
                gone={session.gone ? session.goneLabel : undefined}
                onEdit={session.start}
                onDone={session.done}
                seat={() => props.seat(item().hunk.bookId)}
                analyze={(text) => analysisOf(item().hunk.bookId, "current", text)}
                headerActions={cardDecision(item().hunk)}
                onStep={(step) => expand(item().hunk.key, step)}
                open={{
                  kind: "icon",
                  id: "open",
                  label: t("Open in the book"),
                  icon: BookOpen,
                  onPress: () => openInBook(item().hunk),
                }}
              />
            )}
            empty={
              <EmptyState
                title={
                  prepared().length < props.books.length
                    ? t("Preparing…")
                    : t("No changes of this kind.")
                }
              />
            }
          />
        </div>
      </Show>
    </div>
  );
}

const labelOf = (label: string | ((bookId: BookId) => string), bookId: BookId): string =>
  typeof label === "string" ? label : label(bookId);

const toLayout = (value: string): Layout =>
  value === "split" || value === "unified" ? value : "auto";
