// search.ts
//
// Project-wide Find, and the one-match-at-a-time Replace behind it (seams
// §3.10). Search is a pure, synchronous scan of canonical text: it takes the
// Books it should look at rather than a Project, so the result browser, a
// satellite window and a test can all call it with whatever set of Books they
// hold, and nothing here needs a lifetime, a service or the engine.
//
// Two rules shape the whole module:
//
//  - Every hit is version-bound. A `Hit` carries the stamp of the text it was
//    found in, and `resolveHit` refuses to hand back coordinates once that
//    stamp has moved. Offsets into text that has since been edited are the
//    classic stale-range bug; the stamp is what makes it a refusal instead.
//  - There is no global Replace All (vision §12.2). `replace` acts on one hit,
//    `replaceInBook` on several hits of ONE book in one `apply`, and
//    `planReplace` shapes those changes for MultiBook's `runAcrossBooks`,
//    which asks per book. Nothing here walks the corpus and rewrites it.
//
// Replacements go through `book.apply(..., "replace", UNTRUSTED)`: the editing
// phases judge them exactly like a keystroke, so a replacement that would
// break markup is refused by the rules rather than by a check here.

import { Data, Result } from "effect";

import { Refusal, UNTRUSTED, type Book, type BookId, type Receipt, type Ref } from "../book/book";
import type { Change, SourceStamp } from "../source/source";

export interface Query {
  /** Literal text, or a regular expression source when `regex` is set. */
  readonly text: string;
  readonly caseSensitive?: boolean;
  /** Both edges of the match must sit against a non-word character. */
  readonly wholeWord?: boolean;
  readonly regex?: boolean;
}

export interface Options {
  /** Total hits across all books, not per book. Defaults to 500. */
  readonly limit?: number;
  /** When given, only these books are scanned, in the order the books arrive. */
  readonly books?: readonly BookId[];
}

/**
 * One match, addressable for as long as its book stays on `stamp`. `from`/`to`
 * are UTF-16 offsets into that revision's canonical text; `preview` is display
 * text only and must never be parsed back into coordinates.
 */
export interface Hit {
  readonly bookId: BookId;
  readonly stamp: SourceStamp;
  readonly from: number;
  readonly to: number;
  readonly ref: Ref;
  readonly preview: string;
}

export class SearchError extends Data.TaggedError("SearchError")<{
  readonly reason: "InvalidRegex";
  readonly description: string;
}> {}

/** Roughly how much of the containing line a result card shows. */
const PREVIEW_WIDTH = 90;

const DEFAULT_LIMIT = 500;

const WORD = /[\p{L}\p{N}_]/u;

const isWordChar = (text: string, index: number): boolean =>
  index >= 0 && index < text.length && WORD.test(text[index] ?? "");

const escapeLiteral = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/**
 * The `\c`/`\v` markers of one text, in order, each with the offset it takes
 * effect at. Built once per text per `find` call so that N hits cost one scan
 * plus N binary searches instead of N scans.
 *
 * This is deliberately a marker scan and not a parse: Galley's TOC is the real
 * answer, and when ProjectAnalysis (slice 15) lands and hands search an
 * analysis for each book, `refAt` should read the TOC instead of this table.
 * Until then a book with no analysis still needs a reference for its cards.
 */
interface RefTable {
  /** Ascending offsets at which the reference changes. */
  readonly at: readonly number[];
  readonly chapter: readonly number[];
  /** 0 means "no verse yet in this chapter". */
  readonly verse: readonly number[];
}

const MARKER = /\\(c|v)[ \t]+(\d+)/g;

const buildRefTable = (text: string): RefTable => {
  const at: number[] = [];
  const chapter: number[] = [];
  const verse: number[] = [];
  let currentChapter = 0;
  let currentVerse = 0;

  MARKER.lastIndex = 0;
  for (let match = MARKER.exec(text); match !== null; match = MARKER.exec(text)) {
    const number = Number(match[2]);
    if (match[1] === "c") {
      currentChapter = number;
      // A chapter marker ends the previous chapter's verse numbering; text
      // between `\c` and the first `\v` belongs to the chapter, not a verse.
      currentVerse = 0;
    } else currentVerse = number;
    at.push(match.index);
    chapter.push(currentChapter);
    verse.push(currentVerse);
  }

  return { at, chapter, verse };
};

