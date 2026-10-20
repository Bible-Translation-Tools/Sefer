import {
  identifyBook,
  Refusal,
  UNTRUSTED,
  type Book,
  type BookId,
  type Receipt,
} from "@sefer/text/book";
import { describesExactly, type Analysis } from "@sefer/text/engine/analysis";
import { tocViewOf } from "@sefer/text/engine/location";
import type { Address } from "@sefer/text/location/address";
import { addressAt } from "@sefer/text/location/locate";
import type { Change, SourceStamp } from "@sefer/text/source";
import { Data, Result } from "effect";

import type { EngineHit } from "../galley/galley";
import type { HaystackDocument } from "../resources/kinds/handle";
import type { Reading, Readings } from "./reading";

export interface Query {
  readonly text: string;
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
  readonly regex?: boolean;
  readonly unicode?: boolean;
}

export interface Options {
  readonly limit?: number;
  readonly books?: readonly BookId[];
  readonly analysisOf?: (id: string) => Analysis | undefined;
  readonly previewWidth?: number;
}

export interface Hit {
  readonly bookId: BookId;
  readonly stamp: SourceStamp;
  readonly from: number;
  readonly to: number;
  readonly address?: Address;
  readonly preview: string;
  /** Where the match is inside `preview`, in its own UTF-16 offsets, to mark it. */
  readonly previewMatch: { readonly from: number; readonly to: number };
  readonly projected?: { readonly from: number; readonly to: number };
  readonly pieces?: readonly { readonly from: number; readonly to: number }[];
}

const spansMarkup = (hit: Hit): boolean => (hit.pieces?.length ?? 1) > 1;

class SearchError extends Data.TaggedError("SearchError")<{
  readonly reason: "InvalidRegex";
  readonly description: string;
}> {}

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

const COMMON = /^[\p{L}\p{N}\s]$/u;

export const longEnough = (text: string): boolean => {
  const chars = [...text];
  if (chars.length >= MINIMUM_QUERY) return true;
  return chars.length === 1 && !COMMON.test(text);
};

const WORD = /[\p{L}\p{N}_]/u;

const isWordChar = (text: string, index: number): boolean =>
  index >= 0 && index < text.length && WORD.test(text[index] ?? "");

const escapeLiteral = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

const lazily = (make: () => AddressOf): AddressOf => {
  let held: AddressOf | undefined;
  return (offset) => (held ??= make())(offset);
};

const withAddress = (address: Address | undefined): { readonly address?: Address } =>
  address === undefined ? {} : { address };

const isLowSurrogateAt = (text: string, index: number): boolean => {
  const unit = text.charCodeAt(index);
  return unit >= 0xdc00 && unit <= 0xdfff;
};

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
    if (reading === undefined) continue;

    const text = reading.text;
    const addressOf = lazily(() => addressesOf(options?.analysisOf, book.id, book.id, source.text));

    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
      const from = match.index;
      const to = from + match[0].length;
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
        ...previewAt(text, from, to, options?.previewWidth),
        ...(pieces.length > 1 ? { pieces } : {}),
      });
      if (limit !== undefined && hits.length >= limit) return Result.succeed(hits);
    }
  }
  return Result.succeed(hits);
};

export const fromEngine = (
  readings: Readings,
  books: readonly Book[],
  found: readonly EngineHit[],
  options?: Options,
): readonly Hit[] => {
  const byId = new Map<string, Book>(books.map((book) => [book.id, book]));
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

export interface ReferenceHit {
  readonly source: string;
  readonly projected: { readonly from: number; readonly to: number };
  /** Display text around the match. Ellipsed; never parsed back to offsets. */
  readonly preview: string;
  readonly address?: Address;
  readonly from: number;
  readonly to: number;
}

export interface BoundReference {
  readonly id: string;
  readonly text: string;
}

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
    if (reading === undefined) continue;

    const text = reading.text;
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

export interface DocumentHit {
  readonly document: string;
  readonly addresses: readonly Address[];
  readonly from: number;
  readonly to: number;
  readonly preview: string;
  readonly previewMatch: { readonly from: number; readonly to: number };
}

export const findInDocuments = (
  documents: readonly HaystackDocument[],
  query: Query,
  options?: Pick<Options, "limit" | "previewWidth">,
): Result.Result<readonly DocumentHit[], SearchError> => {
  if (query.text === "") return Result.succeed([]);
  const matcher = matcherFor(query);
  if (Result.isFailure(matcher)) return Result.fail(matcher.failure);
  const pattern = matcher.success;
  const limit = options?.limit;
  if (limit !== undefined && limit <= 0) return Result.succeed([]);

  const hits: DocumentHit[] = [];
  for (const document of documents) {
    const { text } = document;
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
      const from = match.index;
      const to = from + match[0].length;
      if (to === from) pattern.lastIndex = from + 1;
      if (query.wholeWord === true && (isWordChar(text, from - 1) || isWordChar(text, to)))
        continue;
      hits.push({
        document: document.id,
        addresses: document.addresses,
        from,
        to,
        ...previewAt(text, from, to, options?.previewWidth),
      });
      if (limit !== undefined && hits.length >= limit) return Result.succeed(hits);
    }
  }
  return Result.succeed(hits);
};

const isFresh = (hit: Hit, book: Book): boolean =>
  book.source().stamp.revision === hit.stamp.revision;

const stale = (description: string): Refusal =>
  new Refusal({ rule: "search.replace", reason: "Stale", description });

export const planReplace = (
  book: Book,
  hits: readonly Hit[],
  insert: string,
): readonly Change[] | null => {
  if (hits.length === 0) return null;
  if (hits.some((hit) => hit.bookId !== book.id || !isFresh(hit, book))) return null;
  if (hits.some(spansMarkup)) return null;

  const ordered = [...hits].sort((a, b) => a.from - b.from);
  for (let index = 1; index < ordered.length; index += 1)
    // SAFETY: `index` and `index - 1` are both inside a list of this length.
    if (ordered[index]!.from < ordered[index - 1]!.to) return null;

  return ordered.map((hit) => ({ from: hit.from, to: hit.to, insert }));
};

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
