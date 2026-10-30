import type { Change } from "@sefer/text/source";

import { MARKERS, TOKEN, TOKEN_SPELLING_BIT, tocViewOf, type Analysis } from "../galley";

/**
 * A book's chapter labels (`\cl`), read off its parse, and the edit that
 * makes them one word (Will, 2026-10-29).
 *
 * USFM gives `\cl` two meanings by where it stands: before the first `\c` it
 * is the book's word for "Chapter"; after a `\c` it is that chapter's own
 * label ("Psalm One"). A chapter's own label is any `\cl` inside its span,
 * from the parse's chapter rows, never "the line after `\c`".
 *
 * A chapter's label is `word-number` when it is a word and that chapter's
 * number ("Psalm 3"), `number-word` the other way round ("3 Sura"), and
 * `other` when it is words ("Psalm Three") or carries a number that is not
 * its chapter's. Only the first two are the book's word repeated, so only
 * they fold into one book label.
 */

export type LabelShape = "word-number" | "number-word" | "other" | "empty";

export interface ChapterLabel {
  readonly scope: "book" | "chapter";
  /** The chapter's number; null for the book's label. */
  readonly chapter: number | null;
  /** The label's words, trimmed, markup and all. */
  readonly text: string;
  readonly shape: LabelShape;
  /** The word beside the number, for `word-number` and `number-word`. */
  readonly word?: string;
  /** A word and a number, but not this chapter's: kept, and worth a look. */
  readonly mismatched: boolean;
  /** The whole line, `\cl` to its end, without the line break. */
  readonly from: number;
  readonly to: number;
  /** Past the line break, where there is one: taking `from`–`lineEnd` takes the line. */
  readonly lineEnd: number;
  /** Where the words start and end. */
  readonly textFrom: number;
  readonly textTo: number;
}

export interface BookLabels {
  readonly labels: readonly ChapterLabel[];
  /** The first non-empty label before chapter 1. */
  readonly book?: ChapterLabel;
  /** Where a book label goes, before chapter 1's `\c`, and what it is written as; undefined with no chapters. */
  readonly bookLabelAt?: { readonly at: number; readonly line: (word: string) => string };
  /** How many chapters the book has. */
  readonly chapters: number;
}

const CL = MARKERS.findIndex((row) => row.name === "cl");

/** The value of a digit in any script: digits come in runs of ten, zero first. */
const digitValue = (char: string): number => {
  let cp = char.codePointAt(0) ?? 0;
  let back = 0;
  while (back < 100 && /\p{Nd}/u.test(String.fromCodePoint(cp - 1))) {
    cp -= 1;
    back += 1;
  }
  return back % 10;
};

const numberOf = (digits: string): number =>
  [...digits].reduce((total, char) => total * 10 + digitValue(char), 0);

const WORD_NUMBER = /^(.*\S)\s+(\p{Nd}+)$/u;
const NUMBER_WORD = /^(\p{Nd}+)\s+(.*\S)$/u;

const shapeOf = (
  text: string,
  chapter: number | null,
): { shape: LabelShape; word?: string; mismatched: boolean } => {
  if (text === "") return { shape: "empty", mismatched: false };
  if (chapter === null) return { shape: "other", mismatched: false };
  const after = WORD_NUMBER.exec(text);
  const before = after === null ? NUMBER_WORD.exec(text) : null;
  const word = after?.[1] ?? before?.[2];
  const digits = after?.[2] ?? before?.[1];
  if (word === undefined || digits === undefined) return { shape: "other", mismatched: false };
  if (numberOf(digits) !== chapter) return { shape: "other", mismatched: true };
  return { shape: after === null ? "number-word" : "word-number", word, mismatched: false };
};

const seen = new WeakMap<Analysis["dish"], BookLabels>();

/** Every `\cl` in a book, in order, kept with its parse. */
export const chapterLabelsOf = (analysis: Analysis): BookLabels => {
  const held = seen.get(analysis.dish);
  if (held !== undefined) return held;
  const text = analysis.text;
  const chapters = tocViewOf(analysis).chapters.filter((row) => row.number > 0);
  const chapterAt = (at: number): number | null => {
    let found: number | null = null;
    for (const row of chapters) if (row.from <= at) found = row.number;
    return found;
  };
  const labels: ChapterLabel[] = [];
  analysis.dish.tokens.forEach((kind, markerIdx, from, to) => {
    if ((kind & ~TOKEN_SPELLING_BIT) !== TOKEN.MARKER || markerIdx !== CL) return;
    const end = text.indexOf("\n", to);
    const lineTo = end < 0 ? text.length : end;
    const raw = text.slice(to, lineTo);
    const textFrom = to + (raw.length - raw.trimStart().length);
    const textTo = lineTo - (raw.length - raw.trimEnd().length);
    const words = text.slice(textFrom, Math.max(textFrom, textTo));
    const chapter = chapterAt(from);
    labels.push({
      scope: chapter === null ? "book" : "chapter",
      chapter,
      text: words,
      ...shapeOf(words, chapter),
      from,
      to: lineTo,
      lineEnd: end < 0 ? lineTo : lineTo + 1,
      textFrom,
      textTo: Math.max(textFrom, textTo),
    });
  });
  const book = labels.find((label) => label.scope === "book" && label.text !== "");
  const first = chapters[0];
  const result: BookLabels = {
    labels,
    chapters: chapters.length,
    ...(book === undefined ? {} : { book }),
    ...(first === undefined
      ? {}
      : {
          bookLabelAt: {
            at: first.from,
            // On its own line: after a line break, before the chapter's.
            line: (word: string) =>
              `${first.from === 0 || text[first.from - 1] === "\n" ? "" : "\n"}\\cl ${word}\n`,
          },
        }),
  };
  seen.set(analysis.dish, result);
  return result;
};

