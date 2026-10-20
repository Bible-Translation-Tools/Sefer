import type { BookId } from "../book";
import {
  chaptersAddress,
  comparePoints,
  introAddress,
  bookAddress,
  versesAddress,
  type Address,
  type Point,
} from "./address";
import { isIntroWord, matchBook, type BookMatch, type NameCatalogue } from "./names";

export type CitationProblem =
  /** Nothing was written. */
  | "empty"
  /** The words before the numbers name no book in the catalogue. */
  | "unknown-book"
  /** Numbers with no book before them, in the first group. */
  | "no-book"
  /** The numbers do not follow the grammar. */
  | "malformed"
  /** A chapter or verse 0 where a positive number is needed. */
  | "zero"
  /** A range whose end comes before its start. */
  | "backwards";

export type Citation =
  | { readonly ok: true; readonly text: string; readonly addresses: readonly Address[] }
  | {
      readonly ok: false;
      readonly text: string;
      readonly problem: CitationProblem;
      /** The words that did not match, for `unknown-book`. */
      readonly word?: string;
    };

export interface CitationOptions {
  readonly grammar: "navigation" | "prose";
  /** The books this project holds: breaks ties between navigation prefixes. */
  readonly held?: ReadonlySet<BookId>;
}

class Invalid {
  constructor(
    readonly problem: CitationProblem,
    readonly word?: string,
  ) {}
}

const DASHES = /[-–—]/;

interface Ref {
  readonly chapter?: number;
  readonly number: number;
  readonly segment?: string;
}

type Token =
  | { readonly kind: "number"; readonly value: number; readonly segment?: string }
  | { readonly kind: "colon" | "comma" | "dash" };

const NUMBER = /^(\d+)([\p{L}\p{Mn}]*)/u;

const tokenize = (refs: string): Token[] => {
  const tokens: Token[] = [];
  let rest = refs;
  while (rest.length > 0) {
    const head = rest[0] ?? "";
    if (/\s/.test(head)) {
      rest = rest.slice(1);
      continue;
    }
    const number = NUMBER.exec(rest);
    if (number !== null) {
      const segment = number[2] ?? "";
      tokens.push({
        kind: "number",
        value: Number(number[1]),
        ...(segment === "" ? {} : { segment }),
      });
      rest = rest.slice(number[0].length);
      continue;
    }
    if (head === ":" || head === ".") tokens.push({ kind: "colon" });
    else if (head === ",") tokens.push({ kind: "comma" });
    else if (DASHES.test(head)) tokens.push({ kind: "dash" });
    else throw new Invalid("malformed");
    rest = rest.slice(1);
  }
  return tokens;
};

const readRef = (
  tokens: readonly Token[],
  at: number,
  context: number | undefined,
): { readonly ref: Ref; readonly next: number } => {
  const first = tokens[at];
  if (first?.kind !== "number") throw new Invalid("malformed");
  if (tokens[at + 1]?.kind === "colon") {
    const verse = tokens[at + 2];
    if (verse?.kind !== "number") throw new Invalid("malformed");
    if (first.segment !== undefined) throw new Invalid("malformed");
    return {
      ref: {
        chapter: first.value,
        number: verse.value,
        ...(verse.segment === undefined ? {} : { segment: verse.segment }),
      },
      next: at + 3,
    };
  }
  if (context !== undefined) {
    return {
      ref: {
        chapter: context,
        number: first.value,
        ...(first.segment === undefined ? {} : { segment: first.segment }),
      },
      next: at + 1,
    };
  }
  if (first.segment !== undefined) throw new Invalid("malformed");
  return { ref: { number: first.value }, next: at + 1 };
};

const pointOf = (ref: Ref): Point => ({
  chapter: ref.chapter ?? ref.number,
  verse: ref.chapter === undefined ? 1 : ref.number,
  ...(ref.segment === undefined ? {} : { segment: ref.segment }),
});

