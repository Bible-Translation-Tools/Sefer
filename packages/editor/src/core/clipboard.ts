import { Facet, type EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Category, CloseReason, MARKERS, MarkerKind } from "@sefer/text/engine/analysis";

import { isVisual } from "./kernel";
import { scanCst, type CstScan, type NodeFacts } from "./model/cst";
import { docText, structureAt } from "./model/docStructure";
import { isMapped, opensBlock } from "./model/mapping";
import { assignmentAt } from "./model/registry";

/**
 * What a copy puts on the clipboard, Word's way: the words a reader sees as
 * `text/plain`, the same words styled as `text/html`, and the USFM behind them
 * in Sefer's own flavour, which a paste inside Sefer prefers.
 *
 * The USFM is WIDENED before it is written, because a selection made in
 * Reading starts and ends between markers the reader cannot see:
 *
 *  - character formatting always comes: half a bold word copies bold, the
 *    fragment wrapped in the character markers it sits inside;
 *  - a block's marker comes when the selection reaches the block's end, or
 *    runs on past it (Word's paragraph mark): a title selected through its
 *    end copies as `\s1 …`;
 *  - a note comes whole when any of it is in the selection.
 */
const USFM_FLAVOUR = "application/x-sefer-usfm";

/** The private flavour's payload: the widened USFM, and which document it came from. */
interface CopiedUsfm {
  readonly usfm: string;
  /** The `clipboardOrigin` of the surface it was copied from; `null` for one that has none. */
  readonly origin: string | null;
}

/**
 * Which document a surface shows, for a paste to tell "moved within my own
 * text" from "brought in from elsewhere". A seated book sets its id; a
 * reference sets nothing, so a copy from it is always foreign.
 */
export const clipboardOrigin = Facet.define<string, string | null>({
  combine: (values) => values[0] ?? null,
});

interface Copied {
  readonly text: string;
  readonly html: string;
  readonly usfm: string;
}

const isChar = (node: NodeFacts): boolean => node.row.id === "char.wrapper";
const isNote = (node: NodeFacts): boolean => node.row.id === "note";

/**
 * Where a node's marker starts. A block's range opens at the line break before
 * its marker (that break belongs to the block it introduces), so its backslash
 * is found, not assumed.
 */
const markerAt = (doc: string, node: NodeFacts): number => {
  const at = doc.indexOf("\\", node.from);
  return at >= 0 && at < Math.max(node.contentFrom, node.to) ? at : node.from;
};

const openerText = (doc: string, node: NodeFacts): string =>
  doc.slice(markerAt(doc, node), node.contentFrom);
/** `\bd ` → `\bd*`, `\+add ` → `\+add*`: a closer spelled as its opener was. */
const closerFor = (doc: string, node: NodeFacts): string => `${openerText(doc, node).trimEnd()}*`;

/** Where a node's own text stops: before its explicit closer, or at its end. */
const contentTo = (cst: CstScan, node: NodeFacts): number =>
  node.close === CloseReason.Explicit ? cst.startAt[node.lastToken] : node.to;

/** The end of a block's text, its trailing line break and spaces not counted. */
const blockTextEnd = (doc: string, node: NodeFacts): number => {
  let end = node.to;
  while (end > node.contentFrom && /\s/.test(doc[end - 1] ?? "")) end -= 1;
  return end;
};

/** Where a block's text starts: past its marker and the space or line break after it. */
const textFrom = (doc: string, node: NodeFacts): number => {
  let at = node.contentFrom;
  while (at < node.to && /\s/.test(doc[at] ?? "")) at += 1;
  return at;
};

/** A block's marker as a fragment leads with it: always followed by a space. */
const leadOf = (doc: string, node: NodeFacts): string => `${openerText(doc, node).trimEnd()} `;

interface Widened {
  readonly from: number;
  readonly to: number;
  /** The block marker the range lacks, and the character markers it starts inside, outermost first. */
  readonly lead: string;
  /** The closers of the character markers it ends inside, innermost first. */
  readonly tail: string;
}

