/**
 * The review's reading: every difference drawn on the texts themselves, as the
 * editor reads them, with a decision per unit.
 *
 * Three layers, each independent of the others:
 *
 *  - **The engine** decides what differs: decision units and word runs
 *    (`galley.diff`), and the decision map the panel above holds. Every view
 *    reads and writes the same decisions, keyed by book and unit, so switching
 *    view never loses one.
 *  - **Layout** is how a difference is drawn: `split` (each side its own text,
 *    side by side) or `unified` (the current text with the other's words
 *    struck through where they were). `auto` splits when the reading is wide
 *    enough for two columns of scripture and unifies when it is not.
 *  - **Scope** is how much of the text is shown: `changes` (each change a card
 *    clipped to it and its context, across every book that differs — the
 *    multibuffer) or `book` (the whole book, the changes drawn in place).
 *    Scattered edits read better as cards, a rewrite reads better as the book;
 *    a card's "Open in the book" crosses between them at the same place.
 *
 * Layout and scope are preferences (`review.layout`, `review.scope`); the
 * toolbar changes them and they are remembered.
 *
 * Next and previous change (`Alt-F5`, `Alt-Shift-F5`, the palette, or the
 * arrows here) step through what is shown: cards in `changes`, units in
 * `book`, crossing into the next book at the end of one.
 *
 * Decisions come in three sizes: a unit (the gutter), a card (its header), and
 * a book (its header, over the changes the kind filter shows). The filter is
 * what makes the bulk ones safe to offer: "keep every markup-only change in
 * Genesis" is a question somebody can answer; "keep all 2,799" is not.
 */

import { Effect } from "effect";
import ArrowDown from "lucide-solid/icons/arrow-down";
import ArrowUp from "lucide-solid/icons/arrow-up";
import BookIcon from "lucide-solid/icons/book";
import BookOpen from "lucide-solid/icons/book-open";
import CheckIcon from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Columns2 from "lucide-solid/icons/columns-2";
import Pencil from "lucide-solid/icons/pencil";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";

import type { BookId } from "#core/book/book";
import type { Analysis, DecisionUnit, DiffSkeleton, MergeSide } from "#core/galley";
import type { EditorBook } from "#editor/index";

import { registerCommand } from "../../commands";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import {
  BookDiff,
  DiffCard,
  changed,
  estimate,
  hunkLabel,
  hunksOf,
  isFormatting,
  ordered,
  type BookDiffApi,
  type Controls,
  type DiffSides,
  type Hunk,
} from "../diff";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Menu,
  MenuCheckbox,
  MenuLabel,
  MenuRadio,
  MenuSeparator,
  SegmentedControl,
  Select,
  VirtualList,
  type VirtualSection,
} from "../primitives";
import { claimSidebar } from "../workspace/sidebarSlot";
import { ResultEditor } from "./ResultEditor";

/** One book that differs: both texts and the engine's units over them. */
export interface ReviewBook {
  readonly bookId: BookId;
  readonly name: string;
  /** The LEFT source's text — `current` in the engine's vocabulary. */
  readonly currentText: string;
  /** The RIGHT source's text — `baseline`. */
  readonly baselineText: string;
  readonly skeleton: DiffSkeleton;
}

type Layout = "auto" | "split" | "unified";
export type ReviewMode = "compare" | "result";
type Scope = "changes" | "book";
type Filter = "all" | "words" | "formatting";

/** Below this width two columns of scripture are too narrow to read. */
const AUTO_SPLIT_PX = 960;

const FILTERS: Record<Filter, (unit: DecisionUnit) => boolean> = {
  all: () => true,
  words: (unit) => !isFormatting(unit),
  formatting: isFormatting,
};

/** One book, ready to draw: its sides, its units in order, its cards. */
interface Prepared {
  readonly book: ReviewBook;
  readonly sides: DiffSides;
  readonly units: readonly DecisionUnit[];
  /** The changes the filter shows, in reading order. */
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
  /** False when neither side can be written: the review is reading only. */
  readonly decidable: boolean;
  readonly usfm: boolean;
  readonly onUsfm: (on: boolean) => void;
  readonly currentLabel: string;
  readonly baselineLabel: string;
  readonly currentShort: string;
  readonly baselineShort: string;
  readonly selected: BookId | undefined;
  readonly onSelect: (bookId: BookId) => void;
  /**
   * `compare` decides, then Apply writes. `result` writes each decision into
   * the target as it is made, and the current pane IS the target — editable
   * when the target is the working text. Offered only when it is.
   */
  readonly mode: ReviewMode;
  readonly onMode: (mode: ReviewMode) => void;
  readonly resultAvailable: boolean;
  /** The book, seated for editing: the result pane's Edit. */
  readonly seat: (bookId: BookId) => Promise<EditorBook | undefined>;
  /** An edit made in the result pane was accepted. */
  readonly onEdited: (bookId: BookId) => void;
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
  /** Where "Open in the book" lands, and the card to return to. */
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

