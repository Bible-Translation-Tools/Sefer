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
//
// TWO HAYSTACKS, ONE `Hit`. `findInReading` scans what a READER sees — the
// markup cut out, through the engine's mask map — and is the default: a search
// for "God" should not match `\w God|G` inside a word-level attribute, and a
// hit that spans a footnote should say so. `find` is the raw scan of canonical
// text, for a search deliberately aimed AT the markup. Either takes a literal
// or a regex, so the four combinations are all reachable and the two questions
// — what am I matching with, what am I matching against — are two switches
// rather than one.
//
// The engine's own `find`/`findAll` are no longer used from here. They were the
// only way to search the reading until the mask map arrived, and they cost
// what they cost because the engine rebuilds and re-folds every projection on
// every call. What replaced them supports strictly more: the same
// `caseSensitive`, `wholeWord`, `limit` and book filter, plus a regex, plus the
// markup as a haystack. `GalleyService.find`/`findAll` stay on the seam — the
// door is fine, Sefer just has a better way to ask.
//
// Both produce the same `Hit`, so `resolveHit`, `replace` and `planReplace`
// are written once.

import { Data, Result } from "effect";

import {
  identifyBook,
  Refusal,
  UNTRUSTED,
  type Book,
  type BookId,
  type Receipt,
  type Ref,
} from "../book/book";
import type { Change, SourceStamp } from "../source/source";
import type { Readings } from "./reading";

export interface Query {
  /** Literal text, or a regular expression source when `regex` is set. */
  readonly text: string;
  readonly caseSensitive?: boolean;
  /** Both edges of the match must sit against a non-word character. */
  readonly wholeWord?: boolean;
  readonly regex?: boolean;
}

export interface Options {
  /**
   * Total hits across all books, not per book. Omitted means NO BOUND, which
   * is the default every caller should want: a truncated result whose count is
   * displayed as the answer is a wrong answer, not a partial one. See
   * [`MINIMUM_QUERY`] for what is bounded instead, and why.
   */
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
  /**
   * Where the hit sits in the reading — what a reader sees in visual mode.
   *
   * Nothing sets this today. It went away with the engine's own find, and the
   * field is kept because a card that wanted to highlight in the READING
   * rather than in the source would need exactly it, and `findInReading` has
   * the number in hand.
   */
  readonly projected?: { readonly from: number; readonly to: number };
  /**
   * Every source piece of a projected hit, in order, when there is more than
   * ONE — which means the hit spans markup the projection dropped, and the
   * ranges between the pieces are exactly that markup. `from`/`to` are the
   * first piece, so anything that only wants somewhere to scroll to still
   * works; anything that would EDIT must refuse (see `spansMarkup`).
   */
  readonly pieces?: readonly { readonly from: number; readonly to: number }[];
}

/**
 * Does this hit cross markup the projection dropped?
 *
 * A hit that does cannot be replaced by this module, and that is a rule rather
 * than a limitation: the markup between the pieces either survives the
 * replacement or does not, and only the person editing knows which. Find's job
 * was to say the gap is there (`galley/src/find.md`, "Replacement is the
 * caller's").
 */
const spansMarkup = (hit: Hit): boolean => (hit.pieces?.length ?? 1) > 1;

class SearchError extends Data.TaggedError("SearchError")<{
  /**
   * The pattern is not a regular expression. The ONLY way a search fails now:
   * every scan here runs in this process over strings this module was handed,
   * so there is no call that can be refused and no host that can be absent.
   *
   * There was an `Engine` reason for as long as a search went through the
   * corpus. It went when the engine's find did.
   */
  readonly reason: "InvalidRegex";
  readonly description: string;
}> {}

/** Roughly how much of the containing line a result card shows. */
const PREVIEW_WIDTH = 90;

/**
 * The shortest query worth running across a whole project.
 *
 * NOT a guess. Measured against en_ulb (66 books, 4,503,659 chars) through the
 * engine's own `findAll`, median of seven, plus the JS decode into `Hit`s:
 *
 *     needle              hits    engine    decode     total
 *     "Melchizedek"         11    14.2ms         —         —
 *     "Jesus"            1,276    16.6ms     0.5ms    17.1ms
 *     "God"              4,656    26.6ms     1.4ms    28.0ms
 *     "the"             86,555    81.5ms    38.7ms   120.2ms
 *     "a"              255,018     173ms   108.1ms    281ms
 *
 * Two things fall out. There is a FLOOR of about 14ms whatever the search
 * finds — `Melchizedek` matches eleven times and still pays it — so a cap
 * buys nothing on a query anybody actually types. (The floor is the engine
 * rebuilding and case-folding every projection per call: ~3.7ms of cut and
 * ~10ms of fold. An earlier version of this comment blamed the cut alone,
 * which was wrong.) And the only row that hurts is the single character:
 * 255,018 hits is a 27MB buffer and a quarter of a million objects, for a
 * result no one can read.
 *
 * So the bound is on the QUESTION, not the answer. Two characters, and then
 * every hit, because "how many are there" is most of what a project-wide find
 * is for and a number that silently means "500, or possibly more" answers it
 * wrongly.
 */
