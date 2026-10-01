// search.ts
//
// Project-wide Find, and the Replace behind it. Search is a pure, synchronous
// scan of canonical text: it takes the Books it should look at rather than a
// Project, so the result browser, a satellite window and a test can all call
// it with whatever set of Books they hold, and nothing here needs a lifetime,
// a service or the engine. See `documentation/architecture/search.md`.
//
// Two rules shape the whole module:
//
//  - Every hit is version-bound. A `Hit` carries the stamp of the text it was
//    found in, and `planReplace` refuses to hand back changes once that stamp
//    has moved. Offsets into text that has since been edited are the classic
//    stale-range bug; the stamp is what makes it a refusal instead.
//  - Replacing is per book. `replaceInBook` applies several hits of ONE book
//    in one `apply`, and `planReplace` shapes those changes for MultiBook's
//    `runAcrossBooks`, which asks per book. Nothing here walks the corpus and
//    rewrites it; Find's Replace all (behind the `find.enableReplaceAll`
//    setting) is a caller that previews first and then goes book by book.
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
// The engine's own `find`/`findAll` are not used from here: the engine
// rebuilds and re-folds every projection on every call, and the scan here
// supports strictly more — the same `caseSensitive`, `wholeWord`, `limit` and
// book filter, plus a regex, plus the markup as a haystack.
// `GalleyService.find`/`findAll` stay on the seam; the door is fine, Sefer
// just has a better way to ask.
//
// Both produce the same `Hit`, so `spansMarkup` and `planReplace` are written
// once.

import { Data, Result } from "effect";

import {
  identifyBook,
  Refusal,
  UNTRUSTED,
  type Book,
  type BookId,
  type Receipt,
} from "../book/book";
import { describesExactly, type Analysis } from "../galley/analysis";
import type { EngineHit } from "../galley/galley";
import { tocViewOf } from "../galley/location";
import type { Address } from "../location/address";
import { addressAt } from "../location/locate";
import type { Change, SourceStamp } from "../source/source";
import type { Reading, Readings } from "./reading";

