/**
 * Where the verses of a text are, asked of the engine.
 *
 * `src/core/diff/verses.ts` aligns two books verse by verse and is deliberately
 * engine-free; this is the half that knows what a `\v` is, which in Sefer means
 * the half that calls `Galley.analyze`. It is the only new engine call the
 * review screen makes, and it makes it for the DISK text — the working text has
 * been parsed already, but the bytes in the file have not, and a side-by-side
 * view needs both sides addressed the same way.
 *
 * One parse per text, memoised by the caller against the text itself. `analyze`
 * is synchronous and per-gesture by design (see `src/core/galley/galley.ts`),
 * so the cost is one book parse when a reviewer opens a book — not one per
 * render and never one per keystroke.
 */

import type { VerseSpan } from "../../../core/diff/verses";
import type { GalleyService } from "../../../core/galley";

/**
 * The last few texts asked about, by their own content.
 *
 * The review screen re-derives its rows whenever the shell ticks, and a tick
 * costs one parse per side per book without this. Keyed on the text itself, so
 * there is nothing to invalidate: a text that has changed is a different key.
 * Small and bounded — two sides of one book, plus room to switch between a
 * couple of books without re-parsing.
 */
const CACHE_LIMIT = 6;
const cache = new Map<string, readonly VerseSpan[]>();

const remember = (text: string, spans: readonly VerseSpan[]): readonly VerseSpan[] => {
  cache.set(text, spans);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done === true) break;
    cache.delete(oldest.value);
  }
  return spans;
};

/**
 * Every verse of the text, plus each chapter's front matter, as half-open
 * ranges that tile the whole document.
 *
 * "Tile the whole document" is the property that matters: a side-by-side view
 * whose spans had gaps would silently hide whatever fell between them, and a
 * review screen that hides text is worse than no review screen. So a chapter
 * opens with a front-matter row covering everything before its first `\v`
 * (which is where headings, section titles and the id line live), and the last
 * verse of a chapter runs to the chapter's end.
 */
export const verseSpans = (galley: GalleyService, text: string): readonly VerseSpan[] => {
  if (text === "") return [];
  const held = cache.get(text);
  if (held !== undefined) return held;
  return remember(text, spansOf(galley, text));
};

const spansOf = (galley: GalleyService, text: string): readonly VerseSpan[] => {
  let toc;
  try {
    toc = galley.analyze(text).dish.toc;
  } catch {
    // A text the engine will not parse still has to be reviewable — the whole
    // document becomes one span, and the side-by-side view degrades into a
    // two-column whole-file comparison rather than refusing to draw.
    return [{ chapter: 0, verse: 0, lastVerse: 0, from: 0, to: text.length }];
  }

  const chapters = toc.chapters();
  const verses = toc.verses();
  if (chapters.length === 0)
    return [{ chapter: 0, verse: 0, lastVerse: 0, from: 0, to: text.length }];

  const spans: VerseSpan[] = [];
  let index = 0;
  for (const chapter of chapters) {
    const mine: typeof verses = [];
    while (index < verses.length) {
      const verse = verses[index];
      if (verse === undefined || verse.at >= chapter.to) break;
      if (verse.at >= chapter.from) mine.push(verse);
      index += 1;
    }
    // The chapter's own opening: `\c 5`, a heading, a section title. Present
    // even when empty, so the two sides align on it as they do on a verse.
    const firstAt = mine[0]?.at ?? chapter.to;
    if (firstAt > chapter.from)
      spans.push({
        chapter: chapter.number,
        verse: 0,
        lastVerse: 0,
        from: chapter.from,
        to: firstAt,
      });
    mine.forEach((verse, at) => {
      spans.push({
        chapter: chapter.number,
        verse: verse.first,
        lastVerse: verse.last,
        from: verse.at,
        to: mine[at + 1]?.at ?? chapter.to,
      });
    });
  }

  // Anything the chapter table did not cover — a document with no `\c` at all,
  // or a trailing byte past the last chapter's end.
  const first = spans[0];
  if (first !== undefined && first.from > 0)
    spans.unshift({ chapter: 0, verse: 0, lastVerse: 0, from: 0, to: first.from });
  const last = spans.at(-1);
  if (last === undefined) return [{ chapter: 0, verse: 0, lastVerse: 0, from: 0, to: text.length }];
  // Stretched rather than followed by a row of its own: a second
  // `chapter:0:0` row would collide with the chapter's front matter in the
  // alignment key, and a trailing newline is not a reference.
  if (last.to < text.length) spans[spans.length - 1] = { ...last, to: text.length };
  return spans;
};