/** The selection, widened to whole notes, its block's marker and its character formatting. */
function widen(doc: string, cst: CstScan, from: number, to: number): Widened {
  let start = from;
  let end = to;
  for (const node of cst.nodes) {
    if (!isNote(node) || node.from >= end || node.to <= start) continue;
    start = Math.min(start, node.from);
    end = Math.max(end, node.to);
  }

  // The innermost block the range starts inside, past its marker. Its marker comes when the
  // range takes the block's whole text, or runs out of the block into the next (Word's
  // paragraph mark); a range that stops at the block's last word does not take it.
  let block = "";
  for (const node of cst.nodes)
    if (opensBlock(node.row) && node.from < start && start < node.to)
      block =
        (start <= textFrom(doc, node) && end >= blockTextEnd(doc, node)) || end > node.to
          ? leadOf(doc, node)
          : "";

  // Parents come before children in `nodes`, so openers collect outermost first and closers,
  // unshifted, innermost first.
  const opened: string[] = [];
  const closed: string[] = [];
  for (const node of cst.nodes) {
    if (!isChar(node)) continue;
    const textTo = contentTo(cst, node);
    if (start >= node.contentFrom && start < textTo) opened.push(openerText(doc, node));
    if (node.close === CloseReason.Explicit && end > node.contentFrom && end <= textTo)
      closed.unshift(closerFor(doc, node));
  }
  return { from: start, to: end, lead: block + opened.join(""), tail: closed.join("") };
}

const escape = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** How a character marker reads in Word: only the ones with an obvious face. */
const CHAR_TAGS: Readonly<Record<string, readonly [string, string]>> = {
  bd: ["<b>", "</b>"],
  it: ["<i>", "</i>"],
  em: ["<i>", "</i>"],
  bdit: ["<b><i>", "</i></b>"],
  sc: ['<span style="font-variant:small-caps">', "</span>"],
  sup: ["<sup>", "</sup>"],
  no: ['<span style="font-style:normal;font-weight:normal">', "</span>"],
};

const nameOf = (node: NodeFacts): string =>
  (MARKERS[node.markerIdx]?.name ?? "").replace(/^\+/, "");

/** The element a block opens in HTML, from the editor's own class for it. */
const blockTag = (doc: string, node: NodeFacts): readonly [string, string] => {
  const cls = isMapped(node.row.verdict) ? node.row.verdict.class : null;
  if (cls === "block.heading") return ["<h3>", "</h3>"];
  if (node.row.poetry === true) {
    const level = Number(/\d+/.exec(openerText(doc, node))?.[0] ?? "1");
    return [`<p style="margin:0 0 0 ${level * 1.5}em">`, "</p>"];
  }
  return ["<p>", "</p>"];
};

/**
 * The words a reader sees in `[from, to)`, as plain text and as HTML, walked
 * token by token: text and verse numbers come, markers and notes do not; a
 * block starts a line (an element), a joined line break is a space.
 */
