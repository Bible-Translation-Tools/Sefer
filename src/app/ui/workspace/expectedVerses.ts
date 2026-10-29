import { type ExpectedVerses } from "@sefer/editor";
import { createSignal } from "solid-js";

/**
 * Each book's expected verses per chapter, counted from the reference text
 * open beside it (`expectedVersesOf`): the reference pane writes it, the
 * editor reads it, so typed and pasted numbers past a chapter's end stay words.
 * The last reference to load wins; none, and nothing is capped.
 */
const [held, setHeld] = createSignal<ReadonlyMap<string, ExpectedVerses>>(new Map(), {
  name: "expectedVerses",
});

export const expectedVersesFor = (bookId: string): ExpectedVerses | undefined => held().get(bookId);

export const supplyExpectedVerses = (bookId: string, expected: ExpectedVerses): (() => void) => {
  setHeld((before) => new Map(before).set(bookId, expected));
  return () =>
    setHeld((before) => {
      if (before.get(bookId) !== expected) return before;
      const next = new Map(before);
      next.delete(bookId);
      return next;
    });
};
