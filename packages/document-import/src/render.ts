import type { Comment, Inline, Paragraph, Reading } from "./model.ts";
import { accepts, candidates, detectMode, gapFor, nextVerse } from "./verses.ts";
import type { CandidateKind, VerseMode } from "./verses.ts";

// Turns a reading into USFM. Every paragraph of the document stays a paragraph,
// in order; what each one becomes is a guess the report names, and every guess
// has a setting that turns it off. Nothing is merged, reordered or repaired.

export type Keep = "keep" | "unwrap";

export interface Settings {
  /** Book code for the \id line. Without it, no \id line is written. */
  book?: string;
  /** How verse numbers are written; "auto" (the default) detects it. */
  verses?: VerseMode | "auto";
  /** Words that label a chapter, as in "Chapter 3". A label without a number is the next chapter. */
  chapterWords?: string[];
  /** The chapter's verse count; a larger number is never a verse. Optional until a canon is available. */
  versification?: (chapter: number) => number | undefined;
  /** Indented, italic, Quote-styled or short-lined paragraphs: \q1–\q3, or \p. */
  poetry?: Keep;
  /** Heading paragraphs: \s1, \rem, or left out. */
  headings?: "keep" | "rem" | "drop";
  /** Text before the first verse: \rem, \mt, or left out. */
  front?: "rem" | "mt" | "drop";
  notes?: "keep" | "drop";
  italic?: Keep;
  bold?: Keep;
  /** Numbered and bulleted paragraphs: \li1, or \p. */
  lists?: Keep;
  /** Paragraph styles named after a USFM marker ("q2", "s1 - Heading"): that marker, or ignored. */
  styleMarkers?: Keep;
  comments?: "keep" | "drop";
  /** Renames paragraph markers last, e.g. { q2: "q1", li1: "p" }. */
  markers?: Record<string, string>;
}

export interface Rendered {
  usfm: string;
  report: Report;
  comments: CommentThread[];
}

export interface Report {
  /** "usfm" when the document already holds USFM markers, copied through as text. */
  source: "document" | "usfm";
  verses: VerseMode;
  detected: VerseMode;
  /** How many numbers of each kind the document holds, before sequence checks. */
  candidates: Record<CandidateKind, number>;
  chapters: ChapterSummary[];
  /** What the document holds, whatever the settings do with it: the switches a host offers. */
  found: Found;
  /** Numbers written like verse numbers that were left as text, and why. */
  skipped: Skip[];
  /** Every structural guess, with the reason. */
  guesses: Guess[];
}

export interface ChapterSummary {
  chapter: number;
  verses: number;
  last: number;
  missing: number[];
}

export interface Found {
  poetry: number;
  headings: number;
  front: number;
  notes: number;
  italic: number;
  bold: number;
  lists: number;
  tables: number;
  styleMarkers: number;
  comments: number;
  trackedChanges: number;
  lineBreaks: number;
  blankParagraphs: number;
}

export interface Skip {
  ref: string | null;
  number: string;
  reason: "sequence" | "versification" | "thousands";
}

export interface Guess {
  ref: string | null;
  marker: string;
  reason: string;
  excerpt: string;
}

/** A position in one verse's plain text (no markers), in UTF-16 code units. */
export interface VersePoint {
  ref: string;
  offset: number;
}

export interface CommentThread {
  ref: string | null;
  anchorText: string;
  start: VersePoint | null;
  end: VersePoint | null;
  /** Root first, then replies in document order. */
  comments: Comment[];
}

type Resolved = Required<Omit<Settings, "book" | "versification" | "markers">> & Settings;

const DEFAULTS: Resolved = {
  verses: "auto",
  chapterWords: ["chapter"],
  poetry: "keep",
  headings: "keep",
  front: "rem",
  notes: "keep",
  italic: "keep",
  bold: "keep",
  lists: "keep",
  styleMarkers: "keep",
  comments: "keep",
};