function render(
  doc: string,
  cst: CstScan,
  from: number,
  to: number,
): { text: string; html: string } {
  const noteSpans = cst.nodes.filter(isNote).map((node) => [node.from, node.to] as const);
  const inNote = (pos: number): boolean => noteSpans.some(([a, b]) => pos >= a && pos < b);
  const charByCloser = new Map<number, NodeFacts>();
  for (const node of cst.nodes)
    if (isChar(node) && node.close === CloseReason.Explicit) charByCloser.set(node.lastToken, node);

  type Tag = readonly [string, string];
  const containing = cst.nodes.findLast(
    (node) => opensBlock(node.row) && node.from <= from && node.to > from,
  );
  let openBlock: Tag | null = containing === undefined ? null : blockTag(doc, containing);
  let text = "";
  let html = openBlock?.[0] ?? "";
  const closeTags: string[] = [];
  const startBlock = (tag: Tag): void => {
    html += closeTags.splice(0).reverse().join("");
    if (openBlock !== null) {
      html += openBlock[1];
      text += "\n";
    }
    openBlock = tag;
    html += tag[0];
  };

  // The character runs the range starts inside: their tags open before its first word.
  for (const node of cst.nodes) {
    if (!isChar(node) || from < node.contentFrom || from >= contentTo(cst, node)) continue;
    const tag = CHAR_TAGS[nameOf(node)];
    if (tag === undefined) continue;
    html += tag[0];
    closeTags.push(tag[1]);
  }

  for (let i = 0; i < cst.count; i++) {
    const a = cst.startAt[i];
    const b = cst.endAt[i];
    if (b <= from) continue;
    if (a >= to) break;
    const node = cst.nodeOfOpener[i] >= 0 ? cst.nodes[cst.nodeOfOpener[i]] : undefined;
    if (node !== undefined && opensBlock(node.row) && a >= from) {
      startBlock(blockTag(doc, node));
      continue;
    }
    if (inNote(a)) continue;
    if (node !== undefined && isChar(node)) {
      const tag = CHAR_TAGS[nameOf(node)];
      if (tag !== undefined) {
        html += tag[0];
        closeTags.push(tag[1]);
      }
      continue;
    }
    const closes = charByCloser.get(i);
    if (closes !== undefined) {
      if (CHAR_TAGS[nameOf(closes)] !== undefined) html += closeTags.pop() ?? "";
      continue;
    }
    const verdict = cst.rowAt(i).verdict;
    const cls = isMapped(verdict) ? verdict.class : null;
    const slice = doc.slice(Math.max(a, from), Math.min(b, to));
    if (cls === "content" || cls === "pad") {
      text += slice;
      html += escape(slice);
    } else if (cls === "newline.inside") {
      text += " ";
      html += " ";
    } else if (cls === "slot.v") {
      text += `${slice.trim()} `;
      html += `<sup>${escape(slice.trim())}</sup> `;
    } else if (cls === "slot.c") {
      startBlock(["<h2>", "</h2>"]);
      text += slice;
      html += escape(slice);
    }
  }
  html += closeTags.reverse().join("");
  html += openBlock?.[1] ?? "";
  return {
    text: text
      .replace(/ {2,}/g, " ")
      .replace(/ *\n */g, "\n")
      .trim(),
    html: html.replace(/(<(?:p|h\d)[^>]*>) +/g, "$1").replace(/ +(<\/(?:p|h\d)>)/g, "$1"),
  };
}

/** What copying `[from, to)` of this state puts on the clipboard; `null` before the first parse. */
function copiedRange(state: EditorState, from: number, to: number): Copied | null {
  const analysis = structureAt(state).analysis;
  const doc = docText(state);
  if (analysis === null || analysis.text !== doc) return null;
  const cst = scanCst(doc, analysis);
  const widened = widen(doc, cst, from, to);
  const shown = render(doc, cst, widened.from, widened.to);
  return { ...shown, usfm: widened.lead + doc.slice(widened.from, widened.to) + widened.tail };
}

/** Every non-empty selection range, copied and joined as CodeMirror joins them. */
function copiedSelection(state: EditorState): Copied | null {
  const parts: Copied[] = [];
  for (const range of state.selection.ranges) {
    if (range.empty) continue;
    const one = copiedRange(state, range.from, range.to);
    if (one === null) return null;
    parts.push(one);
  }
  if (parts.length === 0) return null;
  return {
    text: parts.map((part) => part.text).join("\n"),
    html: parts.map((part) => part.html).join(""),
    usfm: parts.map((part) => part.usfm).join("\n"),
  };
}

/**
 * Copy and cut, writing the three flavours. An empty selection (CodeMirror's
 * whole-line copy) and a state not yet parsed fall through to CodeMirror. A
 * cut deletes what was SELECTED, not the widened range: the widening is for
 * what the copy carries.
 */
export const clipboardHandlers = EditorView.domEventHandlers({
  copy: (event, view) => write(event, view),
  cut: (event, view) => write(event, view),
  paste: (event, view) => paste(event, view),
});

function write(event: ClipboardEvent, view: EditorView): boolean {
  const data = event.clipboardData;
  // USFM mode shows the text as it is: copy is CodeMirror's own, the raw selection.
  if (data === null || !isVisual(view.state)) return false;
  const copied = copiedSelection(view.state);
  if (copied === null) return false;
  event.preventDefault();
  data.clearData();
  data.setData("text/plain", copied.text);
  data.setData("text/html", copied.html);
  const payload: CopiedUsfm = { usfm: copied.usfm, origin: view.state.facet(clipboardOrigin) };
  data.setData(USFM_FLAVOUR, JSON.stringify(payload));
  if (event.type === "cut" && !view.state.readOnly)
    view.dispatch({
      changes: view.state.selection.ranges.filter((range) => !range.empty),
      scrollIntoView: true,
      userEvent: "delete.cut",
    });
  return true;
}

