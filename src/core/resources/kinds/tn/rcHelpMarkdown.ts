/**
 * The reader for rc0.2's help layout in Markdown — WA's `en_tn` — and the
 * only place its grammar, and the convention on top of it, is written down.
 *
 * Pure: bytes in (one book's files, as text), records out. It imports a
 * Markdown parser and nothing of Sefer's but `Address`'s vocabulary, so it
 * would move to a utilities repository unchanged; nothing about Sefer is
 * needed to read a notes file.
 *
 * ## Spec
 *
 * rc0.2's container-types page: a `help` is "structured in the same way as a
 * book" — a directory per chapter holding chunk files, `intro.md` beside them,
 * a `front/` directory for the book's own front matter — "helps are split by
 * Markdown headings", and "all help RCs must use the markdown format".
 *
 * ## Convention, not spec
 *
 * That a chunk file's NUMBER is its first verse, and that its range closes at
 * the next sibling's number (`rom/01/28.md` covers 28–29 when the next file is
 * `30.md`), and that the last chunk of a chapter runs to the chapter's end. The
 * spec says none of this; WA's and unfoldingWord's tools do it. It lives in
 * `closeAtNextSibling`, named for what it is, and nowhere else. A chapter's
 * last chunk therefore has no last verse here: closing it needs a verse count,
 * which is versification, and that is the caller's to lend (`note.ts`).
 *
 * ## What is not a note
 *
 * `index.md` (a chapter's translationWords links, 48 of them in `en_tn`) and
 * `title.md` are not notes, and a file the grammar does not name is not
 * guessed at: each is listed in `skipped`, so a pack says what it left out.
 * Two files claiming one place (`1.md` and `01.md`) refuse the book — the
 * reader will not choose between them.
 */

import MarkdownIt from "markdown-it";

/**
 * Where a note sits, as the layout says it: before it becomes an `Address`,
 * because the last chunk of a chapter cannot become one on its own.
 *
 *  - `book`      `front/intro.md`, the book's introduction.
 *  - `chapter`   `NN/intro.md`, a chapter's introduction.
 *  - `chunk`     `NN/VV.md`: verses `first` to `last`; `last` absent when it is
 *                the chapter's final chunk and runs to the chapter's end.
 */
export type Span =
  | { readonly kind: "book" }
  | { readonly kind: "chapter"; readonly chapter: number }
  | {
      readonly kind: "chunk";
      readonly chapter: number;
      readonly first: number;
      readonly last?: number;
    };

/** One note as the reader yields it: where, which one there, and its exact text. */
export interface NoteRecord {
  readonly span: Span;
  /** Position among the notes of one file, from 0. Headings repeat, so this is the identity. */
  readonly ordinal: number;
  /** The heading line(s) exactly as written, newline included; absent for text before any heading. */
  readonly heading?: string;
  /** The heading's own words: in WA's notes, the phrase of the ULB being explained. */
  readonly quote?: string;
  /** The Markdown under the heading, exactly, up to the next heading. */
  readonly body: string;
}

/** One file of a book's directory: its path below the book (`01/28.md`) and its text. */
export interface BookFile {
  readonly path: string;
  readonly text: string;
}

export type BookRead =
  | {
      readonly kind: "read";
      readonly notes: readonly NoteRecord[];
      /** Files the grammar does not make notes of, with why. */
      readonly skipped: readonly string[];
    }
  | { readonly kind: "refused"; readonly description: string };

// `html: false`: a note's raw HTML is text, never markup. The reader does not
// render, but the same options are the ones a renderer must use, and one
// parser configured two ways would split differently from how it draws.
const markdown = new MarkdownIt({ html: false });

/** Where each line begins, so a parser's line map becomes offsets into the exact text. */
const lineStarts = (text: string): readonly number[] => {
  const starts = [0];
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
  return starts;
};

/**
 * A file's notes: one per top-level `#` heading, and one for any text before
 * the first heading (ten `en_tn` files have none at all).
 *
 * The parser finds the headings, so a `#` inside a code block or a list is
 * not one; the CUT is made in the original text at the lines the parser
 * names, so heading and body together are the file's bytes exactly, and the
 * notes of a file, concatenated, are the file.
 */
const splitNotes = (text: string): readonly Pick<NoteRecord, "heading" | "quote" | "body">[] => {
  const tokens = markdown.parse(text, {});
  const starts = lineStarts(text);
  const offset = (line: number): number => starts[line] ?? text.length;
  const heads: { readonly from: number; readonly to: number; readonly quote: string }[] = [];
  tokens.forEach((token, index) => {
    if (token.type !== "heading_open" || token.tag !== "h1" || token.level !== 0) return;
    if (token.map === null) return;
    heads.push({
      from: offset(token.map[0]),
      to: offset(token.map[1]),
      quote: tokens[index + 1]?.content ?? "",
    });
  });
  const notes: Pick<NoteRecord, "heading" | "quote" | "body">[] = [];
  const preamble = text.slice(0, heads[0]?.from ?? text.length);
  if (preamble.trim() !== "") notes.push({ body: preamble });
  heads.forEach((head, index) => {
    const end = heads[index + 1]?.from ?? text.length;
    notes.push({
      heading: text.slice(head.from, head.to),
      ...(head.quote === "" ? {} : { quote: head.quote }),
      body: text.slice(head.to, end),
    });
  });
  return notes;
};