export interface Query {
  /** Literal text, or a regular expression source when `regex` is set. */
  readonly text: string;
  readonly caseSensitive?: boolean;
  /** Both edges of the match must sit against a non-word character. */
  readonly wholeWord?: boolean;
  readonly regex?: boolean;
  /**
   * Compile a regex in Unicode mode (`u`), for `\p{L}` and friends. Off for
   * what a person types into Find, because `u` also turns a loose escape a
   * person might type (`\-` outside a class) into a syntax error.
   */
  readonly unicode?: boolean;
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
  /**
   * The caller's analysis of a scanned text, by the id the text arrived under
   * (a Book's id, a reference's registered id) — what a hit's `address` is
   * read from. For project books that is ProjectAnalysis' held parse; for a
   * reference, one parse per exact text that the caller keeps.
   *
   * Asked at most once per text per call, and only for a text with a hit. An
   * analysis of different text is ignored, and so is an omitted one: the hits
   * still arrive, without an address. Search never parses and never scans for
   * a marker to make up for it.
   */
  readonly analysisOf?: (id: string) => Analysis | undefined;
  /**
   * About how many characters of the containing line `preview` keeps —
   * `PREVIEW_WIDTH` when omitted, which is a one-line result card. A caller
   * with room to wrap (a dialog) asks for more.
   */
  readonly previewWidth?: number;
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
  /**
   * Which place the hit is in — `PHM 1:5`, `JUD 1:1-2` inside a bridge,
   * `PSA intro` — read from the TOC of the analysis the caller supplied
   * (`Options.analysisOf`). Absent when that analysis was missing or described
   * other text. Display only: an action on the hit goes through its stamp.
   */
  readonly address?: Address;
  readonly preview: string;
  /** Where the match is inside `preview`, in its own UTF-16 offsets, to mark it. */
  readonly previewMatch: { readonly from: number; readonly to: number };
  /**
   * Where the hit sits in the reading — what a reader sees in visual mode.
   *
   * Unset by the scans here. The field is kept because a card that wanted to
   * highlight in the READING rather than in the source would need exactly it,
   * and `findInReading` has the number in hand.
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
 * is to say the gap is there (`galley/src/find.md`, "Replacement is the
 * caller's").
 */
const spansMarkup = (hit: Hit): boolean => (hit.pieces?.length ?? 1) > 1;

class SearchError extends Data.TaggedError("SearchError")<{
  /**
   * The pattern is not a regular expression. The ONLY way a search fails:
   * every scan here runs in this process over strings this module was handed,
   * so there is no call that can be refused and no host that can be absent.
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
 * ~10ms of fold.) And the only row that hurts is the single character:
 * 255,018 hits is a 27MB buffer and a quarter of a million objects, for a
 * result no one can read.
 *
 * So the bound is on the QUESTION, not the answer. Two characters, and then
 * every hit, because "how many are there" is most of what a project-wide find
 * is for and a number that silently means "500, or possibly more" answers it
 * wrongly.
 */
export const MINIMUM_QUERY = 2;

/** A letter, a digit or a space: the single characters the bound is about. */
const COMMON = /^[\p{L}\p{N}\s]$/u;

/**
 * Is `text` long enough to search the whole project?
 *
 * `MINIMUM_QUERY` characters, with one exception: a single character that is
 * not a letter, a digit or a space. The rows above are about "a", which is a
 * word being typed and a quarter of a million hits. "—" or "“" is a question
 * asked on purpose, usually by someone checking one glyph, and it is rare in
 * a way "a" is not. Counted in code points, so a character outside the BMP is
 * one character and not two.
 */
export const longEnough = (text: string): boolean => {
  const chars = [...text];
  if (chars.length >= MINIMUM_QUERY) return true;
  return chars.length === 1 && !COMMON.test(text);
};

const WORD = /[\p{L}\p{N}_]/u;

const isWordChar = (text: string, index: number): boolean =>
  index >= 0 && index < text.length && WORD.test(text[index] ?? "");

const escapeLiteral = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/**
 * Which Address an offset of one text is in, from an analysis the caller
 * supplied — or nothing.
 *
 * Search reads no designator itself: the engine's TOC answers, through
 * Location's inverse lookup (`core/location/locate`, `addressAt`). The
 * analysis is asked for only once a book has a hit, and once per book per
 * call, so N hits cost one lookup of the analysis plus N binary searches over
 * one TOC — never a parse per hit, and never a parse here at all.
 *
 * `undefined` when the caller has no analysis for the book, or has one of
 * different text: a TOC of other text answers confidently and wrongly, and a
 * label that names a verse the text may no longer be is worse than none. So a
 * book with no fresh analysis still gets every hit, with no address, and
 * there is no fallback scanner.
 */
type AddressOf = (offset: number) => Address | undefined;

const NO_ADDRESS: AddressOf = () => undefined;

const addressesOf = (
  analysisOf: Options["analysisOf"],
  id: string,
  book: BookId,
  text: string,
): AddressOf => {
  const analysis = analysisOf?.(id);
  if (analysis === undefined || !describesExactly(analysis, text)) return NO_ADDRESS;
  const toc = tocViewOf(analysis);
  return (offset) => addressAt(book, toc, offset);
};

/**
 * Resolved on first use: a book with no hit never asks for its analysis, so a
 * search that finds nothing in a reference never makes the caller parse it.
 */
const lazily = (make: () => AddressOf): AddressOf => {
  let held: AddressOf | undefined;
  return (offset) => (held ??= make())(offset);
};

/** The optional field, spread: absent rather than `undefined` under exact types. */
const withAddress = (address: Address | undefined): { readonly address?: Address } =>
  address === undefined ? {} : { address };

// ---------------------------------------------------------------------------
// Find
// ---------------------------------------------------------------------------

const isLowSurrogateAt = (text: string, index: number): boolean => {
  const unit = text.charCodeAt(index);
  return unit >= 0xdc00 && unit <= 0xdfff;
};

/**
 * The containing line, narrowed to about `PREVIEW_WIDTH` characters around the
 * match so a result card gets one short string, and where the match sits in
 * it. Truncated edges are marked with an ellipsis, and boundaries are nudged
 * off surrogate pairs so the preview never contains a lone surrogate.
 */
const previewAt = (
  text: string,
  from: number,
  to: number,
  width: number = PREVIEW_WIDTH,
): Pick<Hit, "preview" | "previewMatch"> => {
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const lineEndAt = text.indexOf("\n", from);
  const lineEnd = lineEndAt < 0 ? text.length : lineEndAt;

  let start = lineStart;
  let end = lineEnd;
  if (lineEnd - lineStart > width) {
    const slack = Math.max(0, width - (Math.min(to, lineEnd) - from));
    start = Math.max(lineStart, from - Math.floor(slack / 2));
    end = Math.min(lineEnd, start + width);
    start = Math.max(lineStart, end - width);
  }
  if (isLowSurrogateAt(text, start)) start += 1;
  if (isLowSurrogateAt(text, end)) end -= 1;

  const raw = text.slice(start, end);
  const body = raw.trim();
  const lead = start > lineStart ? 1 : 0;
  const offset = lead - (raw.length - raw.trimStart().length) - start;
  const clamp = (at: number): number => Math.min(Math.max(at + offset, lead), lead + body.length);
  return {
    preview: `${lead === 1 ? "…" : ""}${body}${end < lineEnd ? "…" : ""}`,
    previewMatch: { from: clamp(from), to: clamp(to) },
  };
};

const matcherFor = (query: Query): Result.Result<RegExp, SearchError> => {
  const source = query.regex ? query.text : escapeLiteral(query.text);
  const flags = `g${query.caseSensitive === true ? "" : "i"}${query.unicode === true ? "u" : ""}`;
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
 * search does not — `findInReading` is the default for that reason.
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
    const addressOf = lazily(() => addressesOf(options?.analysisOf, book.id, book.id, text));

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
          ...withAddress(addressOf(from)),
          ...previewAt(text, from, to, options?.previewWidth),
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
 * They are two questions, so they are two switches: the matcher does not
 * decide the haystack, and the regex button changes only what is matched
 * with.
 *
 * The reading is REBUILT per call and dropped with it; only the mask survives,
 * in `readings`. `src/core/search/reading.ts` states that trade and its
 * measurements.
 *
 * Offsets come back in the SOURCE, through the map: `from`/`to` are the first
 * piece and `pieces` carries the rest, exactly as the engine's find buffer
 * reports them, so `spansMarkup` and `planReplace` treat both scans alike.
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
    // Addressed in the SOURCE, because a place is a fact about the document
    // and the reading has no `\c`/`\v` markers left in it — they are exactly
    // what the mask cut out.
    const addressOf = lazily(() => addressesOf(options?.analysisOf, book.id, book.id, source.text));

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
        ...withAddress(addressOf(first.from)),
        // Cut from the READING, so the preview reads as the reader sees it —
        // no markers, no footnote bodies — which is the whole point of
        // searching this side.
        ...previewAt(text, from, to, options?.previewWidth),
        ...(pieces.length > 1 ? { pieces } : {}),
      });
      if (limit !== undefined && hits.length >= limit) return Result.succeed(hits);
    }
  }
  return Result.succeed(hits);
};