/** The payload of Sefer's own flavour, or `null` when the clipboard has none (or a malformed one). */
function readUsfm(data: DataTransfer): CopiedUsfm | null {
  const raw = data.getData(USFM_FLAVOUR);
  if (raw === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("usfm" in parsed)) return null;
    if (typeof parsed.usfm !== "string") return null;
    const origin = "origin" in parsed && typeof parsed.origin === "string" ? parsed.origin : null;
    return { usfm: parsed.usfm, origin };
  } catch {
    return null;
  }
}

/** `\q2` → the `q` row: a numbered marker's catalogue row. */
const rowNamed = (spelled: string) => {
  const name = spelled.replace(/^\+/, "");
  return (
    MARKERS.find((row) => row.name === name) ??
    MARKERS.find((row) => row.name === name.replace(/\d+$/, ""))
  );
};

/** The block marker a fragment opens with, as written (`\s1 `), or `null` when it opens with words. */
function leadingBlock(usfm: string): string | null {
  const match = /^\\(\+?[A-Za-z]+\d*)(?:[ \t]+|\n|$)/.exec(usfm);
  if (match === null) return null;
  return rowNamed(match[1] ?? "")?.kind === MarkerKind.Paragraph ? match[0] : null;
}

/** Verse and chapter markers out: text brought in from elsewhere takes this text's numbers. */
const withoutNumbers = (usfm: string): string =>
  usfm.replace(/\\[vc][ \t]+[^\s\\]+[ \t]?/g, "").replace(/\n{2,}/g, "\n");

/**
 * A fragment with no block in it, pasted into a line: its trailing line break
 * goes unless it lands at a line's start, and a marker it opens with is kept
 * off the word before it.
 */
const inline = (doc: string, from: number, to: number, usfm: string): string => {
  const lineStart = from === 0 || doc[from - 1] === "\n";
  const atLineEnd = to >= doc.length || doc[to] === "\n";
  let insert = lineStart && !atLineEnd ? usfm : usfm.replace(/\n$/, "");
  if (!lineStart && insert.startsWith("\\") && !/\s/.test(doc[from - 1] ?? ""))
    insert = ` ${insert}`;
  return insert;
};