/** Index of the last marker at or before `pos`, or -1 when there is none. */
const markerBefore = (table: RefTable, pos: number): number => {
  let low = 0;
  let high = table.at.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    // SAFETY: `middle` is inside [low, high] which is inside the array bounds.
    if (table.at[middle]! <= pos) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
};

const refFrom = (table: RefTable, book: BookId, pos: number): Ref => {
  const index = markerBefore(table, pos);
  if (index < 0) return { book, chapter: 0 };
  // SAFETY: `markerBefore` returned an index into the three parallel arrays.
  const chapter = table.chapter[index]!;
  // SAFETY: same index, same length.
  const verse = table.verse[index]!;
  return verse > 0 ? { book, chapter, verse } : { book, chapter };
};

/**
 * The reference containing `pos`, from the `\c`/`\v` markers before it.
 * `chapter` is 0 when `pos` precedes the first `\c` (front matter); `verse` is
 * absent when no `\v` has opened in that chapter.
 *
 * Convenience wrapper: it builds a marker table for the whole text, so call it
 * for a handful of positions, not once per hit — `find` shares one table.
 */
export const refAt = (text: string, pos: number, book: BookId = ""): Ref =>
  refFrom(buildRefTable(text), book, pos);

// ---------------------------------------------------------------------------
// Find
// ---------------------------------------------------------------------------

const isLowSurrogateAt = (text: string, index: number): boolean => {
  const unit = text.charCodeAt(index);
  return unit >= 0xdc00 && unit <= 0xdfff;
};

/**
 * The containing line, narrowed to about `PREVIEW_WIDTH` characters around the
 * match so a result card gets one short string. Truncated edges are marked
 * with an ellipsis, and boundaries are nudged off surrogate pairs so the
 * preview never contains a lone surrogate.
 */
const previewAt = (text: string, from: number, to: number): string => {
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const lineEndAt = text.indexOf("\n", from);
  const lineEnd = lineEndAt < 0 ? text.length : lineEndAt;

  let start = lineStart;
  let end = lineEnd;
  if (lineEnd - lineStart > PREVIEW_WIDTH) {
    const slack = Math.max(0, PREVIEW_WIDTH - (Math.min(to, lineEnd) - from));
    start = Math.max(lineStart, from - Math.floor(slack / 2));
    end = Math.min(lineEnd, start + PREVIEW_WIDTH);
    start = Math.max(lineStart, end - PREVIEW_WIDTH);
  }
  if (isLowSurrogateAt(text, start)) start += 1;
  if (isLowSurrogateAt(text, end)) end -= 1;

  const body = text.slice(start, end).trim();
  return `${start > lineStart ? "…" : ""}${body}${end < lineEnd ? "…" : ""}`;
};

const matcherFor = (query: Query): Result.Result<RegExp, SearchError> => {
  const source = query.regex ? query.text : escapeLiteral(query.text);
  const flags = query.caseSensitive === true ? "g" : "gi";
  try {
    return Result.succeed(new RegExp(source, flags));
  } catch (error) {
    return Result.fail(
      new SearchError({
        reason: "InvalidRegex",
        description:
          error instanceof Error ? error.message : "the pattern is not a regular expression",
      }),
    );
  }
};

/**
 * Scans each book's canonical text for `query`. Synchronous and allocating
 * only the hits: no index, no engine, no cache — a corpus-sized scan of plain
 * strings is fast enough that keeping a stale index correct would cost more
 * than the scan does.
 *
 * Returns `SearchError` only for a pattern `RegExp` will not accept. An empty
 * query, a book list that matches nothing, and a text with no match are all a
 * successful empty result. Hits arrive in book order then offset order, and
 * stop at `limit` in total; each carries the stamp its book held at scan time,
 * so a hit found before an edit is detectably stale afterwards.
 */
