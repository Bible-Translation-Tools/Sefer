/**
 * The fold: one `Analysis` and its text become typed-array tables plus lazy
 * rows.
 *
 * `buildStructure` is the only builder, and it REFUSES a parse that does not
 * describe exactly this text — `describesExactly`, not a length — because every
 * offset below indexes into the string it was told about.
 *
 * `structureField` is the state's memo: by `Text` instance first (CodeMirror
 * shares the instance across non-doc transactions), then the `borrowedStructure`
 * facet (a window takes the canonical parse when its text matches), then the
 * last structure built, and only then the engine. That chain is why ten open
 * result cards over one book cost zero extra parses.
 */

import { EditorState, Facet, StateField, type Text } from "@codemirror/state";

import {
  type Analysis,
  type TokenView,
  MARKERS,
  NONE,
  NodeView,
  TOKEN,
  describesExactly,
} from "#core/galley";

import { analyzed, analyzer } from "./analyzer";
import { type BlockColumns, Blocks, NO_BLOCKS } from "./blockTable";
import { type NodeFacts, noteExtentEnd, scanCst } from "./cst";
import { Verse } from "./designators";
import type {
  BlockTable,
  ChapterRow,
  Fold,
  LineTable,
  NoteRange,
  VerseRow,
  WordRange,
} from "./fold";
import { Lines, NO_LINES } from "./lineTable";
import {
  type Mapping,
  containsBlocks,
  isMapped,
  isPoetryBlock,
  opensBlock,
  paintedClassOf,
} from "./mapping";
import { Note } from "./notes";
import type { ClassKey } from "./registry";
import { span } from "./timing";
import { stateFailed } from "./trace";

export type {
  Block,
  BlockTable,
  ChapterRow,
  DocLine,
  LineTable,
  NoteRange,
  VerseRow,
  WordRange,
} from "./fold";
export { isBlankLine, isDesignatorLine, opensAParagraph, paintsItsOwnLine } from "./lineTable";

export interface DocStructure {
  revision: number;
  lines: LineTable;
  blocks: BlockTable;
  chapters: ChapterRow[];
  verses: VerseRow[];
  notes: NoteRange[];
  words: WordRange[];
  analysis: Analysis | null;
}

const EMPTY_STRUCTURE: DocStructure = {
  revision: 0,
  lines: NO_LINES,
  blocks: NO_BLOCKS,
  chapters: [],
  verses: [],
  notes: [],
  words: [],
  analysis: null,
};