/** The change a USFM fragment makes, pasted over `[from, to)`, by the paste rules. */
function pasteChange(
  state: EditorState,
  from: number,
  to: number,
  copied: CopiedUsfm,
): { from: number; to: number; insert: string } {
  const own = copied.origin !== null && copied.origin === state.facet(clipboardOrigin);
  let usfm = own ? copied.usfm : withoutNumbers(copied.usfm);
  const doc = docText(state);
  const structure = structureAt(state);

  // Never into a number: a caret on `\v 6` pastes at the verse's text.
  for (const verse of structure.verses)
    if (from === to && from >= verse.markerFrom && from < verse.contentFrom) {
      from = to = verse.contentFrom;
      break;
    }

  // After a chapter's number is the next line's start: a chapter line takes no text.
  const lineFrom = doc.lastIndexOf("\n", from - 1) + 1;
  if (from === to && doc[from] === "\n" && /^\\c[ \t]/.test(doc.slice(lineFrom, from)))
    from = to = from + 1;

  const lead = leadingBlock(usfm);
  const hasBlock = lead !== null || /\n\\/.test(usfm);
  if (!hasBlock || structure.analysis === null) {
    // At a line a block marker opens, words and verses go into the block, after its marker.
    const opening = /^\\(\+?[A-Za-z]+\d*)[ \t]*\n?/.exec(doc.slice(from, from + 24));
    const lineStart = from === 0 || doc[from - 1] === "\n";
    if (from === to && lineStart && opening !== null)
      if (rowNamed(opening[1] ?? "")?.kind === MarkerKind.Paragraph)
        from = to = from + opening[0].length;
    return { from, to, insert: inline(doc, from, to, usfm) };
  }

  // A heading pasted at a verse's first word goes before the verse's number, not between.
  let at = from;
  if (lead !== null && from === to)
    for (const verse of structure.verses)
      if (from === verse.contentFrom) {
        at = verse.markerFrom;
        break;
      }

  const cst = scanCst(doc, structure.analysis);
  const target = cst.nodes.findLast(
    (node) => opensBlock(node.row) && markerAt(doc, node) <= at && at <= node.to,
  );
  if (target === undefined) return { from, to, insert: usfm };
  const textEnd = blockTextEnd(doc, target);
  const trimmed = usfm.replace(/\s+$/, "");

  // A block-led fragment into an empty block takes the block's place. A block's marker is
  // deleted with the line break before it (`deleteMarkersWholeOrNotAtAll`), so the break is
  // replaced too, and written back.
  if (lead !== null && textFrom(doc, target) >= textEnd) {
    const marker = markerAt(doc, target);
    const broken = marker > 0 && doc[marker - 1] === "\n";
    return {
      from: broken ? marker - 1 : marker,
      to: Math.max(textEnd, to),
      insert: broken ? `\n${trimmed}` : trimmed,
    };
  }
  // At the start of a block's words, it goes above the block, whole.
  if (lead !== null && from === to && at <= textFrom(doc, target)) {
    const above = markerAt(doc, target);
    return { from: above, to: above, insert: `${trimmed}\n` };
  }
  // Mid-line, it starts its own line.
  const lineStart = at === 0 || doc[at - 1] === "\n";
  if (lead !== null && !lineStart) usfm = `\n${usfm}`;
  // Words after it stay in a block of their own kind, as Word splits a paragraph. Markers
  // alone (a passthrough `\s5`) are not words.
  const end = from === to ? at : to;
  const words = doc.slice(end, textEnd).replace(/\\\S+/g, "").trim();
  if (end < textEnd && words !== "") {
    const block = leadOf(doc, target);
    usfm = `${usfm.replace(/\s+$/, "")}\n${lineStart ? `${block.trimEnd()}\n` : block}`;
  }
  return { from: at, to: end, insert: usfm };
}

/**
 * The verse words of a fragment, for line by line, where a paste is words in one verse:
 * no heading lines, no notes, no numbers, no markers.
 */
const wordsOf = (usfm: string): string =>
  usfm
    .split("\n")
    .filter((line) => {
      const led = /^\\(\+?[A-Za-z]+\d*)/.exec(line);
      return led === null || rowNamed(led[1] ?? "")?.category !== Category.ParaTitlesSections;
    })
    .join(" ")
    .replace(/\\(f|fe|ef|x|ex)\s[\s\S]*?\\\1\*/g, "")
    .replace(/\\[vc][ \t]+[^\s\\]+/g, "")
    .replace(/\\\+?[A-Za-z]+\d*\*?/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Words pasted against a word are kept apart from it by a space. */
const spaced = (state: EditorState, at: number, words: string): string =>
  at > 0 && !/\s/.test(state.doc.sliceString(at - 1, at)) && words !== "" ? ` ${words}` : words;

/**
 * Paste prefers Sefer's own flavour. In Reading it goes through the paste
 * rules (`pasteChange`); line by line takes its verse words only (`wordsOf`);
 * USFM mode is CodeMirror's own paste of the text. Anything else falls through
 * to CodeMirror, and every paste is still one `input.paste` transaction for
 * the phases to judge.
 */
function paste(event: ClipboardEvent, view: EditorView): boolean {
  const data = event.clipboardData;
  // USFM mode pastes the text as it is: CodeMirror's own paste of `text/plain`.
  if (data === null || view.state.readOnly || !isVisual(view.state)) return false;
  const copied = readUsfm(data);
  if (copied === null) return false;
  event.preventDefault();
  const range = view.state.selection.main;
  const change = assignmentAt(view.state).verseLines
    ? {
        from: range.from,
        to: range.to,
        insert: spaced(view.state, range.from, wordsOf(copied.usfm)),
      }
    : pasteChange(view.state, range.from, range.to, copied);
  view.dispatch({
    changes: change,
    selection: { anchor: change.from + change.insert.length },
    scrollIntoView: true,
    userEvent: "input.paste",
  });
  return true;
}