/** `"028"` → 28; anything that is not all digits is not a number of the layout. */
const numberOf = (name: string): number | undefined => {
  if (name === "" || [...name].some((char) => char < "0" || char > "9")) return undefined;
  return Number.parseInt(name, 10);
};

/**
 * CONVENTION, NOT SPEC: a chunk's number is its first verse, and its range
 * closes one before the next chunk's number. The last chunk is left open —
 * it runs to the chapter's end, which only a verse count can name.
 */
const closeAtNextSibling = (
  chapter: number,
  firsts: readonly number[],
): readonly Extract<Span, { kind: "chunk" }>[] => {
  const sorted = [...firsts].sort((a, b) => a - b);
  return sorted.map((first, index) => {
    const next = sorted[index + 1];
    return next === undefined
      ? { kind: "chunk", chapter, first }
      : { kind: "chunk", chapter, first, last: Math.max(first, next - 1) };
  });
};

/** A path's place in the layout, or why it has none. */
type Placed =
  | { readonly kind: "book" }
  | { readonly kind: "chapter"; readonly chapter: number }
  | { readonly kind: "chunk"; readonly chapter: number; readonly first: number }
  | { readonly kind: "skip"; readonly why: string };

const place = (path: string): Placed => {
  const parts = path.split("/");
  const [directory, file, ...deeper] = parts;
  if (directory === undefined || file === undefined || deeper.length > 0)
    return { kind: "skip", why: "not a chapter directory's file" };
  if (!file.toLowerCase().endsWith(".md")) return { kind: "skip", why: "not Markdown" };
  const stem = file.slice(0, -3);
  if (directory === "front")
    return stem === "intro" ? { kind: "book" } : { kind: "skip", why: "front matter not read" };
  const chapter = numberOf(directory);
  if (chapter === undefined) return { kind: "skip", why: "not a chapter directory" };
  if (stem === "intro") return { kind: "chapter", chapter };
  const first = numberOf(stem);
  if (first === undefined) return { kind: "skip", why: `${stem}.md is not a chunk` };
  return { kind: "chunk", chapter, first };
};

const spanKey = (span: Span): string =>
  span.kind === "book"
    ? "book"
    : span.kind === "chapter"
      ? `chapter ${span.chapter}`
      : `chunk ${span.chapter}:${span.first}`;

/**
 * One book of an rc0.2 Markdown help: every file below its directory, read
 * into notes in canonical order — the book's introduction, then chapter by
 * chapter its introduction and its chunks in verse order.
 */
export const readHelpBook = (files: readonly BookFile[]): BookRead => {
  const skipped: string[] = [];
  const byKey = new Map<string, { readonly path: string; readonly text: string }>();
  const chunkFirsts = new Map<number, number[]>();
  const spans: Span[] = [];
  for (const file of files) {
    const placed = place(file.path);
    if (placed.kind === "skip") {
      skipped.push(`${file.path}: ${placed.why}`);
      continue;
    }
    const key =
      placed.kind === "chunk" ? `chunk ${placed.chapter}:${placed.first}` : spanKey(placed);
    const already = byKey.get(key);
    if (already !== undefined)
      return {
        kind: "refused",
        description: `${already.path} and ${file.path} both claim ${key}`,
      };
    byKey.set(key, file);
    if (placed.kind === "chunk")
      chunkFirsts.set(placed.chapter, [...(chunkFirsts.get(placed.chapter) ?? []), placed.first]);
    else spans.push(placed);
  }
  for (const [chapter, firsts] of chunkFirsts) spans.push(...closeAtNextSibling(chapter, firsts));

  const order = (span: Span): readonly [number, number, number] =>
    span.kind === "book"
      ? [0, 0, 0]
      : span.kind === "chapter"
        ? [span.chapter, 0, 0]
        : [span.chapter, 1, span.first];
  spans.sort((a, b) => {
    const [x, y] = [order(a), order(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });

  const notes: NoteRecord[] = [];
  for (const span of spans) {
    const file = byKey.get(spanKey(span));
    if (file === undefined) continue;
    splitNotes(file.text).forEach((note, ordinal) => notes.push({ span, ordinal, ...note }));
  }
  return { kind: "read", notes, skipped };
};