/**
 * The engine's own find hits (`GalleyService.findAll`) as `Hit`s, for a
 * literal whose words rule and case fold should be the engine's — kitchen's
 * Sous queries name `findAll` as their door.
 *
 * The engine's `projected` range is an offset into the same verse-text
 * reading `readings` cuts, so the preview is cut from that reading exactly as
 * `findInReading` cuts one, and the match inside it is known. A hit whose book
 * is not among `books`, or has no reading yet, is dropped: it has no stamp to
 * bind to.
 */
export const fromEngine = (
  readings: Readings,
  books: readonly Book[],
  found: readonly EngineHit[],
  options?: Options,
): readonly Hit[] => {
  const byId = new Map<string, Book>(books.map((book) => [book.id, book]));
  // Hits arrive book by book, so each book is looked up once.
  let held:
    | {
        readonly id: string;
        readonly stamp: SourceStamp;
        readonly reading?: Reading;
        readonly addressOf: AddressOf;
      }
    | undefined;
  const hits: Hit[] = [];
  for (const hit of found) {
    const first = hit.source[0];
    if (hit.bookId === undefined || first === undefined) continue;
    if (held?.id !== hit.bookId) {
      const book = byId.get(hit.bookId);
      if (book === undefined) continue;
      const { text, stamp } = book.source();
      const reading = readings.of({ id: book.id, text, stamp });
      held = {
        id: book.id,
        stamp,
        ...(reading === undefined ? {} : { reading }),
        addressOf: lazily(() => addressesOf(options?.analysisOf, book.id, book.id, text)),
      };
    }
    if (held.reading === undefined) continue;
    hits.push({
      bookId: held.reading.bookId,
      stamp: held.stamp,
      from: first.from,
      to: first.to,
      ...withAddress(held.addressOf(first.from)),
      ...previewAt(held.reading.text, hit.projected.from, hit.projected.to, options?.previewWidth),
      ...(hit.source.length > 1 ? { pieces: hit.source } : {}),
    });
  }
  return hits;
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
   * Which place the hit landed in, in the REFERENCE's own TOC — absent when
   * the caller supplied no analysis of that exact text.
   *
   * The join that lets Find show reference results as the same excerpt cards
   * every other screen uses: the project's own verse is the card, and the
   * reference's reading sits beside it.
   */
  readonly address?: Address;
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
 * literal-only matching and a different set of rules — so the regex toggle
 * works on this scope too.
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
    // The reference's OWN book code, off its `\id`, so the address this
    // produces can be matched against a project book of the same code.
    const bookId = identifyBook(reference.text, reference.id);
    const addressOf = lazily(() =>
      addressesOf(options?.analysisOf, reference.id, bookId, reference.text),
    );

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
        ...previewAt(text, from, to, options?.previewWidth),
        ...withAddress(addressOf(first.from)),
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

const isFresh = (hit: Hit, book: Book): boolean =>
  book.source().stamp.revision === hit.stamp.revision;

const stale = (description: string): Refusal =>
  new Refusal({ rule: "search.replace", reason: "Stale", description });

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