export const MINIMUM_QUERY = 2;

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
const refAt = (text: string, pos: number, book: BookId = ""): Ref =>
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
 * This is the RAW door: it matches markup as readily as text, which is what a
 * regex query and a deliberate markup search want and what a reader-facing
 * search does not — `findProjected` is the default for that reason.
 *
 * Returns `SearchError` only for a pattern `RegExp` will not accept. An empty
 * query, a book list that matches nothing, and a text with no match are all a
 * successful empty result. Hits arrive in book order then offset order, and
 * stop at `limit` in total only when one is given; each carries the stamp its
 * book held at scan time, so a hit found before an edit is detectably stale
 * afterwards.
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

  const limit = options?.limit;
  if (limit !== undefined && limit <= 0) return Result.succeed([]);
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
        if (limit !== undefined && hits.length >= limit) return Result.succeed(hits);
      }
    }
  }
  return Result.succeed(hits);
};

// ---------------------------------------------------------------------------
// Find, over the reading
// ---------------------------------------------------------------------------

/**
 * Scans each book's READING — what a reader sees, with the markup cut out —
 * and reports the hits in the canonical text underneath.
 *
 * This is the door Find uses for everything a reader asks of their own text,
 * and it is the one that makes all four combinations reachable:
 *
 *                     over the reading        over the raw USFM
 *     literal         findInReading           find
 *     regex           findInReading           find
 *
 * Before the mask map only the two diagonal cells existed — `findAll` was
 * literal-over-the-reading and `find` was regex-over-the-markup — and one
 * toggle chose between them, which is why the regex button's label had to
 * admit it also changed what was being searched. They are two questions and
 * they are now two switches.
 *
 * The reading is REBUILT per call and dropped with it; only the mask survives,
 * in `readings`. `src/core/search/reading.ts` states that trade and its
 * measurements.
 *
 * Offsets come back in the SOURCE, through the map: `from`/`to` are the first
 * piece and `pieces` carries the rest, exactly as the engine's find buffer
 * reports them, so `resolveHit`, `spansMarkup` and `replace` are unchanged.
 */
export const findInReading = (
  readings: Readings,
  books: readonly Book[],
  query: Query,
  options?: Options,
): Result.Result<readonly Hit[], SearchError> => {
  if (query.text === "") return Result.succeed([]);

  const matcher = matcherFor(query);
  if (Result.isFailure(matcher)) return Result.fail(matcher.failure);
  const pattern = matcher.success;

  const limit = options?.limit;
  if (limit !== undefined && limit <= 0) return Result.succeed([]);
  const wanted = options?.books === undefined ? null : new Set(options.books);

  const hits: Hit[] = [];
  for (const book of books) {
    if (wanted !== null && !wanted.has(book.id)) continue;
    const source = book.source();
    const reading = readings.of({ id: book.id, text: source.text, stamp: source.stamp });
    // A book the engine holds no mask for contributes nothing. It is not an
    // error: a project opening has books registered one at a time, and a
    // search that arrives mid-way should report what is ready rather than
    // fail.
    if (reading === undefined) continue;

    const text = reading.text;
    // The ref table is built over the SOURCE, because a ref is a fact about
    // the document and the reading has no `\c`/`\v` markers left in it — they
    // are exactly what the mask cut out.
    const table = buildRefTable(source.text);

    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
      const from = match.index;
      const to = from + match[0].length;
      // A pattern like `\b` or `x*` can match nothing; advance by hand or the
      // loop never moves.
      if (to === from) pattern.lastIndex = from + 1;
      if (query.wholeWord === true && (isWordChar(text, from - 1) || isWordChar(text, to)))
        continue;

      const pieces = reading.pieces(from, to);
      const first = pieces[0];
      if (first === undefined) continue;
      hits.push({
        bookId: book.id,
        stamp: source.stamp,
        from: first.from,
        to: first.to,
        ref: refFrom(table, book.id, first.from),
        // Cut from the READING, so the preview reads as the reader sees it —
        // no markers, no footnote bodies — which is the whole point of
        // searching this side.
        preview: previewAt(text, from, to),
        ...(pieces.length > 1 ? { pieces } : {}),
      });
      if (limit !== undefined && hits.length >= limit) return Result.succeed(hits);
    }
  }
  return Result.succeed(hits);
};

// ---------------------------------------------------------------------------
// Find, in the project's bound references
// ---------------------------------------------------------------------------

/**
 * One hit in a book this project does not own.
 *
 * A separate shape from `Hit`, and the difference is the whole point. A `Hit`
 * carries a `SourceStamp` and offsets into a Book's canonical text, so that a
 * card can refuse when the book has moved and an edit can land exactly where
 * the match was. A reference has NONE of that available and needs none of it:
 * there is no Book, no revision to compare against, and nothing to edit. It is
 * something to read.
 *
 * So this carries what a reader can use — which resource file it came from,
 * which verse it landed in, where in that file's text it sits, and the reading
 * around it — and deliberately no stamp. A reference hit that could be confused
 * for an editable one is the bug this separation exists to prevent.
 */