/**
 * The words a book's chapters read, most used first, each with how many
 * chapters read it: a chapter's own "word + number" label, else the book
 * label, which names every chapter without a label of its own.
 */
const wordsOf = (book: BookLabels): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  const named = new Set<number>();
  for (const label of book.labels)
    if (label.chapter !== null && label.text !== "") named.add(label.chapter);
  for (const label of book.labels)
    if (label.word !== undefined) counts.set(label.word, (counts.get(label.word) ?? 0) + 1);
  if (book.book !== undefined) {
    const word = book.book.text;
    counts.set(word, (counts.get(word) ?? 0) + Math.max(0, book.chapters - named.size));
  }
  return new Map([...counts].sort((a, b) => b[1] - a[1]));
};

/**
 * The edit that makes a book's chapters read `word`: one book label before
 * chapter 1 (written, or rewritten if there is one), and each chapter's own
 * "word + its number" label taken out, since the book label now says it.
 * A book whose numbers come first ("3 Sura") cannot say that with a book
 * label, so there each such label has its word rewritten in place instead.
 * Labels written as words, empty ones, and stray numbers are left as they are.
 */
export const standardize = (book: BookLabels, word: string): readonly Change[] => {
  const repeated = book.labels.filter(
    (label) => label.shape === "word-number" || label.shape === "number-word",
  );
  const numberFirst =
    repeated.filter((label) => label.shape === "number-word").length * 2 > repeated.length;
  const changes: Change[] = [];
  if (numberFirst) {
    for (const label of repeated) {
      if (label.word === word) continue;
      changes.push({
        from: label.textFrom,
        to: label.textTo,
        insert: label.text.replace(label.word ?? "", word),
      });
    }
    return changes;
  }
  if (book.book !== undefined) {
    if (book.book.text !== word)
      changes.push({ from: book.book.textFrom, to: book.book.textTo, insert: word });
  } else if (book.bookLabelAt !== undefined)
    changes.push({
      from: book.bookLabelAt.at,
      to: book.bookLabelAt.at,
      insert: book.bookLabelAt.line(word),
    });
  for (const label of repeated) changes.push({ from: label.from, to: label.lineEnd, insert: "" });
  return changes.sort((a, b) => a.from - b.from);
};

/**
 * One chapter label that reads differently from the rest (Will, 2026-10-29):
 * its word is not its book's (the book label, when the book has one) or, in
 * a book with none, not the project's most used word; or its number is not
 * its chapter's. A book label is a declaration, never flagged: choosing a
 * book's word in the dialog writes one, and its chapters are then judged
 * against it alone. Labels written as words are never flagged.
 */
export interface LabelMark {
  readonly bookId: string;
  readonly label: ChapterLabel;
  readonly reason: "word" | "number";
  /** The word it was judged against. */
  readonly expected?: string;
  /** "Fine here" is this label; "everywhere" is its word, in every book. */
  readonly keys: { readonly here: string; readonly everywhere?: string };
}

export interface LabelJudgement {
  readonly marks: ReadonlyMap<string, readonly LabelMark[]>;
  readonly count: number;
  /** The distinct words flagged, and the books they are in. */
  readonly words: number;
  readonly books: number;
  readonly projectWord?: string;
}

/** Turning the whole check off: the summary's own key. */
export const CHAPTER_LABELS_OFF = "project:chapterLabels";

export const judge = (
  books: ReadonlyMap<string, BookLabels>,
  quiet: (keys: LabelMark["keys"]) => boolean,
): LabelJudgement => {
  const totals = new Map<string, number>();
  for (const book of books.values())
    for (const [word, count] of wordsOf(book)) totals.set(word, (totals.get(word) ?? 0) + count);
  let projectWord: string | undefined;
  let best = 0;
  for (const [word, count] of totals)
    if (count > best) {
      best = count;
      projectWord = word;
    }
  const marks = new Map<string, LabelMark[]>();
  const words = new Set<string>();
  let count = 0;
  for (const [bookId, book] of books) {
    const expected = book.book?.text ?? projectWord;
    for (const label of book.labels) {
      if (label.scope !== "chapter") continue;
      const reason = label.mismatched
        ? "number"
        : label.word !== undefined && expected !== undefined && label.word !== expected
          ? "word"
          : undefined;
      if (reason === undefined) continue;
      const keys = {
        here: `project:chapterLabel:${bookId}:${String(label.chapter)}:${label.text}`,
        ...(reason === "word" && label.word !== undefined
          ? { everywhere: `project:chapterLabel:word:${label.word}` }
          : {}),
      };
      if (quiet(keys)) continue;
      const mark: LabelMark = {
        bookId,
        label,
        reason,
        ...(expected === undefined ? {} : { expected }),
        keys,
      };
      marks.set(bookId, [...(marks.get(bookId) ?? []), mark]);
      words.add(label.word ?? label.text);
      count += 1;
    }
  }
  return {
    marks,
    count,
    words: words.size,
    books: marks.size,
    ...(projectWord === undefined ? {} : { projectWord }),
  };
};
