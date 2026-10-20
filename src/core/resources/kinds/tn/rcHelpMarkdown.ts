import MarkdownIt from "markdown-it";

export type Span =
  | { readonly kind: "book" }
  | { readonly kind: "chapter"; readonly chapter: number }
  | {
      readonly kind: "chunk";
      readonly chapter: number;
      readonly first: number;
      readonly last?: number;
    };

export interface NoteRecord {
  readonly span: Span;
  readonly ordinal: number;
  readonly heading?: string;
  readonly quote?: string;
  readonly body: string;
}

export interface BookFile {
  readonly path: string;
  readonly text: string;
}

export type BookRead =
  | {
      readonly kind: "read";
      readonly notes: readonly NoteRecord[];
      readonly skipped: readonly string[];
    }
  | { readonly kind: "refused"; readonly description: string };

const markdown = new MarkdownIt({ html: false });

/** Where each line begins, so a parser's line map becomes offsets into the exact text. */
const lineStarts = (text: string): readonly number[] => {
  const starts = [0];
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
  return starts;
};

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

const numberOf = (name: string): number | undefined => {
  if (name === "" || [...name].some((char) => char < "0" || char > "9")) return undefined;
  return Number.parseInt(name, 10);
};

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