export function buildStructure(
  doc: string,
  analysis: Analysis,
  clip?: { from: number; to: number } | null,
): DocStructure {
  const done = span("scan", `${(doc.length / 1024) | 0}KB`);
  if (!describesExactly(analysis, doc)) {
    done();
    throw new Error(
      `stale parse: revision ${analysis.revision} describes ${analysis.docLen} chars, not this ${doc.length}`,
    );
  }
  if (!analysis.dish.utf16) {
    done();
    throw new Error("the dish is in UTF-8 offsets; buildStructure addresses UTF-16");
  }
  const dish = analysis.dish;

  const cst = scanCst(doc, analysis);
  const { startAt, endAt, nodes, designatorOf, shapeAt, lineFrom, lineTo, lineCount } = cst;

  // SAFETY: `Fold` is the mutable scratch record the builders below fill in;
  // the fields are assigned in this literal and by the two table constructors
  // that follow (`lines`, `blocks`), which is exactly what `Fold` declares.
  const f = {
    doc,
    cst,
    clip: clip ?? null,
    chapterOfToken: new Int32Array(cst.count).fill(-1),
    verseOfToken: new Int32Array(cst.count).fill(-1),
    // SAFETY: empty literals, annotated so the pushes below stay typed; an
    // empty array cannot be the wrong element type yet.
    chapters: [] as ChapterRow[],
    // SAFETY: as above.
    verses: [] as VerseRow[],
    notesByLine: new Map<number, NoteRange[]>(),
    wordsByLine: new Map<number, WordRange[]>(),
  } as Fold;

  const lines = new Lines(f, lineFrom, lineTo, lineCount);
  f.lines = lines;

  const lineIdxFrom = (lo0: number, pos: number): number => {
    if (pos < 0 || pos > lineTo[lineCount - 1]) return -1;
    let lo = lo0 < 0 ? 0 : lo0;
    let hi = lineCount - 1;
    let step = 1;
    while (lo + step <= hi && lineTo[lo + step] < pos) {
      lo += step;
      step <<= 1;
    }
    let top = lo + step < hi ? lo + step : hi;
    while (lo < top) {
      const mid = (lo + top) >> 1;
      if (lineTo[mid] < pos) lo = mid + 1;
      else top = mid;
    }
    return lo;
  };
  const lineIdxAt = (pos: number): number => lineIdxFrom(0, pos);

  const wanted = (from: number, to: number) => !clip || (to >= clip.from && from <= clip.to);

  f.contentAfter = (markerRow: number): number => {
    const d = designatorOf[markerRow];
    return endAt[d < 0 ? markerRow : d];
  };

  const noteRows: { line: number; note: NoteRange }[] = [];
  const wordRows: { line: number; word: WordRange }[] = [];
  const blockFacts: NodeFacts[] = [];
  const blockHead: number[] = [];
  const blockLast: number[] = [];

  let walked = 0;
  let cursor = 0;
  const lineOfOrdered = (pos: number): number => {
    if (pos < walked) return lineIdxAt(pos);
    walked = pos;
    while (cursor + 1 < lineCount && lineTo[cursor] < pos) cursor++;
    return lineTo[cursor] < pos ? -1 : cursor;
  };

  for (const facts of nodes) {
    const at = lineOfOrdered(facts.from);
    if (facts.row.id === "note") {
      if (at < 0) continue;
      const end = noteExtentEnd(cst, facts);
      noteRows.push({
        line: at + 1,
        note: new Note(
          new NodeView(cst.tree, facts.id),
          facts.from,
          end,
          MARKERS[facts.markerIdx]?.name ?? "",
          shapeAt,
        ),
      });
      continue;
    }
    if (opensBlock(facts.row)) {
      if (at < 0) continue;
      const lastAt = lineIdxFrom(at, Math.max(facts.from, Math.min(facts.to, doc.length) - 1));
      let lastLine = (lastAt < 0 ? at : lastAt) + 1;
      while (lastLine > at + 1 && lineTo[lastLine - 1] === lineFrom[lastLine - 1]) lastLine--;
      blockFacts.push(facts);
      blockHead.push(at + 1);
      blockLast.push(lastLine);
      continue;
    }
    const verdict: Mapping = facts.row.verdict;
    if (!isMapped(verdict) || verdict.class !== "char") continue;
    if (!wanted(facts.from, facts.to) || at < 0) continue;
    const node = new NodeView(cst.tree, facts.id);
    let surfaceFrom = facts.from;
    let attrFrom = -1;
    let attrTo = -1;
    let closerFrom = facts.to;
    for (let i = 0, n = node.childCount(); i < n; i++) {
      const child = node.child(i);
      if (child.isNode) continue;
      // SAFETY: `isNode` is the reader's own discriminator — false means this
      // child is a token, checked one line above.
      const t = child as TokenView;
      const id = t.id;
      if (i === 0) surfaceFrom = endAt[id];
      const kind = cst.kindAt[id];
      if (kind === TOKEN.ATTR_LIST) {
        attrFrom = startAt[id];
        attrTo = endAt[id];
      } else if (kind === TOKEN.CLOSING_MARKER) closerFrom = startAt[id];
    }
    if (attrFrom < 0) {
      attrFrom = closerFrom;
      attrTo = closerFrom;
    }
    wordRows.push({
      line: at + 1,
      word: {
        from: facts.from,
        to: facts.to,
        marker: facts.markerIdx,
        surfaceFrom,
        surfaceTo: attrFrom,
        attrFrom,
        attrTo,
      },
    });
  }

  noteRows.sort((a, b) => a.line - b.line || a.note.from - b.note.from);
  const notes: NoteRange[] = [];
  for (const row of noteRows) {
    notes.push(row.note);
    const bucket = f.notesByLine.get(row.line);
    if (bucket) bucket.push(row.note);
    else f.notesByLine.set(row.line, [row.note]);
  }

  wordRows.sort((a, b) => a.line - b.line);
  const words: WordRange[] = [];
  for (const row of wordRows) {
    words.push(row.word);
    const bucket = f.wordsByLine.get(row.line);
    if (bucket) bucket.push(row.word);
    else f.wordsByLine.set(row.line, [row.word]);
  }

  const chapters = f.chapters;
  dish.toc.forEachChapter((_number, from, to, token) => {
    const head = lineIdxAt(from);
    const has = token !== NONE;
    const d = has ? (designatorOf[token] ?? -1) : -1;
    const labelFrom = !has ? from : d < 0 ? endAt[token] : startAt[d];
    const labelTo = !has ? from : d < 0 ? endAt[token] : cst.payloadEnd(d);
    const lastAt = lineIdxFrom(head, Math.max(from, to - 1));
    const row: ChapterRow = {
      ordinal: chapters.length,
      label: has ? doc.slice(labelFrom, labelTo) : "",
      labelFrom,
      labelTo,
      from,
      to,
      line: head < 0 ? 1 : head + 1,
      lastLine: lastAt < 0 ? lineCount : lastAt + 1,
    };
    if (token !== NONE) f.chapterOfToken[token] = chapters.length;
    chapters.push(row);
  });

  const verses = f.verses;
  dish.toc.forEachVerse((_chapter, _first, _last, _at, token) => {
    const d = designatorOf[token] ?? -1;
    const markerEnd = endAt[token];
    const numFrom = d < 0 ? markerEnd : startAt[d];
    const numTo = d < 0 ? markerEnd : cst.payloadEnd(d);
    f.verseOfToken[token] = verses.length;
    verses.push(
      new Verse(doc, startAt[token], markerEnd, numFrom, numTo, d < 0 ? markerEnd : endAt[d]),
    );
  });

  const blockCount = blockFacts.length;
  let ordered = true;
  for (let k = 1; k < blockCount; k++) {
    const before = blockFacts[k - 1];
    const here = blockFacts[k];
    if (here.from < before.from || (here.from === before.from && here.to > before.to))
      ordered = false;
  }
  const order = ordered
    ? null
    : Array.from({ length: blockCount }, (_, i) => i).sort(
        (x, y) => blockFacts[x].from - blockFacts[y].from || blockFacts[y].to - blockFacts[x].to,
      );

  const cols: BlockColumns = {
    from: new Int32Array(blockCount),
    contentFrom: new Int32Array(blockCount),
    to: new Int32Array(blockCount),
    head: new Int32Array(blockCount),
    last: new Int32Array(blockCount),
    markerIdx: new Int32Array(blockCount),
    opener: new Int32Array(blockCount),
    poetry: new Uint8Array(blockCount),
    cls: Array.from<ClassKey>({ length: blockCount }),
  };
  const extentTo = new Int32Array(blockCount);
  const container = new Uint8Array(blockCount);
  for (let k = 0; k < blockCount; k++) {
    const row = order ? order[k] : k;
    const facts = blockFacts[row];
    const last = blockLast[row];
    extentTo[k] = facts.to;
    container[k] = containsBlocks(facts.row) ? 1 : 0;
    cols.from[k] = facts.from;
    cols.contentFrom[k] = facts.contentFrom;
    cols.to[k] = lineTo[last - 1];
    cols.head[k] = blockHead[row];
    cols.last[k] = last;
    cols.markerIdx[k] = facts.markerIdx;
    cols.opener[k] = facts.opener;
    cols.poetry[k] = isPoetryBlock(facts.row) ? 1 : 0;
    cols.cls[k] = paintedClassOf(facts.row);
  }

  for (let k = 0; k < blockCount - 1; k++) {
    if (container[k] === 1 && extentTo[k + 1] <= extentTo[k]) continue;
    if (cols.from[k + 1] > cols.from[k] && cols.from[k + 1] < cols.to[k])
      cols.to[k] = cols.from[k + 1];
  }
  const blocks = new Blocks(f, cols, blockCount);

  done();
  return {
    revision: analysis.revision,
    lines,
    blocks,
    chapters,
    verses,
    notes,
    words,
    analysis,
  };
}