// Paragraph markers a style name may carry straight through (Paratext exports, house templates).
const STYLE_MARKERS = new Set([
  "p",
  "m",
  "pi",
  "pi1",
  "pi2",
  "mi",
  "nb",
  "pc",
  "pm",
  "pmo",
  "pmc",
  "pmr",
  "cls",
  "q",
  "q1",
  "q2",
  "q3",
  "q4",
  "qc",
  "qr",
  "qm",
  "qm1",
  "qm2",
  "qa",
  "qd",
  "b",
  "s",
  "s1",
  "s2",
  "s3",
  "s4",
  "ms",
  "ms1",
  "ms2",
  "mr",
  "sr",
  "r",
  "d",
  "sp",
  "cl",
  "mt",
  "mt1",
  "mt2",
  "mt3",
  "mt4",
  "imt",
  "is",
  "ip",
  "io1",
  "li",
  "li1",
  "li2",
  "li3",
  "lh",
  "lf",
]);
const STYLE_MARKER = /^\\?([a-z]+\d?)(?:$|\s|\s?-|_)/;

export function render(reading: Reading, settings: Settings = {}): Rendered {
  const s: Resolved = { ...DEFAULTS, ...settings };
  const paragraphs = reading.paragraphs.map((p) => ({ ...p, inlines: tidy(p.inlines) }));
  const found = countFound(reading, paragraphs);

  const counts = countCandidates(paragraphs);
  const detected = looksLikeUsfm(paragraphs) ? null : detectMode(counts);
  if (detected === null) {
    const usfm = paragraphs
      .map((p) =>
        p.inlines
          .map((i) => (i.kind === "text" ? i.text : i.kind === "break" ? "\n" : ""))
          .join(""),
      )
      .join("\n");
    return {
      usfm: usfm.replace(/\s+$/, "") + "\n",
      report: {
        source: "usfm",
        verses: "marked",
        detected: "marked",
        candidates: counts,
        chapters: [],
        found,
        skipped: [],
        guesses: [],
      },
      comments: [],
    };
  }
  const mode = s.verses === "auto" ? detected : s.verses;
  const scanned = scan(paragraphs, mode, s);
  const out = emit(scanned.blocks, reading, s);
  found.poetry = scanned.blocks.filter((b) => b.poetry).length;
  found.headings = scanned.blocks.filter((b) => b.kind === "heading").length;
  found.front = scanned.blocks.filter((b) => b.kind === "front").length;
  return {
    usfm: out.usfm,
    report: {
      source: "document",
      verses: mode,
      detected,
      candidates: counts,
      chapters: summarise(scanned.seen),
      found,
      skipped: scanned.skipped,
      guesses: scanned.guesses,
    },
    comments: s.comments === "keep" ? threads(reading, out.anchors) : [],
  };
}

// --- reading the document's structure -------------------------------------

type Piece =
  | { kind: "text"; text: string; italic: boolean; bold: boolean }
  | { kind: "verse"; chapter: number; sid: string }
  | { kind: "chapter"; chapter: number }
  | { kind: "line" }
  | { kind: "note"; id: string }
  | { kind: "commentStart"; id: string }
  | { kind: "commentEnd"; id: string };

interface Block {
  kind: "front" | "heading" | "chapter" | "para";
  marker: string;
  /** The \q level when the block is poetry; each line break opens another line at it. */
  poetry: number;
  /** A chapter this block opens, written before its marker. */
  chapter: number | null;
  pieces: Piece[];
}