export const find = (
  books: readonly Book[],
  query: Query,
  options?: Options,
): Result.Result<readonly Hit[], SearchError> => {
  if (query.text === "") return Result.succeed([]);

  const matcher = matcherFor(query);
  if (Result.isFailure(matcher)) return Result.fail(matcher.failure);
  const pattern = matcher.success;

  const limit = options?.limit ?? DEFAULT_LIMIT;
  if (limit <= 0) return Result.succeed([]);
  const wanted = options?.books === undefined ? null : new Set(options.books);

  const hits: Hit[] = [];
  for (const book of books) {
    if (wanted !== null && !wanted.has(book.id)) continue;
    const { text, stamp } = book.source();
    const table = buildRefTable(text);

    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
      const from = match.index;
      const to = from + match[0].length;
      // A pattern like `\b` or `x*` can match nothing; advance by hand or the
      // loop never moves.
      if (to === from) pattern.lastIndex = from + 1;

      if (query.wholeWord !== true || (!isWordChar(text, from - 1) && !isWordChar(text, to))) {
        hits.push({
          bookId: book.id,
          stamp,
          from,
          to,
          ref: refFrom(table, book.id, from),
          preview: previewAt(text, from, to),
        });
        if (hits.length >= limit) return Result.succeed(hits);
      }
    }
  }
  return Result.succeed(hits);
};

// ---------------------------------------------------------------------------
// Replace
// ---------------------------------------------------------------------------

const bookFor = (hit: Hit, books: readonly Book[]): Book | undefined =>
  books.find((book) => book.id === hit.bookId);

const isFresh = (hit: Hit, book: Book): boolean =>
  book.source().stamp.revision === hit.stamp.revision;

/**
 * Turns a hit back into live coordinates, or `null` when it cannot be trusted:
 * the book is no longer in `books`, or its text has moved on since the scan.
 * Every action on a result — replace, open a window, scroll to it — goes
 * through here first, so a stale card refuses rather than editing the wrong
 * range.
 */
export const resolveHit = (
  hit: Hit,
  books: readonly Book[],
): { readonly book: Book; readonly from: number; readonly to: number } | null => {
  const book = bookFor(hit, books);
  if (book === undefined || !isFresh(hit, book)) return null;
  return { book, from: hit.from, to: hit.to };
};

const stale = (description: string): Refusal =>
  new Refusal({ rule: "search.replace", reason: "Stale", description });

/**
 * Replaces one match. Refused as `Stale` when the hit no longer resolves;
 * otherwise the change goes through the book's one write path as an UNTRUSTED
 * `"replace"` edit, and the editor's rules decide — a replacement that would
 * break markup comes back as their refusal, not as a success.
 */
export const replace = (
  hit: Hit,
  insert: string,
  books: readonly Book[],
): Result.Result<Receipt, Refusal> => {
  const found = resolveHit(hit, books);
  if (found === null) return Result.fail(stale(`${hit.bookId} moved past r${hit.stamp.revision}`));
  return found.book.apply([{ from: found.from, to: found.to, insert }], "replace", UNTRUSTED);
};

/**
 * The change list for replacing several hits of ONE book in one edit, in
 * before-text coordinates and ascending order — the shape `book.apply` and
 * MultiBook's `runAcrossBooks(label, plan)` both want.
 *
 * `null` (rather than an empty list) when the plan cannot be made: a hit
 * belongs to another book, the book has moved past the scan, two hits overlap,
 * or there are no hits at all. `runAcrossBooks` reads `null` as "this book is
 * not part of the operation", which is the same answer in every one of those
 * cases.
 */
export const planReplace = (
  book: Book,
  hits: readonly Hit[],
  insert: string,
): readonly Change[] | null => {
  if (hits.length === 0) return null;
  if (hits.some((hit) => hit.bookId !== book.id || !isFresh(hit, book))) return null;

  const ordered = [...hits].sort((a, b) => a.from - b.from);
  for (let index = 1; index < ordered.length; index += 1)
    // SAFETY: `index` and `index - 1` are both inside a list of this length.
    if (ordered[index]!.from < ordered[index - 1]!.to) return null;

  return ordered.map((hit) => ({ from: hit.from, to: hit.to, insert }));
};

/**
 * Replaces several hits of one book as a single edit, so the book publishes one
 * receipt and the phases judge the whole change list together. Refused as
 * `Stale` when the hits no longer describe this book's current text (see
 * `planReplace`), which also covers overlapping hits — an operation that
 * cannot be expressed as one non-overlapping change list is not attempted.
 */
export const replaceInBook = (
  book: Book,
  hits: readonly Hit[],
  insert: string,
): Result.Result<Receipt, Refusal> => {
  const changes = planReplace(book, hits, insert);
  if (changes === null)
    return Result.fail(
      stale(`${hits.length} hits do not describe ${book.id} at r${book.source().stamp.revision}`),
    );
  return book.apply(changes, "replace", UNTRUSTED);
};