export interface ReferenceHit {
  /** The registered id, which is the resource's own file path. */
  readonly source: string;
  /** Where the hit sits in that book's verse-text projection. */
  readonly projected: { readonly from: number; readonly to: number };
  /** Display text around the match. Ellipsed; never parsed back to offsets. */
  readonly preview: string;
  /**
   * Which verse the hit landed in.
   *
   * The join that lets Find show reference results as the same excerpt cards
   * every other screen uses: the project's own verse is the card, and the
   * reference's reading sits beside it.
   */
  readonly ref: Ref;
  /**
   * The match in the REFERENCE's canonical text.
   *
   * The FIRST source piece, like `Hit.from`/`to` and for the same reason: a hit
   * that crossed markup has pieces, and their bounds would swallow the markup
   * between them. Read-only on this side, so it is somewhere to highlight and
   * never somewhere to write.
   */
  readonly from: number;
  readonly to: number;
}

/**
 * One bound reference: the id it was registered under, and the text Sefer
 * holds for it.
 *
 * `ProjectAnalysis.references()` names them and `referenceText(id)` answers the
 * text, which it keeps for exactly this. A reference registered WITHOUT its
 * text has no reading to cut and is simply absent from the list.
 */
export interface BoundReference {
  readonly id: string;
  readonly text: string;
}

/**
 * Find over the project's BOUND REFERENCES — the `source` and `reference`
 * resources registered with their text.
 *
 * The SAME scan as `findInReading`, over the same kind of reading, with the
 * same matcher. That is the point: a reference is somebody else's book, not a
 * different kind of thing, and a reader searching one should not silently get
 * literal-only matching and a different set of rules. It went through the
 * engine's `findAll(scope: "references")` until the mask map made the reading
 * available on this side — which is also why the regex toggle had to be refused
 * on this scope, and is not any more.
 *
 * `src/app/workflows/references.ts` is what registers them, through
 * `ProjectAnalysis.attachReferences`.
 */
export const findInReferences = (
  readings: Readings,
  references: readonly BoundReference[],
  query: Query,
  options?: Options,
): Result.Result<readonly ReferenceHit[], SearchError> => {
  if (query.text === "") return Result.succeed([]);

  const matcher = matcherFor(query);
  if (Result.isFailure(matcher)) return Result.fail(matcher.failure);
  const pattern = matcher.success;

  const limit = options?.limit;
  if (limit !== undefined && limit <= 0) return Result.succeed([]);

  const hits: ReferenceHit[] = [];
  for (const reference of references) {
    const reading = readings.of({ id: reference.id, text: reference.text });
    // No mask means no retained projection — a reference bound lengths-only.
    // It contributes nothing rather than failing the others' search.
    if (reading === undefined) continue;

    const text = reading.text;
    const table = buildRefTable(reference.text);
    // The reference's OWN book code, off its `\id`, so the ref this produces
    // can be matched against a project book of the same code.
    const bookId = identifyBook(reference.text, reference.id);

    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
      const from = match.index;
      const to = from + match[0].length;
      if (to === from) pattern.lastIndex = from + 1;
      if (query.wholeWord === true && (isWordChar(text, from - 1) || isWordChar(text, to)))
        continue;

      const first = reading.pieces(from, to)[0];
      if (first === undefined) continue;
      hits.push({
        source: reference.id,
        projected: { from, to },
        preview: previewAt(text, from, to),
        ref: refFrom(table, bookId, first.from),
        from: first.from,
        to: first.to,
      });
      if (limit !== undefined && hits.length >= limit) return Result.succeed(hits);
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
const resolveHit = (
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
 * A projected hit whose source is several pieces cannot be replaced here. The
 * markup between the pieces either survives the replacement or does not, and
 * that is the editor's decision, not this module's — so the refusal is the
 * honest answer rather than a guess dressed as a success.
 */
const spansMarkupRefusal = (hit: Hit): Refusal =>
  new Refusal({
    rule: "search.replace",
    reason: "SpansMarkup",
    description: `${hit.bookId} hit crosses markup in ${hit.pieces?.length ?? 0} pieces`,
  });

/**
 * Replaces one match. Refused as `Stale` when the hit no longer resolves;
 * otherwise the change goes through the book's one write path as an UNTRUSTED
 * `"replace"` edit, and the editor's rules decide — a replacement that would
 * break markup comes back as their refusal, not as a success.
 *
 * Refused as `SpansMarkup` before any of that when the hit crosses markup the
 * projection dropped (`spansMarkup`): there is no single range to replace.
 */
const replace = (
  hit: Hit,
  insert: string,
  books: readonly Book[],
): Result.Result<Receipt, Refusal> => {
  if (spansMarkup(hit)) return Result.fail(spansMarkupRefusal(hit));
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
 * a hit crosses markup the projection dropped, or there are no hits at all. `runAcrossBooks` reads `null` as "this book is
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
  // A split hit has no single range to replace, so the plan cannot be made —
  // the same answer `runAcrossBooks` reads as "not part of this operation".
  if (hits.some(spansMarkup)) return null;

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