function scan(paragraphs: Paragraph[], mode: VerseMode, s: Resolved) {
  const blocks: Block[] = [];
  const skipped: Skip[] = [];
  const guesses: Guess[] = [];
  const seen = new Map<number, Set<number>>();
  const levels = indentLevels(paragraphs);
  const label = chapterLabel(s.chapterWords);
  const labelled = paragraphs.some((p) => label.test(plain(p)));
  let chapter = 0;
  let verse = 0;
  let started = false;
  const ref = () => (verse > 0 ? `${chapter}:${verse}` : null);
  const guess = (marker: string, reason: string, text: string) =>
    guesses.push({ ref: ref(), marker, reason, excerpt: excerpt(text) });
  const record = (from: number, to: number) => {
    const set = seen.get(chapter) ?? new Set<number>();
    for (let n = from; n <= to; n++) set.add(n);
    seen.set(chapter, set);
  };

  for (const p of paragraphs) {
    const text = plain(p);
    if (!text.trim() && !p.inlines.some((i) => i.kind === "note")) continue;

    // "Chapter 3", "Chapter", or a paragraph that is only the next chapter's number.
    // A paragraph carrying a footnote is never a label: the label is dropped, the note must not be.
    const noted = p.inlines.some((i) => i.kind === "note");
    const labelMatch = noted ? null : label.exec(text);
    const bare = noted ? null : /^\s*(\d{1,3})\s*$/.exec(text);
    if (
      labelMatch ||
      (bare &&
        mode !== "perLine" &&
        Number(bare[1]) === chapter + 1 &&
        (verse > 0 || chapter === 0))
    ) {
      const n = Number(labelMatch ? (labelMatch[1] ?? chapter + 1) : bare![1]);
      if (!labelMatch) guess("c", "a paragraph holding only the next chapter's number", text);
      else if (!labelMatch[1])
        guess("c", `"${text.trim()}" without a number, counted on from the last chapter`, text);
      if (n !== chapter) {
        chapter = n;
        verse = 0;
        blocks.push({ kind: "chapter", marker: "c", poetry: 0, chapter: n, pieces: [] });
      }
      continue;
    }

    const pieces: Piece[] = [];
    let opens: number | null = null;
    const startVerse = (
      from: number,
      to: number,
      restart: boolean,
      why = "verse 1 again after a later verse, with no chapter label",
    ) => {
      if (restart || chapter === 0) {
        chapter = restart ? chapter + 1 : 1;
        if (pieces.some((x) => x.kind !== "commentStart"))
          pieces.push({ kind: "chapter", chapter });
        else opens = chapter;
        if (restart) guess("c", why, text);
      }
      verse = to;
      record(from, to);
      pieces.push({ kind: "verse", chapter, sid: from === to ? `${from}` : `${from}-${to}` });
    };

    if (mode === "perLine") {
      const isHeading = p.role === "heading" || p.role === "title";
      if (!isHeading && !(labelled && chapter === 0)) {
        const max = s.versification?.(chapter || 1);
        const full = !labelled && chapter > 0 && max !== undefined && verse >= max;
        startVerse(
          full ? 1 : verse + 1,
          full ? 1 : verse + 1,
          full,
          "the versification's verse count was reached",
        );
      }
    }

    let atLineStart = true;
    for (const inline of p.inlines) {
      if (inline.kind === "break") {
        pieces.push({ kind: "line" });
        atLineStart = true;
        continue;
      }
      if (inline.kind !== "text") {
        pieces.push(inline);
        continue;
      }
      let cursor = 0;
      const push = (to: number) => {
        if (to > cursor)
          pieces.push({
            kind: "text",
            text: inline.text.slice(cursor, to),
            italic: inline.italic,
            bold: inline.bold,
          });
      };
      for (const c of candidates(inline.text, inline.superscript, atLineStart)) {
        if (!accepts(mode, c.kind)) continue;
        const written = inline.text.slice(c.start, c.end).trim();
        if (c.thousands) {
          skipped.push({ ref: ref(), number: written, reason: "thousands" });
          continue;
        }
        const max = s.versification?.(Math.max(chapter, 1));
        const step = nextVerse(verse, c, gapFor(c.kind), c.kind !== "inline", max);
        if (!step) {
          const over = max !== undefined && c.to > max && c.from > verse;
          if (c.kind !== "inline")
            skipped.push({
              ref: ref(),
              number: written,
              reason: over ? "versification" : "sequence",
            });
          continue;
        }
        push(c.start);
        startVerse(c.from, c.to, step === "restart");
        cursor = c.end;
      }
      push(inline.text.length);
      if (inline.text.trim()) atLineStart = false;
    }

    const hasVerse = pieces.some((x) => x.kind === "verse");
    if (hasVerse) started = true;
    const block: Block = { kind: "para", marker: "p", poetry: 0, chapter: opens, pieces };

    if (!started) {
      block.kind = "front";
      block.marker = "rem";
    } else if (!hasVerse && (p.role === "heading" || p.role === "title")) {
      block.kind = "heading";
      block.marker = `s${Math.min(Math.max(p.level, 1), 3)}`;
    } else if (!hasVerse && looksLikeHeading(p, text)) {
      block.kind = "heading";
      block.marker = "s1";
      guess(
        "s1",
        p.align === "center" ? "short, centred, no verse number" : "short, bold, no verse number",
        text,
      );
    } else {
      paragraphMarker(p, block, levels, s, (marker, reason) => guess(marker, reason, text));
    }
    if (block.kind === "para" && !block.poetry) {
      for (let i = 0; i < pieces.length; i++)
        if (pieces[i].kind === "line")
          pieces[i] = { kind: "text", text: " ", italic: false, bold: false };
    }
    blocks.push(block);
  }
  return { blocks, skipped, guesses, seen };
}

