import type { BookId } from "@sefer/text/book";
import { createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js";

import type { DecisionUnit } from "#core/galley";

import { registerCommand } from "../../../commands";
import { t } from "../../../i18n";
import type { BookDiffApi, Hunk } from "../../diff";
import { cardOnScreen, chapterOf, stepTarget, visibleCardIndex } from "./helpers";
import type { Observability, Prepared, Scope } from "./types";

export interface CursorOptions {
  readonly scope: Accessor<Scope>;
  readonly setScope: (scope: Scope) => void;
  readonly prepared: Accessor<readonly Prepared[]>;
  readonly selectedBook: () => Prepared | undefined;
  readonly onSelect: (bookId: BookId) => void;
  readonly observability: Observability;
}

export interface Cursor {
  readonly place: Accessor<number | undefined>;
  readonly setPlace: (place: number | undefined) => void;
  readonly opened: Accessor<{ readonly unit: DecisionUnit; readonly card: string } | undefined>;
  readonly activeBook: Accessor<BookId | undefined>;
  readonly cardKeys: Accessor<readonly string[]>;
  readonly step: (delta: 1 | -1) => void;
  readonly counter: () => string;
  readonly placeFrom: (unit: DecisionUnit | undefined) => void;
  readonly openInBook: (hunk: Hunk) => void;
  readonly goToChapter: (chapter: number) => void;
  readonly enterBook: () => void;
  readonly backToCards: () => void;
  readonly pickBook: (bookId: BookId) => void;
  readonly setGoTo: (goTo: ((key: string) => void) | undefined) => void;
  readonly setBook: (api: BookDiffApi | undefined) => void;
  readonly setListRoot: (root: HTMLDivElement | undefined) => void;
}

interface CursorRefs {
  goTo: ((key: string) => void) | undefined;
  book: BookDiffApi | undefined;
  listRoot: HTMLDivElement | undefined;
  steeredAt: number;
}

interface CursorSignals {
  readonly place: Accessor<number | undefined>;
  readonly setPlace: (place: number | undefined) => void;
  readonly opened: Accessor<{ readonly unit: DecisionUnit; readonly card: string } | undefined>;
  readonly setOpened: (
    opened: { readonly unit: DecisionUnit; readonly card: string } | undefined,
  ) => void;
  readonly setActiveBook: (bookId: BookId | undefined) => void;
  readonly cardKeys: Accessor<readonly string[]>;
}

const STEER_MS = 800;

const startOf = (unit: DecisionUnit): number => unit.current?.from ?? unit.place.current;
const endOf = (unit: DecisionUnit): number => unit.current?.to ?? unit.place.current;

function unitTarget(
  shown: readonly DecisionUnit[],
  mid: number | undefined,
  delta: 1 | -1,
): number | undefined {
  if (mid === undefined) return delta > 0 ? 0 : shown.length - 1;
  const on = shown.findIndex((unit) => startOf(unit) <= mid && mid <= endOf(unit));
  if (delta > 0) {
    const found = shown.findIndex((unit, index) => index !== on && startOf(unit) > mid);
    return found < 0 ? undefined : found;
  }
  for (let index = shown.length - 1; index >= 0; index -= 1) {
    const unit = shown[index];
    if (unit !== undefined && index !== on && startOf(unit) < mid) return index;
  }
  return undefined;
}

function stepCards(refs: CursorRefs, signals: CursorSignals, delta: 1 | -1): void {
  const { cardKeys, place, setPlace } = signals;
  const keysNow = untrack(cardKeys);
  if (keysNow.length === 0) return;
  const at = untrack(place);
  const held = at !== undefined && cardOnScreen(refs.listRoot, keysNow[at]) ? at : undefined;
  const from = held ?? visibleCardIndex(refs.listRoot, untrack(cardKeys)) ?? 0;
  const to = stepTarget(held, at, from, delta, keysNow.length - 1);
  const key = keysNow[to];
  if (key === undefined) return;
  refs.goTo?.(key);
  setPlace(to);
}

function stepUnits(
  options: CursorOptions,
  refs: CursorRefs,
  signals: CursorSignals,
  delta: 1 | -1,
): void {
  const { setPlace, setOpened } = signals;
  refs.steeredAt = performance.now();
  const all = untrack(options.prepared);
  const held = untrack(options.selectedBook);
  if (held === undefined) return;
  const shown = held.shown;
  const to = unitTarget(shown, refs.book?.middle(), delta);
  const unit = to === undefined ? undefined : shown[to];
  if (unit !== undefined && to !== undefined) {
    refs.book?.showUnit(unit);
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
    options.onSelect(next.book.bookId);
    return;
  }
  const edge = delta > 0 ? shown.length - 1 : 0;
  const last = shown[edge];
  if (last !== undefined) {
    refs.book?.showUnit(last);
    setPlace(edge);
  }
}

function createStep(options: CursorOptions, refs: CursorRefs, signals: CursorSignals) {
  const { scope, observability } = options;
  const step = (delta: 1 | -1): void => {
    const done = observability.span("review.diff.step", scope());
    if (untrack(scope) === "changes") stepCards(refs, signals, delta);
    else stepUnits(options, refs, signals, delta);
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
  return step;
}

function createPlacing(options: CursorOptions, refs: CursorRefs, signals: CursorSignals) {
  const { setScope, prepared, selectedBook } = options;
  const { setPlace, setOpened } = signals;

  const placeFrom = (unit: DecisionUnit | undefined): void => {
    if (performance.now() - refs.steeredAt < STEER_MS) return;
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
    refs.steeredAt = performance.now();
    setOpened({ unit: first, card: hunk.key });
    options.onSelect(hunk.bookId);
    setScope("book");
    const held = untrack(prepared).find((entry) => entry.book.bookId === hunk.bookId);
    setPlace(held?.shown.indexOf(first));
  };

  const goToChapter = (chapter: number): void => {
    const held = untrack(selectedBook);
    const index = held?.shown.findIndex((unit) => chapterOf(unit) === chapter) ?? -1;
    const unit = held?.shown[index];
    if (unit === undefined) return;
    refs.steeredAt = performance.now();
    refs.book?.showUnit(unit);
    setPlace(index);
  };

  return { placeFrom, openInBook, goToChapter };
}

function createSwitching(options: CursorOptions, refs: CursorRefs, signals: CursorSignals) {
  const { scope, setScope, selectedBook } = options;
  const { opened, setPlace, setOpened, setActiveBook } = signals;

  const enterBook = (): void => {
    const first = untrack(selectedBook)?.shown[0];
    if (untrack(opened) === undefined && first !== undefined) {
      refs.steeredAt = performance.now();
      setOpened({ unit: first, card: "" });
      setPlace(0);
    }
    setScope("book");
  };

  const backToCards = (): void => {
    const card = untrack(opened)?.card;
    setScope("changes");
    setPlace(undefined);
    if (card !== undefined && card !== "") requestAnimationFrame(() => refs.goTo?.(card));
  };

  const pickBook = (bookId: BookId): void => {
    setActiveBook(bookId);
    options.onSelect(bookId);
    setPlace(undefined);
    setOpened(undefined);
    if (untrack(scope) === "changes") refs.goTo?.(bookId);
  };

  return { enterBook, backToCards, pickBook };
}

export function createCursor(options: CursorOptions): Cursor {
  const { scope, prepared, selectedBook } = options;

  const [place, setPlace] = createSignal<number | undefined>(undefined, { name: "reviewPlace" });
  const [opened, setOpened] = createSignal<
    { readonly unit: DecisionUnit; readonly card: string } | undefined
  >(undefined, { name: "reviewOpened" });
  const [activeBook, setActiveBook] = createSignal<BookId | undefined>(undefined, {
    name: "reviewActiveBook",
  });

  const refs: CursorRefs = { goTo: undefined, book: undefined, listRoot: undefined, steeredAt: 0 };

  const cardKeys = createMemo(
    () => prepared().flatMap((held) => held.hunks.map((hunk) => hunk.key)),
    { name: "reviewCardKeys" },
  );
  const signals: CursorSignals = {
    place,
    setPlace,
    opened,
    setOpened,
    setActiveBook,
    cardKeys,
  };

  const step = createStep(options, refs, signals);

  const counter = (): string => {
    const total = scope() === "changes" ? cardKeys().length : (selectedBook()?.shown.length ?? 0);
    const at = place();
    return at === undefined
      ? t("{total} changes", { total })
      : t("{at} of {total}", { at: at + 1, total });
  };

  return {
    place,
    setPlace,
    opened,
    activeBook,
    cardKeys,
    step,
    counter,
    ...createPlacing(options, refs, signals),
    ...createSwitching(options, refs, signals),
    setGoTo: (next) => {
      refs.goTo = next;
    },
    setBook: (api) => {
      refs.book = api;
    },
    setListRoot: (root) => {
      refs.listRoot = root;
    },
  };
}
