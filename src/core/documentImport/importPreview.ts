import { Refusal, trustedBy, type Book, type Receipt } from "@sefer/text/book";
import type { Change, SourceStamp } from "@sefer/text/source";
import { Result } from "effect";

import { overlayText } from "../fixes/fixes";
import type { GalleyService } from "../galley";

// A document's USFM brought into an existing book: the scope's chapters are
// replaced whole, everything else is left as it was, and the result is one
// change so a single Undo takes it back. A replaced chapter keeps the book's
// own `\cl` label when the document gives it none (Psalms' "Psalm 3").

/** The chapters to replace; `undefined` is every chapter the document holds. */
export type ImportChapters = { readonly from: number; readonly to: number } | undefined;

export interface ImportOptions {
  /** The book's own paragraph and poetry breaks, laid over the replaced chapters. */
  readonly keepParagraphing: boolean;
  /** The book's header (`\id`, `\h`, `\toc`, `\mt`), not the document's text before chapter 1. */
  readonly keepFrontMatter: boolean;
}

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
  /** The document had text before its first chapter, left out because the book keeps its own header. */
  readonly frontSkipped: boolean;
  /** Chapters whose `\cl` label was the book's, kept because the document gave none. */
  readonly labelsKept: readonly number[];
  /** Whether the book's paragraphing was laid over the document's. */
  readonly overlaid: boolean;
}

export const previewImport = (
  galley: GalleyService,
  book: Book,
  imported: string,
  chapters: ImportChapters,
  options: ImportOptions,
): Result.Result<ImportPreview, { readonly description: string }> => {
  const { keepParagraphing, keepFrontMatter } = options;
  const source = book.source();
  const current = split(source.text);
  const incoming = split(imported);
  const inScope = (n: number) => chapters === undefined || (n >= chapters.from && n <= chapters.to);

  const replaced = [...new Set(incoming.blocks.map((b) => b.n))].filter(inScope);
  const wanted =
    chapters === undefined
      ? replaced
      : Array.from({ length: chapters.to - chapters.from + 1 }, (_, i) => chapters.from + i);
  const held = new Set(current.blocks.map((b) => b.n));
  const absent = wanted.filter((n) => !replaced.includes(n) && held.has(n));

  const empty = current.blocks.length === 0 && current.header.trim() === "";
  const parts = merge(current.blocks, incoming.blocks, replaced);
  // The document's text before chapter 1, under the book's own `\id` line.
  const theirsAbove = () => {
    const id = /^\\id\b.*$/m.exec(current.header)?.[0];
    const rest = stripId(incoming.header).replace(/^\s*\n/, "");
    return id === undefined ? incoming.header : `${id}\n${rest}`;
  };
  const header = empty ? incoming.header : keepFrontMatter ? current.header : theirsAbove();
  const spliced = join(header, parts);

  let overlaid = keepParagraphing && replaced.some((n) => held.has(n));
  let final = parts;
  if (overlaid) {
    const laid = overlayText(galley, spliced, source.text);
    if (Result.isFailure(laid)) return Result.fail({ description: laid.failure.description });
    // Only the replaced chapters take the overlay's result: it is not idempotent,
    // and the chapters left alone must stay byte for byte as they were.
    const blocks = split(laid.success).blocks;
    if (blocks.length === parts.length && blocks.every((b, i) => b.n === parts[i].n)) {
      final = parts.map((part, i) => (part.ours ? { ...part, text: blocks[i].text } : part));
    } else {
      overlaid = false;
    }
  }
  // The book's chapter label, put back where the document gave its chapter none.
  const labelsKept: number[] = [];
  final = final.map((part) => {
    if (!part.ours || CHAPTER_LABEL.test(part.text)) return part;
    const own = current.blocks.find((b) => b.n === part.n)?.text;
    const label = own === undefined ? undefined : CHAPTER_LABEL.exec(own)?.[0];
    if (label === undefined) return part;
    labelsKept.push(part.n);
    return { ...part, text: afterChapterLine(part.text, label) };
  });
  const text = join(header, final);

  const lost = replaced.flatMap((n) => {
    const kept = new Set(versesOf(final.find((p) => p.n === n && p.ours)?.text ?? ""));
    return versesOf(current.blocks.find((b) => b.n === n)?.text ?? "")
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
    frontSkipped: !empty && keepFrontMatter && stripId(incoming.header).trim() !== "",
    labelsKept,
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

// A chapter marker wherever it stands, line start or not.
const CHAPTER = /(?<=^|\s)\\c\s+(\d+)/g;

// A chapter's own label line: `\cl Psalm 3`.
const CHAPTER_LABEL = /^\\cl\b.*$/m;

/** `line` on its own line straight after the block's `\c N` line. */
function afterChapterLine(block: string, line: string) {
  const end = block.indexOf("\n");
  if (end < 0) return `${block}\n${line}\n`;
  return `${block.slice(0, end + 1)}${line}\n${block.slice(end + 1)}`;
}

interface Block {
  readonly n: number;
  /** From its `\c` up to the next `\c`, exactly as written. */
  readonly text: string;
}

interface Part extends Block {
  /** Taken from the document; otherwise the book's own block, untouched. */
  readonly ours: boolean;
}

function split(text: string) {
  const starts = [...text.matchAll(CHAPTER)];
  const blocks: Block[] = starts.map((m, i) => ({
    n: Number(m[1]),
    text: text.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : text.length),
  }));
  return { header: starts.length > 0 ? text.slice(0, starts[0].index) : text, blocks };
}

// The book's chapters in the book's own order. A replaced chapter takes the
// first block with its number (a repeat later on is the book's and stays); a
// chapter only the document has goes before the first higher-numbered one.
function merge(book: readonly Block[], document: readonly Block[], replaced: readonly number[]) {
  const theirs = (n: number) =>
    document
      .filter((b) => b.n === n)
      .map((b) => b.text)
      .join("");
  const parts: Part[] = [];
  const placed = new Set<number>();
  for (const block of book) {
    if (replaced.includes(block.n) && !placed.has(block.n)) {
      parts.push({ n: block.n, text: theirs(block.n), ours: true });
      placed.add(block.n);
    } else {
      parts.push({ ...block, ours: false });
    }
  }
  for (const n of [...replaced].sort((a, b) => a - b)) {
    if (placed.has(n)) continue;
    const at = parts.findIndex((p) => p.n > n);
    parts.splice(at < 0 ? parts.length : at, 0, { n, text: theirs(n), ours: true });
  }
  return parts;
}

// The book's own text is joined as it was; a line break is added only where a
// block from the document would otherwise run on from the text before it.
function join(header: string, parts: readonly Part[]) {
  let text = header;
  parts.forEach((part, i) => {
    const touches = part.ours || parts[i - 1]?.ours === true;
    if (touches && text !== "" && !/\s$/.test(text)) text += "\n";
    text += part.text;
  });
  return text;
}

function versesOf(chapter: string) {
  return [...chapter.matchAll(/\\v\s+(\S+)/g)].map((m) => m[1]);
}

function stripId(header: string) {
  return header.replace(/^\\id\b.*$/m, "");
}

function oneChange(before: string, after: string): readonly Change[] {
  if (before === after) return [];
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  // Never split a surrogate pair: a boundary just after a high surrogate, or
  // just before a low one, moves outward to take the whole character.
  if (start > 0 && isHigh(before.charCodeAt(start - 1))) start--;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  if (end > 0 && isLow(before.charCodeAt(before.length - end))) end--;
  return [{ from: start, to: before.length - end, insert: after.slice(start, after.length - end) }];
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;