function paragraphMarker(
  p: Paragraph,
  block: Block,
  levels: Map<number, number>,
  s: Resolved,
  guess: (marker: string, reason: string) => void,
) {
  const styleMarker =
    s.styleMarkers === "keep"
      ? STYLE_MARKER.exec((p.style ?? "").trim().toLowerCase())?.[1]
      : undefined;
  if (styleMarker && STYLE_MARKERS.has(styleMarker)) {
    const marker =
      styleMarker === "q" || styleMarker === "li" || styleMarker === "mt" || styleMarker === "s"
        ? `${styleMarker}1`
        : styleMarker;
    block.marker = marker;
    const q = /^q(\d)$/.exec(marker);
    if (q) block.poetry = Number(q[1]);
    if (/^s\d$/.test(marker) && !block.pieces.some((x) => x.kind === "verse"))
      block.kind = "heading";
    guess(marker, `paragraph style "${p.style}"`);
    return;
  }
  if (p.list && s.lists === "keep") {
    block.marker = "li1";
    guess("li1", "a numbered or bulleted paragraph");
    return;
  }

  const lines = lineLengths(block.pieces);
  const level = levels.get(p.indent) ?? 0;
  const italic = allItalic(block.pieces);
  const reason = level
    ? `indented ${Math.round(p.indent)}pt`
    : p.role === "quote"
      ? `paragraph style "${p.style}"`
      : italic
        ? "the whole paragraph is italic"
        : lines.length >= 2 && lines.every((n) => n <= 60)
          ? "short lines broken by hand"
          : null;
  if (!reason) return;
  const q = Math.max(level, 1);
  if (s.poetry === "unwrap") return;
  block.marker = `q${q}`;
  block.poetry = q;
  // The italics said "poetry"; they are not also emphasis.
  if (italic) for (const piece of block.pieces) if (piece.kind === "text") piece.italic = false;
  guess(`q${q}`, reason);
}

// Left indents deeper than the body text's, ranked: the first step in is \q1, the next \q2, then \q3.
function indentLevels(paragraphs: Paragraph[]) {
  const counts = new Map<number, number>();
  for (const p of paragraphs)
    if (plain(p).trim()) counts.set(p.indent, (counts.get(p.indent) ?? 0) + 1);
  const body = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const deeper = [...counts.keys()].filter((indent) => indent > body + 4).sort((a, b) => a - b);
  return new Map(deeper.map((indent, i) => [indent, Math.min(i + 1, 3)]));
}

