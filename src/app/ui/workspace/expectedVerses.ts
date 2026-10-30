import { type ExpectedVerses } from "@sefer/editor";
import { createSignal } from "solid-js";

import type { BookToc } from "#core/galley";

/**
 * Each book's expected verses per chapter, from the reference text open
 * beside it (`lastVerses` of its census): the reference pane writes it, the
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

/** Each chapter's last verse in the engine's census: `\c 23` … `\v 6` → `"23"` → 6. */
export const lastVerses = (census: BookToc): ExpectedVerses => {
  const out = new Map<string, number>();
  const rows = census.chapterRows;
  for (let n = 1; n < census.chapterCount; n++) {
    const row = rows.seek(n);
    if (row.number > 0 && row.lastVerse > 0) out.set(String(row.number), row.lastVerse);
  }
  return out;
};
