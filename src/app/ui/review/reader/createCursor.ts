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

export function createCursor(options: CursorOptions): Cursor {
  const { scope, setScope, prepared, selectedBook, observability } = options;

  const [place, setPlace] = createSignal<number | undefined>(undefined, { name: "reviewPlace" });
  const [opened, setOpened] = createSignal<
    { readonly unit: DecisionUnit; readonly card: string } | undefined
  >(undefined, { name: "reviewOpened" });
  const [activeBook, setActiveBook] = createSignal<BookId | undefined>(undefined, {
    name: "reviewActiveBook",
  });

  let goTo: ((key: string) => void) | undefined;
  let book: BookDiffApi | undefined;
  let listRoot: HTMLDivElement | undefined;

  const cardKeys = createMemo(
    () => prepared().flatMap((held) => held.hunks.map((hunk) => hunk.key)),
    { name: "reviewCardKeys" },
  );

  const stepCards = (delta: 1 | -1): void => {
    const keysNow = untrack(cardKeys);
    if (keysNow.length === 0) return;
    const at = untrack(place);
    const held = at !== undefined && cardOnScreen(listRoot, keysNow[at]) ? at : undefined;
    const from = held ?? visibleCardIndex(listRoot, untrack(cardKeys)) ?? 0;
    const to = stepTarget(held, at, from, delta, keysNow.length - 1);
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
      options.onSelect(next.book.bookId);
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

  const pickBook = (bookId: BookId): void => {
    setActiveBook(bookId);
    options.onSelect(bookId);
    setPlace(undefined);
    setOpened(undefined);
    if (untrack(scope) === "changes") goTo?.(bookId);
  };

  return {
    place,
    setPlace,
    opened,
    activeBook,
    cardKeys,
    step,
    counter,
    placeFrom,
    openInBook,
    goToChapter,
    enterBook,
    backToCards,
    pickBook,
    setGoTo: (next) => {
      goTo = next;
    },
    setBook: (api) => {
      book = api;
    },
    setListRoot: (root) => {
      listRoot = root;
    },
  };
}
