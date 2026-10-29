// What a .docx or .odt says, before any reading of verses: both readers produce
// this one shape, so verse detection and USFM rendering are written once.

export type Format = "docx" | "odt";

export interface Formatting {
  superscript: boolean;
  italic: boolean;
  bold: boolean;
}

export type Inline =
  | ({ kind: "text"; text: string } & Formatting)
  // A line break inside the paragraph (Shift+Enter in Word, a line break in Writer).
  | { kind: "break" }
  // Where a footnote or endnote's reference mark sits; the body is in `Reading.notes`.
  | { kind: "note"; id: string }
  | { kind: "commentStart"; id: string }
  | { kind: "commentEnd"; id: string };

/** What the paragraph's style name says it is. */
export type Role = "title" | "heading" | "quote" | null;

export interface Paragraph {
  /** The paragraph style's display name, e.g. "Heading 1", "Quote", "q1". */
  style: string | null;
  role: Role;
  /** Heading level from the style or the outline level, 1 for the top. */
  level: number;
  /** Left indent in points, resolved through the style chain. */
  indent: number;
  align: "start" | "center" | "end" | "justify" | null;
  list: boolean;
  table: boolean;
  inlines: Inline[];
}

export interface Note {
  id: string;
  kind: "footnote" | "endnote";
  text: string;
}

export interface Comment {
  id: string;
  author: string;
  date: string | null;
  text: string;
  parentId: string | null;
  resolved: boolean;
}

export interface Reading {
  format: Format;
  paragraphs: Paragraph[];
  notes: Map<string, Note>;
  comments: Map<string, Comment>;
  /** Insertions, deletions and moves still tracked. The reading accepts them all. */
  trackedChanges: number;
}

export function roleOf(
  name: string | null,
  outlineLevel: number | null,
): { role: Role; level: number } {
  const n = (name ?? "").trim().toLowerCase();
  if (/^(title|subtitle)\b/.test(n)) return { role: "title", level: n.startsWith("sub") ? 2 : 1 };
  const heading = /^heading\s*(\d)?/.exec(n);
  if (heading) return { role: "heading", level: Number(heading[1] ?? 1) };
  if (/\bquot(e|ation)/.test(n)) return { role: "quote", level: 1 };
  if (outlineLevel !== null) return { role: "heading", level: outlineLevel };
  return { role: null, level: 0 };
}

const LENGTH = /^(-?[\d.]+)\s*(pt|in|cm|mm|pc|px)?$/;
const POINTS: Record<string, number> = {
  pt: 1,
  in: 72,
  cm: 72 / 2.54,
  mm: 72 / 25.4,
  pc: 12,
  px: 0.75,
};

/** An ODF length such as "0.5in" or "1.27cm", in points. */
export function points(length: string | null): number | null {
  const m = length ? LENGTH.exec(length.trim()) : null;
  return m ? Number(m[1]) * POINTS[m[2] ?? "pt"] : null;
}