export function lineIndexAt(s: DocStructure, pos: number): number {
  const lines = s.lines;
  if (!lines.length) return -1;
  const end = lines.toAt(lines.length - 1);
  return lines.indexAt(pos < 0 ? 0 : pos > end ? end : pos);
}

const docCache = new WeakMap<EditorState, string>();

export function docText(state: EditorState): string {
  let d = docCache.get(state);
  if (d === undefined) {
    d = state.doc.toString();
    docCache.set(state, d);
  }
  return d;
}

export const borrowedStructure = Facet.define<(state: EditorState) => DocStructure | null>();

function fits(s: DocStructure, doc: string): boolean {
  return !!s.analysis && describesExactly(s.analysis, doc);
}

function borrowFor(state: EditorState, doc: string): DocStructure | null {
  for (const lend of state.facet(borrowedStructure)) {
    const lent = lend(state);
    if (lent && fits(lent, doc)) return lent;
  }
  return null;
}

const structureByText = new WeakMap<Text, DocStructure>();
let recent: DocStructure | null = null;

function remember(text: Text, s: DocStructure): DocStructure {
  structureByText.set(text, s);
  return s;
}

function analyzeState(state: EditorState): DocStructure {
  const text = state.doc;
  const memo = structureByText.get(text);
  if (memo && memo.analysis) return memo;
  const doc = docText(state);
  const lent = borrowFor(state, doc);
  if (lent) return remember(text, lent);
  if (recent && fits(recent, doc)) return remember(text, recent);
  try {
    const analysis = analyzed(state.facet(analyzer), doc);
    const s = buildStructure(doc, analysis, null);
    recent = s;
    return remember(text, s);
  } catch (err) {
    stateFailed("engine analyze", err);
    return EMPTY_STRUCTURE;
  }
}

export const structureField = StateField.define<DocStructure>({
  create: (s) => analyzeState(s),
  update: (v, tr) => (tr.docChanged ? analyzeState(tr.state) : v),
});

export const structureAt = (s: EditorState) => s.field(structureField);