function looksLikeHeading(p: Paragraph, text: string) {
  const trimmed = text.trim();
  if (trimmed.length > 80 || /[.,;:!?"”’]$/.test(trimmed)) return false;
  const texts = p.inlines.filter((i) => i.kind === "text" && i.text.trim());
  const bold = texts.length > 0 && texts.every((i) => i.kind === "text" && i.bold);
  return bold || p.align === "center";
}

function chapterLabel(words: readonly string[]) {
  const escaped = words.filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) return /(?!)/;
  return new RegExp(String.raw`^\s*(?:${escaped.join("|")})\.?\s*(\d{1,3})?\s*[.:]?\s*$`, "iu");
}

// A document that already holds USFM (pasted into Word, say): copied through as text.
function looksLikeUsfm(paragraphs: Paragraph[]) {
  let markers = 0;
  let verses = false;
  for (const p of paragraphs) {
    const text = plain(p);
    if (/^\s*\\(id|c|v|p|m|q\d?|s\d?|h|mt\d?|toc\d)(\s|$)/.test(text)) markers++;
    if (/\\v\s+\d/.test(text)) verses = true;
  }
  return verses && markers >= 3;
}

// --- writing USFM ------------------------------------------------------------

interface Anchor {
  start: VersePoint | null;
  end: VersePoint | null;
  text: string;
}

function emit(blocks: Block[], reading: Reading, s: Resolved) {
  const lines: string[] = [];
  const verseText = new Map<string, string>();
  const anchors = new Map<string, Anchor>();
  const open = new Set<string>();
  let line = "";
  let current: string | null = null;
  const rename = (marker: string) => s.markers?.[marker] ?? marker;
  const flush = () => {
    const tidied = line.replace(/[ \t]+/g, " ").trim();
    if (tidied) lines.push(tidied);
    line = "";
  };
  const here = (): VersePoint | null =>
    current ? { ref: current, offset: verseText.get(current)!.length } : null;
  const footnote = (id: string) => {
    const note = reading.notes.get(id);
    if (!note || s.notes === "drop") return "";
    const fr = current ? `\\fr ${current.replace(/-\d+$/, "")} ` : "";
    return `\\f + ${fr}\\ft ${note.text}\\f*`;
  };
  const plainText = (text: string) => {
    for (const id of open) anchors.get(id)!.text += text;
    if (current) verseText.set(current, collapse(verseText.get(current)!, text));
  };
  const chapterLine = (n: number) => {
    flush();
    lines.push(`\\c ${n}`);
    current = null;
  };
  if (s.book) lines.push(`\\id ${s.book}`);

  let mtCount = 0;
  for (const block of blocks) {
    if (block.kind === "chapter") {
      chapterLine(block.chapter!);
      continue;
    }
    if (block.chapter !== null) chapterLine(block.chapter);
    const text = block.pieces
      .map((x) =>
        x.kind === "text"
          ? x.text
          : x.kind === "line"
            ? " "
            : x.kind === "note"
              ? footnote(x.id)
              : "",
      )
      .join("")
      .replace(/\s+/g, " ")
      .replace(/ \\f \+/g, "\\f +")
      .trim();

    if (block.kind === "front" || block.kind === "heading") {
      const choice = block.kind === "front" ? s.front : s.headings;
      if (choice === "drop" || !text) continue;
      const marker =
        choice === "rem"
          ? "rem"
          : block.kind === "front"
            ? mtCount++ === 0
              ? "mt1"
              : "mt2"
            : block.marker;
      flush();
      lines.push(`\\${rename(marker)} ${text}`);
      continue;
    }

    flush();
    lines.push(`\\${rename(block.marker)}`);
    plainText(" ");
    for (const piece of block.pieces) {
      switch (piece.kind) {
        case "text": {
          plainText(piece.text);
          const italic = piece.italic && s.italic === "keep";
          const bold = piece.bold && s.bold === "keep";
          if (!italic && !bold) {
            line += piece.text;
            break;
          }
          const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(piece.text)!;
          let wrapped = core;
          if (italic) wrapped = `\\it ${wrapped}\\it*`;
          if (bold) wrapped = `\\bd ${wrapped}\\bd*`;
          line += core ? lead + wrapped + trail : piece.text;
          break;
        }
        case "verse":
          flush();
          current = `${piece.chapter}:${piece.sid}`;
          verseText.set(current, "");
          line = `\\v ${piece.sid} `;
          break;
        case "chapter":
          chapterLine(piece.chapter);
          lines.push(`\\${rename(block.marker)}`);
          break;
        case "line":
          flush();
          lines.push(`\\${rename(`q${block.poetry}`)}`);
          plainText(" ");
          break;
        case "note": {
          const marker = footnote(piece.id);
          if (marker) line = line.replace(/\s+$/, "") + marker;
          break;
        }
        case "commentStart":
          anchors.set(piece.id, { start: here(), end: null, text: "" });
          open.add(piece.id);
          break;
        case "commentEnd": {
          const anchor = anchors.get(piece.id);
          if (anchor) anchor.end = here();
          open.delete(piece.id);
          break;
        }
      }
    }
    flush();
  }

  // Pull comment ranges in off the collapsed spaces at either side.
  for (const [key, text] of verseText) verseText.set(key, text.trimEnd());
  for (const { start, end } of anchors.values()) {
    if (start && verseText.get(start.ref)![start.offset] === " ") start.offset++;
    if (end && verseText.get(end.ref)![end.offset - 1] === " ") end.offset--;
    if (end) end.offset = Math.min(end.offset, verseText.get(end.ref)!.length);
  }
  return { usfm: lines.join("\n") + "\n", anchors };
}

function threads(reading: Reading, anchors: Map<string, Anchor>): CommentThread[] {
  const rootOf = (id: string, depth = 0): string => {
    const parent = reading.comments.get(id)?.parentId;
    return parent && parent !== id && depth < 50 ? rootOf(parent, depth + 1) : id;
  };
  const byRoot = new Map<string, CommentThread>();
  for (const comment of reading.comments.values()) {
    const root = rootOf(comment.id);
    let thread = byRoot.get(root);
    if (!thread) {
      const anchor = anchors.get(root) ?? anchors.get(comment.id);
      thread = {
        ref: anchor?.start?.ref ?? null,
        anchorText: (anchor?.text ?? "").replace(/\s+/g, " ").trim(),
        start: anchor?.start ?? null,
        end: anchor?.end ?? anchor?.start ?? null, // a point comment has no end
        comments: [],
      };
      byRoot.set(root, thread);
    }
    if (comment.id === root) thread.comments.unshift(comment);
    else thread.comments.push(comment);
  }
  return [...byRoot.values()];
}

// --- small helpers -------------------------------------------------------------

// Whitespace-only runs take the formatting before them, so "¹" + " " in two
// superscript-and-not runs reads as one superscript "1 "; then equal neighbours merge.
function tidy(inlines: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const inline of inlines) {
    const last = out.at(-1);
    if (inline.kind === "text" && last?.kind === "text") {
      const same =
        last.superscript === inline.superscript &&
        last.italic === inline.italic &&
        last.bold === inline.bold;
      if (same || !inline.text.trim()) {
        last.text += inline.text;
        continue;
      }
    }
    out.push(inline.kind === "text" ? { ...inline } : inline);
  }
  return out;
}