const itemAddress = (book: BookId, start: Ref, end: Ref | undefined): Address => {
  const chapterOnly = (ref: Ref): boolean => ref.chapter === undefined;

  if (chapterOnly(start) && start.number === 0 && end === undefined) return introAddress(book);
  const zero = (ref: Ref): boolean => ref.number === 0 || ref.chapter === 0;
  if (zero(start) || (end !== undefined && zero(end))) throw new Invalid("zero");

  if (end === undefined) {
    return chapterOnly(start)
      ? chaptersAddress(book, start.number)
      : versesAddress(book, pointOf(start));
  }
  if (chapterOnly(start) && chapterOnly(end)) {
    if (end.number < start.number) throw new Invalid("backwards");
    return chaptersAddress(book, start.number, end.number);
  }
  const from = pointOf(start);
  const to = pointOf(end);
  if (comparePoints(to, from) < 0) throw new Invalid("backwards");
  return versesAddress(book, from, to);
};

const readItems = (book: BookId, tokens: readonly Token[]): Address[] => {
  const out: Address[] = [];
  let at = 0;
  let context: number | undefined;
  while (at < tokens.length) {
    const start = readRef(tokens, at, context);
    at = start.next;
    if (start.ref.chapter !== undefined) context = start.ref.chapter;
    let end: Ref | undefined;
    if (tokens[at]?.kind === "dash") {
      const read = readRef(tokens, at + 1, context);
      end = read.ref;
      at = read.next;
      if (end.chapter !== undefined) context = end.chapter;
    }
    out.push(itemAddress(book, start.ref, end));
    if (at === tokens.length) break;
    if (tokens[at]?.kind !== "comma" || at + 1 === tokens.length) throw new Invalid("malformed");
    at += 1;
  }
  return out;
};

const splitGroup = (group: string): { readonly words: string; readonly refs: string } => {
  const letter = group.search(/\p{L}/u);
  if (letter < 0) return { words: "", refs: group };
  const digit = group.slice(letter).search(/\d/);
  if (digit < 0) return { words: group, refs: "" };
  return { words: group.slice(0, letter + digit), refs: group.slice(letter + digit) };
};

/**
 * The words before the numbers in what was typed — "1 John 3:2" is "1 John" —
 * for a filter that lists every book they could mean (`booksMatching`).
 */
export const citationWords = (input: string): string =>
  splitGroup(input.split(";")[0] ?? "").words.trim();

const readBook = (
  words: string,
  catalogue: NameCatalogue,
  options: CitationOptions,
): { readonly book: BookId; readonly intro: boolean } => {
  const match: BookMatch = options.grammar === "navigation" ? "prefix" : "exact";
  const whole = matchBook(words, catalogue, match, options.held);
  if (whole !== undefined && matchBook(words, catalogue, "exact") !== undefined) {
    return { book: whole, intro: false };
  }
  const split = /^(.*\S)\s+(\S+)$/u.exec(words.trim());
  if (split !== null && isIntroWord(split[2] ?? "", catalogue)) {
    const book = matchBook(split[1] ?? "", catalogue, match, options.held);
    if (book !== undefined) return { book, intro: true };
  }
  if (whole !== undefined) return { book: whole, intro: false };
  throw new Invalid("unknown-book", words.trim());
};

const looseComma = (tokens: Token[], text: string): Token[] => {
  if (/[:.]/.test(text)) return tokens;
  const comma = tokens.findIndex((token) => token.kind === "comma");
  if (comma < 0) return tokens;
  return tokens.map((token, at) => (at === comma ? { kind: "colon" } : token));
};

export const parseCitation = (
  input: string,
  catalogue: NameCatalogue,
  options: CitationOptions,
): Citation => {
  const text = input.trim();
  if (text === "") return { ok: false, text, problem: "empty" };
  try {
    const addresses: Address[] = [];
    let book: BookId | undefined;
    for (const group of text.split(";")) {
      if (group.trim() === "") throw new Invalid("malformed");
      const { words, refs } = splitGroup(group);
      let intro = false;
      if (words.trim() !== "") ({ book, intro } = readBook(words, catalogue, options));
      if (book === undefined) throw new Invalid("no-book");

      let tokens = tokenize(refs);
      if (options.grammar === "navigation") tokens = looseComma(tokens, text);

      if (intro) {
        if (tokens.length > 0) throw new Invalid("malformed");
        addresses.push(introAddress(book));
      } else if (tokens.length === 0) {
        addresses.push(bookAddress(book));
      } else {
        addresses.push(...readItems(book, tokens));
      }
    }
    return { ok: true, text, addresses };
  } catch (error) {
    if (error instanceof Invalid) {
      return {
        ok: false,
        text,
        problem: error.problem,
        ...(error.word === undefined ? {} : { word: error.word }),
      };
    }
    throw error;
  }
};