  // --- the books, made ready one per tick ------------------------------------

  /**
   * One parse per side per book, held while the text is the same. A parse is
   * what a card's context (TOC steps) and every view are drawn from.
   *
   * `memoize()` with no id: the loose-text door. An id would register the text
   * with the corpus as a proofreading target, and a review's other side is not
   * one.
   */
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

  const prepare = (book: ReviewBook, steps: number, show: Filter, result: boolean): Prepared => {
    const sides: DiffSides = {
      bookId: book.bookId,
      currentText: book.currentText,
      baselineText: book.baselineText,
      current: analysisOf(book.bookId, "current", book.currentText),
      baseline: analysisOf(book.bookId, "baseline", book.baselineText),
    };
    const units = ordered(book.skeleton);
    const include = FILTERS[show];
    // In Result mode a taken unit is unchanged now — it IS the other side's
    // text — and still keeps its card, to say so and to put it back.
    const keep = (unit: DecisionUnit): boolean =>
      result && untrack(() => props.decision(book.bookId, unit.id)) !== undefined;
    return {
      book,
      sides,
      units,
      shown: units.filter((unit) => (changed(unit) && include(unit)) || keep(unit)),
      hunks: hunksOf({
        bookId: book.bookId,
        units,
        baseline: sides.baseline,
        current: sides.current,
        steps,
        include,
        keep,
      }),
    };
  };

  /**
   * Books are prepared one per tick, so the first cards are on screen while
   * the rest are still being parsed. A book whose two texts are the ones it was
   * prepared from is REUSED, and a book being re-prepared keeps its old entry
   * until the new one is ready: a keystroke in the result pane re-compares the
   * review, and must neither re-parse every other book nor empty the list
   * under the card being edited.
   */
  let held = new Map<BookId, { readonly key: string; readonly prepared: Prepared }>();
  const keyOf = (book: ReviewBook, show: Filter, result: boolean): string =>
    `${show}\0${result ? "r" : "c"}\0${book.currentText.length}\0${book.baselineText.length}`;
  const same = (was: Prepared, book: ReviewBook): boolean =>
    was.book.currentText === book.currentText && was.book.baselineText === book.baselineText;

