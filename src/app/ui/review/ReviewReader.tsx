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
  Select,
  type VirtualSection,
} from "../primitives";
import { ChangesHistorySidebar } from "../workspace/ChangesHistorySidebar";
import { Crumbs, LocationStrip, type CrumbChapter } from "../workspace/Crumbs";
import { FollowToggle } from "../workspace/FollowToggle";
import { claimSidebar } from "../workspace/sidebarSlot";

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
  /**
   * The left side is the working text: every card edits the Book on a
   * double-click, and a decision is written into it as it is made. False when
   * neither side can be written — the review is for reading, with no Edit, no
   * double-click and no decisions.
   */
  readonly decidable: boolean;
  readonly usfm: boolean;
  readonly onUsfm: (on: boolean) => void;
  /** Who changed a card's passage, in a review against the shared project. */
  readonly originOf?: (
    bookId: BookId,
    units: readonly DecisionUnit[],
  ) => "there" | "here" | "both" | undefined;
  /** What each side calls itself, in a split's captions — per book where the sides differ by book. */
  readonly currentLabel: string | ((bookId: BookId) => string);
  readonly baselineLabel: string | ((bookId: BookId) => string);
  readonly currentShort: string;
  readonly baselineShort: string;
  readonly selected: BookId | undefined;
  readonly onSelect: (bookId: BookId) => void;
  /** The book, seated for editing: the result pane's Edit. */
  readonly seat: (bookId: BookId) => Promise<EditorBook | undefined>;
  /** An edit made in the result pane was accepted. */
  readonly onEdited: (bookId: BookId) => void;
  /** Whether a card is being edited: while it is, the reader must stay mounted. */
  readonly onEditing?: (editing: boolean) => void;
  /**
   * Whether a split puts the current side (the working text) on the left.
   * Off by default: the other side — the file, the shared project, the
   * version before — on the left and the text you edit on the right, read
   * left to right as was-then-now, the way History lays out time.
   */
  readonly currentFirst?: boolean;
  /**
   * When neither side is the Book (History's "what this version changed"):
   * each card's own actions for either side — Adopt, written into the
   * reader's text instead of a decision — and a row under it. In a split they
   * sit under each side's caption; unified, in the card's header.
   */
  /**
   * Whether the reader lists its books in the sidebar, under the Changes tab
   * (Review, the default). History leaves the sidebar to its own timeline.
   */
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

  /**
   * Each card's own widening, by its key — the verse's address — as Find's
   * feed keeps them: the extent is the card's, and a card that scrolls out of
   * the window and back must keep what the reader asked to see.
   */
  const views = createCardViews<never>("review");
  const expand = (key: string, step: ContextStep): void => {
    const steps = services.settings.get(keys.excerptContext);
    views.send(key, { kind: "step", step, from: { up: steps, down: steps } });
  };
  /** The widenings of one book's cards, as a value: what re-prepares that book. */
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
    const include = FILTERS[show];
    // In an editable review a taken unit is unchanged now — it IS the other side's
    // text — and still keeps its card, to say so and to put it back.
    const keep = (unit: DecisionUnit): boolean =>
      result && untrack(() => props.decision(book.bookId, unit.id)) !== undefined;
    return {
      book,
      sides,
      units,
      shown: units.filter((unit) => (changed(unit) && include(unit)) || keep(unit)),
      hunks: hunksOf({
        // Read as of now: cards are built in the prepare effect, and a book's
        // name is not something a review follows while it is open.
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
    `${show}\0${result ? "r" : "c"}\0${book.currentText.length}\0${book.baselineText.length}\0${extentsOf(book.bookId)}`;
  const same = (was: Prepared, book: ReviewBook): boolean =>
    was.book.currentText === book.currentText && was.book.baselineText === book.baselineText;

  createEffect(
    () => ({
      books: props.books,
      show: filter(),
      result: props.decidable,
      // A card widened re-prepares its book (and only it: the key says which).
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
          live: props.decidable,
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

  /** Whether the card with this key is drawn and inside the list's window. */
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
    // From the card last stepped to while it is still on screen; otherwise
    // from the card at the top, so a reader who scrolled is stepped from where
    // they are, and the first "next" lands on that card rather than skipping
    // it. (From the top card alone, the last few cards — on screen together,
    // with nothing below to scroll to — could never be reached.)
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

  /**
   * When the reader was last moved for them. The book view reports its place
   * as it scrolls, and the reports that follow a step — the mount, the scroll
   * the step caused — describe the line at the top, which is not always the
   * change stepped to. For a moment after a step, the step is the answer.
   */
  let steeredAt = 0;
  const STEER_MS = 800;

  /**
   * The next or previous change from WHERE THE READER IS — the middle of
   * their pane, read at the click — not from a remembered place: scroll away
   * and the step counts from where you scrolled to. The change sitting at the
   * middle is the one you are on, and is skipped both ways; with nothing
   * further in this book, the step crosses into the next (or previous) book
   * that has one, and with nothing anywhere it shows the nearest again, so a
   * change is never lost to a scroll.
   */
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
    // Nothing further anywhere: the last (or first) change again.
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

  /** The chapter a unit is in; 0 for the front matter. */
  const chapterOf = (unit: DecisionUnit): number => {
    const addr = unit.currentAddr ?? unit.baselineAddr;
    return addr === undefined || addr.kind === "frontMatter" ? 0 : addr.chapter;
  };
  /** The book's chapters that have changes the filter shows, with how many. */
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
  /** The chapter of the change the reader is at: the first change until they move. */
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
  /** The chapter with changes before or after the one the reader is at. */
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
  /** Whether the two texts scroll together: the chain in the strip. */
  const [linked, setLinked] = createSignal(true, { name: "reviewLinked" });

  /** To the first change in a chapter; the other pane comes with it. */
  const goToChapter = (chapter: number): void => {
    const held = untrack(selectedBook);
    const index = held?.shown.findIndex((unit) => chapterOf(unit) === chapter) ?? -1;
    const unit = held?.shown[index];
    if (unit === undefined) return;
    steeredAt = performance.now();
    book?.showUnit(unit);
    setPlace(index);
  };

  /** Into the whole book at its first change — not at the title page. */
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

  /** The book last picked in the sidebar: the row it highlights in Changes. */
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

  // --- the pieces --------------------------------------------------------------

  /**
   * The bulk decision, for what the view shows: every book in Changes, the
   * book on screen in Whole book — always over the changes the kind filter
   * shows, which is what makes "all" a question somebody can answer.
   */
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
            <Button size="sm" variant="secondary" data-review-decide-all>
              {t("Decide all")}
              <ChevronDown aria-hidden="true" />
            </Button>
          }
        >
          <MenuLabel>
            {scope() === "changes"
              ? t("{count} change(s) in {books} book(s)", {
                  count: scopeCount(),
                  books: inScope().filter((held) => held.shown.length > 0).length,
                })
              : t("{count} change(s) in {book}", {
                  count: scopeCount(),
                  book: inScope()[0]?.book.name ?? "",
                })}
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

  /**
   * A card's decision, said in words in its header: most cards hold one
   * change, and a reader deciding it should not have to learn what a gutter
   * glyph means. Pressed when every change in the card has that side; pressing
   * it again clears them.
   */
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
    // In the columns' order: the other side's on the left, yours on the right.
    // Both at Edit's weight — deciding is what this card is for, so its two
    // buttons are not the quietest thing on it — and the pressed one says
    // which side was chosen. Pressed again it puts the passage back, which it
    // no longer spells out ("— put back" read as an instruction on every card).
    return [
      {
        kind: "button",
        id: "take",
        emphasis: "secondary",
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
        emphasis: "secondary",
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

  /**
   * The sidebar navigates the CHANGES, as Find's does its results: one row per
   * book that differs, with how many of its changes are decided. A row goes to
   * the book — its section in Changes, the book itself in Whole book — and its
   * menu decides the whole book, which is why the list itself has no headers.
   */
  if (untrack(() => props.claimSidebar) !== false)
    onCleanup(
      claimSidebar(() => (
        <ChangesHistorySidebar active="changes" changes={prepared().length}>
          <div class="px-4 pt-3 pb-2">
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

  /**
   * A card can be edited whenever its current side IS the working text — this
   * project, in the editor — in either mode: the modes differ in what a
   * decision does, not in whether the text is yours. Two zips are read only.
   */
  const editable = (): boolean => props.decidable;

  /**
   * An editable review's working text, live: every book in the review, seated once,
   * so each card and the whole book can be the Book itself — an editor with
   * the diff as a plugin on it — rather than a view of a copy. A seated book is
   * held by identity: a new object would rebuild every live pane of it.
   */
  const [seats, setSeats] = createSignal<ReadonlyMap<BookId, EditorBook>>(new Map(), {
    name: "reviewSeats",
  });
  createEffect(
    // Only the whole book's current pane is always live; a card seats its own
    // book when an edit starts (`DiffCard`, `CardList`).
    () => {
      const bookId = scope() === "book" && editable() ? selectedBook()?.book.bookId : undefined;
      return bookId === undefined ? [] : [bookId];
    },
    (bookIds) => {
      // Nothing to seat is often a moment, not a decision: the selected book
      // drops out while a comparison re-prepares the list. Releasing the seat
      // then made the whole book's views build without it, and build again
      // when it came back. A seat is the project's own Book, held by identity
      // — keeping it costs nothing.
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
    // One array per run, compared by content: a new comparison of the same
    // books is not a reason to look at the seats again.
  );

  /** One live handle per seated book, the same object for as long as the seat. */
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
      // Zero is a hidden reader (behind Review's settled card), not a narrow
      // one: taking it would flip an auto layout to unified and rebuild every
      // view for the moment it is out of sight.
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
              <Columns2 aria-hidden="true" />
              {t("View")}
              <ChevronDown aria-hidden="true" />
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
          <MenuCheckbox checked={props.usfm} onChange={props.onUsfm}>
            {t("Show USFM markup")}
          </MenuCheckbox>
        </Menu>
        <div class="ms-auto flex items-center gap-1">
          <DecideAll />
          <Show when={props.decidable && scopeCount() > 0}>
            <span aria-hidden="true" class="mx-1 h-4 w-px bg-surface-border" />
          </Show>
          <span class="text-smallest text-on-surface-tertiary tabular-nums" data-review-counter>
            {counter()}
          </span>
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
          // Keyed on the BOOK, not on its prepared entry: a comparison
          // replaces the entry for the same book, and keyed on the entry,
          // the whole book's two editors were torn down and built again.
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
                  {/* The editor's location strip, over what changed: Book ·
                    Chapter listing only the books and chapters with changes,
                    each with how many; the arrows step chapter to chapter;
                    the chain links the two texts' scrolling, as a reference
                    pane's does. */}
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
                  {/* Not before the reader has a width: "side by side when there
                    is room" cannot answer at zero, and answering unified then
                    split built every view twice. */}
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
            // A card is keyed by its verse's address, so typing into it never
            // moves its key; an edit that ends its change leaves it held as
            // "No longer a change" — never handed to a neighbour.
            goneLabel={t("No longer a change")}
            // Held by the edit that ended it: nothing left to paint or decide.
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

const toFilter = (value: string): Filter =>
  value === "words" || value === "formatting" ? value : "all";

const toLayout = (value: string): Layout =>
  value === "split" || value === "unified" ? value : "auto";
