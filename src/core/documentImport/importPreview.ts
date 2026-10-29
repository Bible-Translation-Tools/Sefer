import { Refusal, trustedBy, type Book, type Receipt } from "@sefer/text/book";
import type { Change, SourceStamp } from "@sefer/text/source";
import { Result } from "effect";

import { overlayText } from "../fixes/fixes";
import type { GalleyService } from "../galley";

// A document's USFM brought into an existing book: the scope's chapters are
// replaced whole, everything else is left as it was, and the result is one
// change so a single Undo takes it back.

/** The chapters to replace; `undefined` is every chapter the document holds. */
export type ImportChapters = { readonly from: number; readonly to: number } | undefined;

export interface ImportPreview {
  readonly bookId: string;
  /** The book as it would read after the import. */
  readonly text: string;
  /** One change, in before-text coordinates. Empty when nothing would change. */
  readonly changes: readonly Change[];
  readonly stamp: SourceStamp;
  /** Chapters taken from the document. */
  readonly replaced: readonly number[];
  /** Chapters in the scope that the document does not hold; left as they were. */
  readonly absent: readonly number[];
  /** Verses ("2:7") the book had in the replaced chapters that the result does not. */
  readonly lost: readonly string[];
  /** The document had text before its first chapter, which an existing book keeps its own header for. */
  readonly frontSkipped: boolean;
  /** Whether the book's paragraphing was laid over the document's. */
  readonly overlaid: boolean;
}

export const previewImport = (
  galley: GalleyService,
  book: Book,
  imported: string,
  chapters: ImportChapters,
  keepParagraphing: boolean,
): Result.Result<ImportPreview, { readonly description: string }> => {
  const source = book.source();
  const current = split(source.text);
  const incoming = split(imported);
  const inScope = (n: number) => chapters === undefined || (n >= chapters.from && n <= chapters.to);

  const replaced = [...incoming.chapters.keys()].filter(inScope);
  const wanted =
    chapters === undefined
      ? replaced
      : Array.from({ length: chapters.to - chapters.from + 1 }, (_, i) => chapters.from + i);
  const absent = wanted.filter((n) => !incoming.chapters.has(n) && current.chapters.has(n));

  const empty = current.chapters.size === 0 && current.header.trim() === "";
  const header = empty ? incoming.header : current.header;
  const merged = new Map(current.chapters);
  for (const n of replaced) merged.set(n, incoming.chapters.get(n)!);
  const body = [...merged.keys()]
    .sort((a, b) => a - b)
    .map((n) => withNewline(merged.get(n)!))
    .join("");
  const spliced = withNewline(header) + body;

  const overlaid = keepParagraphing && replaced.some((n) => current.chapters.has(n));
  let text = spliced;
  if (overlaid) {
    const laid = overlayText(galley, spliced, source.text);
    if (Result.isFailure(laid)) return Result.fail({ description: laid.failure.description });
    text = laid.success;
  }

  const after = split(text);
  const lost = replaced.flatMap((n) => {
    const kept = new Set(versesOf(after.chapters.get(n) ?? ""));
    return versesOf(current.chapters.get(n) ?? "")
      .filter((v) => !kept.has(v))
      .map((v) => `${n}:${v}`);
  });

  return Result.succeed({
    bookId: book.id,
    text,
    changes: oneChange(source.text, text),
    stamp: source.stamp,
    replaced,
    absent,
    lost,
    frontSkipped: !empty && stripId(incoming.header).trim() !== "",
    overlaid,
  });
};

/** Trusted, like overlay and format: the translator previewed the whole replacement. */
export const applyImport = (
  preview: ImportPreview,
  book: Book,
): Result.Result<Receipt, Refusal> => {
  if (book.source().stamp.revision !== preview.stamp.revision) {
    return Result.fail(
      new Refusal({
        rule: "import.stale",
        reason: "stale",
        description: "the book changed after the preview was made",
      }),
    );
  }
  return book.apply(preview.changes, "import", trustedBy("import"));
};

/** The word a book labels its chapters with (`\cl Psalm` before `\c 1`), for the importer's chapter words. */
export const chapterWordOf = (text: string): string | undefined => {
  const header = split(text).header;
  const word = /^\\cl\s+(.+)$/m.exec(header)?.[1]?.replace(/\d+/g, "").trim();
  return word === "" ? undefined : word;
};

const CHAPTER = /^\\c\s+(\d+)/gm;

function split(text: string) {
  const starts = [...text.matchAll(CHAPTER)];
  const chapters = new Map<number, string>();
  starts.forEach((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
    const n = Number(m[1]);
    // A repeated chapter number keeps its first block; the rest stays in it as text.
    if (!chapters.has(n)) chapters.set(n, text.slice(m.index, end));
    else chapters.set(n, chapters.get(n)! + text.slice(m.index, end));
  });
  return { header: starts.length > 0 ? text.slice(0, starts[0].index) : text, chapters };
}

function versesOf(chapter: string) {
  return [...chapter.matchAll(/\\v\s+(\S+)/g)].map((m) => m[1]);
}

function withNewline(text: string) {
  return text === "" || text.endsWith("\n") ? text : `${text}\n`;
}

function stripId(header: string) {
  return header.replace(/^\\id\b.*$/m, "");
}

function oneChange(before: string, after: string): readonly Change[] {
  if (before === after) return [];
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  return [{ from: start, to: before.length - end, insert: after.slice(start, after.length - end) }];
}