  createEffect(
    () => ({ books: props.books, show: filter(), result: props.mode === "result" }),
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
      /** The list in the books' order: fresh where ready, the old entry until then. */
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

  // --- decisions ---------------------------------------------------------------

  const controlsFor = (bookId: BookId): Controls | undefined =>
    props.decidable
      ? {
          decision: (unit) => props.decision(bookId, unit.id),
          decide: (unit, side) => props.decide(bookId, [unit], side),
          keepTitle: t("Keep {source}'s", { source: props.currentShort }),
          takeTitle: t("Take {source}'s", { source: props.baselineShort }),
          live: props.mode === "result",
        }
      : undefined;

  /** One per book, so a card's controls keep their identity across renders. */
  const controls = createMemo(
    () => new Map(prepared().map((held) => [held.book.bookId, controlsFor(held.book.bookId)])),
    { name: "reviewControls" },
  );

  const decidedOf = (held: Prepared | undefined): number =>
    held === undefined
      ? 0
      : held.shown.filter((unit) => props.decision(held.book.bookId, unit.id) !== undefined).length;

  // --- next and previous ------------------------------------------------------

  let goTo: ((key: string) => void) | undefined;
  let book: BookDiffApi | undefined;
  let listRoot: HTMLDivElement | undefined;

  const cardKeys = createMemo(
    () => prepared().flatMap((held) => held.hunks.map((hunk) => hunk.key)),
    { name: "reviewCardKeys" },
  );

  /** The first card whose bottom is below the list's top: where the reader is. */
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

  const stepCards = (delta: 1 | -1): void => {
    const keysNow = untrack(cardKeys);
    if (keysNow.length === 0) return;
    // From the card at the top, so a reader who scrolled is stepped from where
    // they are. The first "next" lands on that card rather than skipping it.
    const from = visibleCard() ?? 0;
    const to =
      untrack(place) === undefined && delta > 0
        ? from
        : Math.max(0, Math.min(keysNow.length - 1, from + delta));
    const key = keysNow[to];
    if (key === undefined) return;
    goTo?.(key);
    setPlace(to);
  };

  /**
   * When the reader was last moved for them. The book view reports its place
   * as it scrolls, and the reports that follow a step — the mount, the scroll
   * the step caused — describe the line at the top, which is not always the
   * change stepped to. For a moment after a step, the step is the answer.
   */
  let steeredAt = 0;
  const STEER_MS = 800;

  const stepUnits = (delta: 1 | -1): void => {
    steeredAt = performance.now();
    const all = untrack(prepared);
    const held = untrack(selectedBook);
    if (held === undefined) return;
    const shown = held.shown;
    const at = untrack(place);
    const to = at === undefined ? (delta > 0 ? 0 : shown.length - 1) : at + delta;
    const unit = shown[to];
    if (unit !== undefined) {
      book?.showUnit(unit);
      setPlace(to);
      return;
    }
    // Past either end of this book: the next (or previous) book that has one.
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

  /** "3 of 61": where next and previous count from. */
  const counter = (): string => {
    const total = scope() === "changes" ? cardKeys().length : (selectedBook()?.shown.length ?? 0);
    const at = place();
    return at === undefined
      ? t("{total} changes", { total })
      : t("{at} of {total}", { at: at + 1, total });
  };

  // A book scope follows the reader's place, so the counter says where they are.
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

  const backToCards = (): void => {
    const card = untrack(opened)?.card;
    setScope("changes");
    setPlace(undefined);
    if (card !== undefined && card !== "") requestAnimationFrame(() => goTo?.(card));
  };

  const pickBook = (bookId: BookId): void => {
    props.onSelect(bookId);
    setPlace(undefined);
    setOpened(undefined);
    if (untrack(scope) === "changes") goTo?.(bookId);
  };

  // --- the pieces --------------------------------------------------------------

  function BookActions(actionProps: { readonly held: Prepared }) {
    const bookId = () => actionProps.held.book.bookId;
    return (
      <Show when={props.decidable && actionProps.held.shown.length > 0}>
        <div class="flex items-center gap-1" data-review-book-actions={bookId()}>
          <Button
            size="sm"
            variant="tertiary"
            onClick={() => props.decide(bookId(), actionProps.held.shown, "current")}
          >
            {t("Keep all of {source}'s", { source: props.currentShort })}
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            onClick={() => props.decide(bookId(), actionProps.held.shown, "baseline")}
          >
            {t("Take all of {source}'s", { source: props.baselineShort })}
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            onClick={() => props.decide(bookId(), actionProps.held.shown, undefined)}
          >
            {t("Clear")}
          </Button>
        </div>
      </Show>
    );
  }

  /**
   * A card's decision, said in words in its header: most cards hold one
   * change, and a reader deciding it should not have to learn what a gutter
   * glyph means. Pressed when every change in the card has that side; pressing
   * it again clears them.
   */
  function CardDecision(cardProps: { readonly hunk: Hunk }) {
    const sideOf = (): MergeSide | "mixed" | undefined => {
      const sides = new Set(
        cardProps.hunk.units.map((unit) => props.decision(cardProps.hunk.bookId, unit.id)),
      );
      if (sides.size !== 1) return "mixed";
      return [...sides][0];
    };
    const one = (): boolean => cardProps.hunk.units.length === 1;
    const choose = (side: MergeSide): void =>
      props.decide(
        cardProps.hunk.bookId,
        cardProps.hunk.units,
        sideOf() === side ? undefined : side,
      );
    return (
      <Show when={props.decidable}>
        <Button
          size="sm"
          variant={sideOf() === "current" ? "secondary" : "tertiary"}
          class={sideOf() === "current" ? "text-brand ring-1 ring-brand" : undefined}
          aria-pressed={sideOf() === "current" ? "true" : "false"}
          data-card-decision="current"
          onClick={() => choose("current")}
        >
          {one()
            ? t("Keep {source}'s", { source: props.currentShort })
            : t("Keep all of {source}'s", { source: props.currentShort })}
        </Button>
        <Button
          size="sm"
          variant={sideOf() === "baseline" ? "secondary" : "tertiary"}
          class={sideOf() === "baseline" ? "text-brand ring-1 ring-brand" : undefined}
          aria-pressed={sideOf() === "baseline" ? "true" : "false"}
          data-card-decision="baseline"
          onClick={() => choose("baseline")}
        >
          {props.mode === "result" && sideOf() === "baseline"
            ? t("Taken from {source} — put back", { source: props.baselineShort })
            : one()
              ? t("Take {source}'s", { source: props.baselineShort })
              : t("Take all of {source}'s", { source: props.baselineShort })}
        </Button>
      </Show>
    );
  }

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

  /**
   * The sidebar navigates the CHANGES, as Find's does its results: one row per
   * book that differs, with how many of its changes are decided. A row goes to
   * the book — its section in Changes, the book itself in Whole book.
   */
  const [activeBook, setActiveBook] = createSignal<BookId | undefined>(undefined, {
    name: "reviewActiveBook",
  });
  onCleanup(
    claimSidebar(() => (
      <div
        class="flex h-full flex-col border-e border-sidebar-border bg-sidebar-surface"
        data-testid="sidebar"
        data-sidebar="changes"
      >
        <div class="px-4 pt-4 pb-2">
          <p class="px-2 text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase">
            {t("Changes")}
          </p>
          <p class="px-2 text-small text-on-surface-secondary">
            {t("{count} in {books} book(s)", {
              count: prepared().reduce((sum, held) => sum + held.shown.length, 0),
              books: prepared().length,
            })}
          </p>
        </div>
        <nav aria-label={t("Changes")} class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ul>
            <For each={prepared()}>
              {(held) => {
                const here = (): boolean =>
                  (scope() === "book" ? selectedBook()?.book.bookId : activeBook()) ===
                  held.book.bookId;
                const done = (): boolean =>
                  held.shown.length > 0 && decidedOf(held) === held.shown.length;
                return (
                  <li>
                    <button
                      type="button"
                      data-outline={held.book.bookId}
                      data-focused={here() ? "" : undefined}
                      aria-current={here() ? "true" : undefined}
                      class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-small transition-colors data-focused:bg-sidebar-surface-active data-focused:font-medium data-focused:text-brand not-data-focused:text-sidebar-on-surface not-data-focused:hover:bg-sidebar-surface-hover"
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
                        {`${decidedOf(held)}/${held.shown.length}`}
                      </span>
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </nav>
      </div>
    )),
  );

  /** The card being edited in the result pane, and its book, once seated. */
  const [editing, setEditing] = createSignal<
    { readonly key: string; readonly book: EditorBook | undefined } | undefined
  >(undefined, { name: "reviewEditing" });
  const editable = (): boolean => props.mode === "result" && props.resultAvailable;
  const startEdit = (hunk: Hunk): void => {
    setEditing({ key: hunk.key, book: undefined });
    void props.seat(hunk.bookId).then((book) => {
      if (untrack(editing)?.key === hunk.key) setEditing({ key: hunk.key, book });
    });
  };
  const finishEdit = (bookId: BookId): void => {
    setEditing(undefined);
    props.onEdited(bookId);
  };
  const analyzeLive = services.galley.memoize();

  /**
   * The whole book's current pane, live: in Result mode with the working text
   * on the left, the Book itself is seated and edited in place, the diff drawn
   * on it as a plugin. The same parse the reading prepared is lent to it.
   */
  const [liveBook, setLiveBook] = createSignal<
    { readonly bookId: BookId; readonly book: EditorBook } | undefined
  >(undefined, { name: "reviewLiveBook" });
  createEffect(
    () => (scope() === "book" && editable() ? selectedBook()?.book.bookId : undefined),
    (bookId) => {
      if (bookId === undefined) {
        setLiveBook(undefined);
        return;
      }
      // Already seated: seating again would hand the pane a new object, and a
      // new object is a rebuilt view — under the caret of somebody typing.
      if (untrack(liveBook)?.bookId === bookId) return;
      let current = true;
      void props.seat(bookId).then((book) => {
        if (current) setLiveBook(book === undefined ? undefined : { bookId, book });
      });
      return () => {
        current = false;
      };
    },
  );
  /**
   * An edit in the live pane, announced. A satellite's edit lands in the Book
   * but does not move the shell's stamp for it, so the review — which re-takes
   * its comparison when a stamp moves — would never see it. Debounced: a burst
   * of typing is one comparison after the burst, as everywhere on this screen.
   */
  createEffect(
    () => liveBook(),
    (held) => {
      if (held === undefined) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = held.book.changes(() => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => props.onEdited(held.bookId), 150);
      });
      return () => {
        if (timer !== undefined) clearTimeout(timer);
        stop();
      };
    },
  );

  /** One object per seated book: a new one would rebuild the live pane. */
  const live = createMemo(
    () => {
      const seated = liveBook();
      if (seated === undefined) return undefined;
      const staticBookId = seated.bookId;
      return {
        bookId: staticBookId,
        book: seated.book,
        analyze: (text: string) => analysisOf(staticBookId, "current", text),
      };
    },
    {
      name: "reviewLive",
      // The same seated Book is the same live pane.
      equals: (a, b) => a?.book === b?.book && a?.bookId === b?.bookId,
    },
  );
  const liveFor = (bookId: BookId) => {
    const held = live();
    return held !== undefined && held.bookId === bookId ? held : undefined;
  };

  let observer: ResizeObserver | undefined;
  const measure = (element: HTMLDivElement): void => {
    observer?.disconnect();
    observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box !== undefined) setWidth(box.width);
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
          onChange={(value) => (value === "book" ? setScope("book") : backToCards())}
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
        <Select
          size="sm"
          wrapperClass="min-w-0"
          aria-label={t("Which changes")}
          data-review-filter
          value={filter()}
          onChange={(event) => {
            setFilter(toFilter(event.currentTarget.value));
            setPlace(undefined);
          }}
        >
          <option value="all">{t("All changes")}</option>
          <option value="words">{t("Changes to the words")}</option>
          <option value="formatting">{t("Markup and spacing only")}</option>
        </Select>
        <Menu
          label={t("View")}
          side="bottom"
          align="start"
          class="w-64"
          trigger={
            <Button size="sm" variant="tertiary" data-review-view>
              <Columns2 size={14} aria-hidden="true" />
              {t("View")}
              <ChevronDown size={14} aria-hidden="true" />
            </Button>
          }
        >
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
          <MenuLabel>{t("Decisions")}</MenuLabel>
          <MenuRadio checked={props.mode === "compare"} onSelect={() => props.onMode("compare")}>
            {t("Decide, then apply")}
          </MenuRadio>
          <MenuRadio
            checked={props.mode === "result"}
            disabled={!props.resultAvailable}
            title={
              props.resultAvailable
                ? undefined
                : t("Only when this project, in the editor, is the left side")
            }
            onSelect={() => props.onMode("result")}
          >
            {t("Write each into the editor (editable result)")}
          </MenuRadio>
          <MenuSeparator />
          <MenuCheckbox checked={props.usfm} onChange={props.onUsfm}>
            {t("Show USFM markup")}
          </MenuCheckbox>
        </Menu>
        <div class="ms-auto flex items-center gap-1">
          <span class="text-smallest text-on-surface-tertiary tabular-nums" data-review-counter>
            {counter()}
          </span>
          <IconButton
            size="sm"
            label={t("Previous change (Alt-Shift-F5)")}
            icon={<ArrowUp size={14} />}
            onClick={() => step(-1)}
          />
          <IconButton
            size="sm"
            label={t("Next change (Alt-F5)")}
            icon={<ArrowDown size={14} />}
            onClick={() => step(1)}
          />
        </div>
      </div>

      <Show
        when={scope() === "changes"}
        fallback={
          <Show when={selectedBook()} fallback={<EmptyState title={t("Preparing…")} />}>
            {(held) => (
              <div class="flex min-h-0 flex-1 flex-col gap-2">
                <div class="flex flex-wrap items-center gap-2 border-b border-surface-border pb-1.5">
                  <Select
                    size="sm"
                    wrapperClass="min-w-0"
                    aria-label={t("Which book to review")}
                    data-review-reader-book
                    value={held().book.bookId}
                    onChange={(event) => pickBook(event.currentTarget.value)}
                  >
                    <For each={prepared()}>
                      {(entry) => (
                        <option value={entry.book.bookId}>
                          {`${entry.book.name} (${entry.shown.length})`}
                        </option>
                      )}
                    </For>
                  </Select>
                  <Badge tone="muted">
                    {t("{decided} decided of {total}", {
                      decided: decidedOf(held()),
                      total: held().shown.length,
                    })}
                  </Badge>
                  <div class="ms-auto">
                    <BookActions held={held()} />
                  </div>
                </div>
                <BookDiff
                  class="min-h-0 flex-1"
                  sides={held().sides}
                  units={held().units}
                  split={split()}
                  usfm={props.usfm}
                  controls={controls().get(held().book.bookId)}
                  currentLabel={props.currentLabel}
                  baselineLabel={props.baselineLabel}
                  currentFirst
                  observability={observability}
                  initial={opened()?.unit}
                  live={liveFor(held().book.bookId)}
                  ref={(api) => {
                    book = api;
                  }}
                  onPlace={placeFrom}
                />
              </div>
            )}
          </Show>
        }
      >
        <div
          class="flex min-h-0 flex-1"
          ref={(element) => {
            listRoot = element;
          }}
        >
          <VirtualList<{ hunk: Hunk; held: Prepared }>
            sections={sections()}
            ref={(scrollTo) => {
              goTo = scrollTo;
            }}
            onActive={(bookId) => {
              setActiveBook(bookId);
              props.onSelect(bookId);
            }}
            header={(section, ref) => {
              const held = () => prepared().find((entry) => entry.book.bookId === section().key);
              return (
                <header
                  ref={ref}
                  class="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-surface-border bg-surface-secondary/95 px-1 py-1.5 backdrop-blur-xs"
                  data-review-section={section().key}
                >
                  <strong class="text-small font-semibold">
                    {held()?.book.name ?? section().key}
                  </strong>
                  <span class="text-smallest text-on-surface-tertiary">
                    {t("{cards} cards · {decided} of {total} decided", {
                      cards: section().rows.length,
                      decided: decidedOf(held()),
                      total: held()?.shown.length ?? 0,
                    })}
                  </span>
                  <div class="ms-auto">
                    <Show when={held()}>{(found) => <BookActions held={found()} />}</Show>
                  </div>
                </header>
              );
            }}
            row={(item) => (
              <div class="pt-3">
                <Show
                  when={editing()?.key === item().hunk.key}
                  fallback={
                    <DiffCard
                      hunk={item().hunk}
                      sides={item().held.sides}
                      split={split()}
                      usfm={props.usfm}
                      controls={controls().get(item().hunk.bookId)}
                      currentLabel={props.currentLabel}
                      baselineLabel={props.baselineLabel}
                      currentFirst
                      onOpen={() => openInBook(item().hunk)}
                      actions={
                        <>
                          <CardDecision hunk={item().hunk} />
                          <Show when={editable()}>
                            <IconButton
                              size="sm"
                              label={t("Edit the result here")}
                              icon={<Pencil size={14} />}
                              data-review-edit
                              onClick={() => startEdit(item().hunk)}
                            />
                          </Show>
                          <IconButton
                            size="sm"
                            label={t("Open in the book")}
                            icon={<BookOpen size={14} />}
                            onClick={() => openInBook(item().hunk)}
                          />
                        </>
                      }
                    />
                  }
                >
                  <div
                    class="overflow-hidden rounded-lg border border-brand bg-surface-primary"
                    data-review-editing={item().hunk.key}
                  >
                    <header class="flex items-center gap-2 border-b border-surface-border px-3 py-1.5">
                      <strong class="text-small font-medium tabular-nums">
                        {hunkLabel(item().hunk)}
                      </strong>
                      <span class="text-smallest text-on-surface-tertiary">
                        {t("Editing {source}", { source: props.currentLabel })}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        class="ms-auto"
                        onClick={() => finishEdit(item().hunk.bookId)}
                      >
                        {t("Done")}
                      </Button>
                    </header>
                    <Show
                      when={editing()?.book}
                      fallback={
                        <p class="px-3 py-2 text-small text-on-surface-tertiary">{t("Opening…")}</p>
                      }
                    >
                      {(book) => (
                        <ResultEditor
                          book={book()}
                          range={item().hunk.current}
                          usfm={props.usfm}
                          analyze={analyzeLive}
                          label={`review:${item().hunk.key}`}
                          onDone={() => finishEdit(item().hunk.bookId)}
                        />
                      )}
                    </Show>
                  </div>
                </Show>
              </div>
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

const toFilter = (value: string): Filter =>
  value === "words" || value === "formatting" ? value : "all";

const toLayout = (value: string): Layout =>
  value === "split" || value === "unified" ? value : "auto";