function plain(p: Paragraph) {
  return p.inlines
    .map((i) => (i.kind === "text" ? i.text : i.kind === "break" ? " " : ""))
    .join("");
}

function lineLengths(pieces: Piece[]) {
  const lengths = [0];
  for (const piece of pieces) {
    if (piece.kind === "line") lengths.push(0);
    else if (piece.kind === "text") lengths[lengths.length - 1] += piece.text.trim().length;
  }
  return lengths.length > 1 ? lengths.filter((n) => n > 0) : [];
}

function allItalic(pieces: Piece[]) {
  const texts = pieces.filter(
    (x): x is Extract<Piece, { kind: "text" }> => x.kind === "text" && x.text.trim() !== "",
  );
  return texts.length > 0 && texts.every((x) => x.italic);
}

function countCandidates(paragraphs: Paragraph[]) {
  const counts: Record<CandidateKind, number> = {
    superscript: 0,
    alone: 0,
    marked: 0,
    lineStart: 0,
    inline: 0,
  };
  for (const p of paragraphs) {
    let atLineStart = true;
    for (const inline of p.inlines) {
      if (inline.kind === "break") atLineStart = true;
      if (inline.kind !== "text") continue;
      for (const c of candidates(inline.text, inline.superscript, atLineStart))
        if (!c.thousands) counts[c.kind]++;
      if (inline.text.trim()) atLineStart = false;
    }
  }
  return counts;
}

function countFound(reading: Reading, paragraphs: Paragraph[]): Found {
  let italic = 0;
  let bold = 0;
  let lineBreaks = 0;
  for (const p of paragraphs) {
    for (const i of p.inlines) {
      if (i.kind === "break") lineBreaks++;
      if (i.kind !== "text" || !i.text.trim()) continue;
      if (i.italic) italic++;
      if (i.bold) bold++;
    }
  }
  return {
    poetry: 0,
    headings: 0,
    front: 0,
    notes: reading.notes.size,
    italic,
    bold,
    lists: paragraphs.filter((p) => p.list && plain(p).trim()).length,
    tables: paragraphs.filter((p) => p.table && plain(p).trim()).length,
    styleMarkers: paragraphs.filter((p) =>
      STYLE_MARKERS.has(STYLE_MARKER.exec((p.style ?? "").trim().toLowerCase())?.[1] ?? ""),
    ).length,
    comments: reading.comments.size,
    trackedChanges: reading.trackedChanges,
    lineBreaks,
    blankParagraphs: paragraphs.filter(
      (p) => !plain(p).trim() && !p.inlines.some((i) => i.kind === "note"),
    ).length,
  };
}

function summarise(seen: Map<number, Set<number>>): ChapterSummary[] {
  return [...seen].map(([chapter, verses]) => {
    const last = Math.max(...verses);
    const missing: number[] = [];
    for (let n = 1; n <= last; n++) if (!verses.has(n)) missing.push(n);
    return { chapter, verses: verses.size, last, missing };
  });
}

function collapse(current: string, text: string) {
  let out = current;
  for (const ch of text) {
    if (!/\s/.test(ch)) out += ch;
    else if (out && !out.endsWith(" ")) out += " ";
  }
  return out;
}

function excerpt(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}
