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
import BookOpen from "lucide-solid/icons/book-open";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";

import type { BookId } from "#core/book/book";
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
  SegmentedControl,
  Select,
  VirtualList,
  type VirtualSection,
} from "../primitives";

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
  readonly currentLabel: string;
  readonly baselineLabel: string;
  readonly currentShort: string;
  readonly baselineShort: string;
  readonly selected: BookId | undefined;
  readonly onSelect: (bookId: BookId) => void;
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

  const prepare = (book: ReviewBook, steps: number, show: Filter): Prepared => {
    const sides: DiffSides = {
      bookId: book.bookId,
      currentText: book.currentText,
      baselineText: book.baselineText,
      current: analysisOf(book.bookId, "current", book.currentText),
      baseline: analysisOf(book.bookId, "baseline", book.baselineText),
    };
    const units = ordered(book.skeleton);
    const include = FILTERS[show];
    return {
      book,
      sides,
      units,
      shown: units.filter((unit) => changed(unit) && include(unit)),
      hunks: hunksOf({
        bookId: book.bookId,
        units,
        baseline: sides.baseline,
        current: sides.current,
        steps,
        include,
      }),
    };
  };

  // Books are prepared one per tick, so the first cards are on screen while
  // the rest are still being parsed; a new comparison or filter restarts it.
  createEffect(
    () => ({ books: props.books, show: filter() }),
    ({ books, show }) => {
      const steps = services.settings.get(keys.excerptContext);
      const op = observability.operation("review.diff.prepare", {
        "review.books": books.length,
        "review.filter": show,
      });
      const out: Prepared[] = [];
      let stopped = false;
      let at = 0;
      const next = (): void => {
        if (stopped) return;
        const book = books[at];
        if (book === undefined) {
          op.end("passed", {
            "review.cards": out.reduce((sum, held) => sum + held.hunks.length, 0),
          });
          return;
        }
        at += 1;
        const done = op.span("review.diff.book", book.bookId);
        const held = prepare(book, steps, show);
        done({ "review.units": held.shown.length, "review.cards": held.hunks.length });
        out.push(held);
        setPrepared([...out]);
        setTimeout(next, 0);
      };
      setPrepared([]);
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
    <div class="flex min-w-0 flex-col gap-2" data-review-reader ref={measure}>
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
        <SegmentedControl<Layout>
          size="sm"
          label={t("Layout")}
          value={layout()}
          onChange={setLayout}
          items={[
            { value: "auto", label: t("Auto"), title: t("Side by side when there is room") },
            { value: "split", label: t("Side by side") },
            { value: "unified", label: t("Unified") },
          ]}
        />
        <SegmentedControl<Filter>
          size="sm"
          label={t("Which changes")}
          value={filter()}
          onChange={(value) => {
            setFilter(value);
            setPlace(undefined);
          }}
          items={[
            { value: "all", label: t("All") },
            { value: "words", label: t("Words"), title: t("Changes to what a reader reads") },
            {
              value: "formatting",
              label: t("Markup and spacing"),
              title: t("The words are the same on both sides"),
            },
          ]}
        />
        <Show when={scope() === "book"}>
          <Select
            size="sm"
            wrapperClass="min-w-0"
            aria-label={t("Which book to review")}
            data-review-reader-book
            value={selectedBook()?.book.bookId ?? ""}
            onChange={(event) => pickBook(event.currentTarget.value)}
          >
            <For each={prepared()}>
              {(held) => (
                <option value={held.book.bookId}>
                  {`${held.book.name} (${held.shown.length})`}
                </option>
              )}
            </For>
          </Select>
        </Show>
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
              <div class="flex min-h-0 flex-col gap-2">
                <div class="flex flex-wrap items-center gap-2">
                  <strong class="text-small font-semibold">{held().book.name}</strong>
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
                  class="h-[calc(100vh-220px)] min-h-[420px]"
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
          class="flex h-[calc(100vh-220px)] min-h-[420px]"
          ref={(element) => {
            listRoot = element;
          }}
        >
          <VirtualList<{ hunk: Hunk; held: Prepared }>
            sections={sections()}
            ref={(scrollTo) => {
              goTo = scrollTo;
            }}
            onActive={(bookId) => props.onSelect(bookId)}
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
                      <Show when={props.decidable && item().hunk.units.length > 1}>
                        <Button
                          size="sm"
                          variant="tertiary"
                          onClick={() =>
                            props.decide(item().hunk.bookId, item().hunk.units, "current")
                          }
                        >
                          {t("Keep all here")}
                        </Button>
                        <Button
                          size="sm"
                          variant="tertiary"
                          onClick={() =>
                            props.decide(item().hunk.bookId, item().hunk.units, "baseline")
                          }
                        >
                          {t("Take all here")}
                        </Button>
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

const toLayout = (value: string): Layout =>
  value === "split" || value === "unified" ? value : "auto";
