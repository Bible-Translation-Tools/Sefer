/**
 * The token and node planes: `scanCst` turns one `Analysis` into flat typed
 * arrays the rest of the editor indexes into.
 *
 * Why planes and not objects: the reader hands out cursors over wasm memory, and
 * a keystroke asks thousands of small questions (what kind is the token at this
 * offset, where does it end, what shape is its node). One pass into
 * `Int32Array`s answers all of them in constant time and allocates nothing per
 * question.
 *
 * These planes are a CACHE over the Galley reader, not a second reader. Every
 * value is read through `TokenRow`/`NodeRow`/`Tree`/`Toc`; nothing here knows a
 * byte offset or a stride, so a wire change lands in scripture-kitchen's
 * generated reader and reaches this file as a type error, not a misread. What
 * the planes add is Sefer's own: line openings, note/origin/wrapper scope,
 * block extents, designator roles and the `mapping.ts` rows.
 *
 * TODO: pin with a test once editor behaviour is locked. The planes must agree
 * with the reader they cache (spans, kinds, owners) on a real fixture.
 */

import {
  type Analysis,
  type NodeView,
  type NotePart,
  type Tree,
  CloseReason,
  MARKERS,
  NODE_ID_BIT,
  NONE,
  NOTE_PART,
  TOKEN,
  TOKEN_BLANK,
  TOKEN_DELIMITER_FOLDED,
  TOKEN_SPELLING_BIT,
  TokenKind,
  TokenView,
  isMarkerKind,
} from "#core/galley";

import {
  type NodeShape,
  type Row,
  type TokenShape,
  isOriginReference,
  kindsReaching,
  notePartOf,
  opensBlock,
  rowForNode,
  rowForToken,
  trimsRecoveryNewline,
} from "./mapping";

const SPANNING = kindsReaching(["optbreak", "milestone.token"]);

const IN_NOTE = 1;
const IN_ORIGIN = 2;
const IN_WRAPPER = 4;

const ROLE_VERSE = 1;
const ROLE_CHAPTER = 2;

const roleName = (r: number): "verse" | "chapter" | null =>
  r === ROLE_VERSE ? "verse" : r === ROLE_CHAPTER ? "chapter" : null;

export interface NodeFacts {
  id: number;
  row: Row<NodeShape>;
  markerIdx: number;
  close: number;
  from: number;
  to: number;
  contentFrom: number;
  opener: number;
  lastToken: number;
}

export interface CstScan {
  count: number;
  startAt: Uint32Array;
  endAt: Uint32Array;
  kindAt: Uint8Array;
  markerAt: Uint8Array;
  flagsAt: Uint8Array;
  lineCount: number;
  lineFrom: Uint32Array;
  lineTo: Uint32Array;
  nodes: NodeFacts[];
  nodeOfOpener: Int32Array;
  designatorOf: Int32Array;
  spanning: number[];
  tree: Tree;
  firstTokenFrom: (pos: number) => number;
  payloadEnd: (i: number) => number;
  isHorizontalSpace: (i: number) => boolean;
  isLineOpening: (i: number) => boolean;
  shapeAt: (i: number) => TokenShape;
  rowAt: (i: number) => Row<TokenShape>;
}

export function scanCst(doc: string, analysis: Analysis): CstScan {
  const dish = analysis.dish;
  const tree: Tree = dish.tree;
  const count = dish.tokens.length;

  const startAt = new Uint32Array(count + 1);
  const endAt = new Uint32Array(count + 1);
  const kindAt = new Uint8Array(count + 4).fill(0xff);
  const markerAt = new Uint8Array(count);
  const flagsAt = new Uint8Array(count);
  const closesAt = new Uint8Array(count);
  const openingAt = new Uint8Array(count);
  const designatorRole = new Uint8Array(count);
  const markerRole = new Uint8Array(count);

  const spanning: number[] = [];
  const breaks: number[] = [];
  {
    const rows = tree.tokens;
    let looking = true;
    for (let i = 0; i < count; i++) {
      const r = rows.seek(i);
      const kind = r.kind & ~TOKEN_SPELLING_BIT;
      const from = r.start;
      const to = r.end;
      const flags = r.flags;
      markerAt[i] = r.marker;
      kindAt[i] = kind;
      startAt[i] = from;
      endAt[i] = to;
      flagsAt[i] = flags;
      if (SPANNING[kind] && to > from) spanning.push(i);
      if (kind === TOKEN.NEWLINE) {
        breaks.push(to);
        looking = true;
        continue;
      }
      if (!looking || to <= from) continue;
      if (kind === TOKEN.PAD || (flags & TOKEN_BLANK) !== 0) continue;
      looking = false;
      openingAt[i] = 1;
    }
  }
  startAt[count] = doc.length + 1;

  const payloadEnd = (i: number): number =>
    (flagsAt[i] & TOKEN_DELIMITER_FOLDED) !== 0 ? endAt[i] - 1 : endAt[i];

  /**
   * Horizontal whitespace of either shape the engine names: a `Pad` token, or
   * a `Text` token carrying `TOKEN_BLANK`. Wider than `TokenView.isBlank()`,
   * which is the flag alone; Sefer's line walks treat both as nothing to open.
   */
  const isHorizontalSpace = (i: number): boolean =>
    kindAt[i] === TOKEN.PAD || (flagsAt[i] & TOKEN_BLANK) !== 0;

  const lineCount = breaks.length + 1;
  const lineFrom = new Uint32Array(lineCount);
  const lineTo = new Uint32Array(lineCount);
  for (let k = 0; k < breaks.length; k++) {
    lineTo[k] = breaks[k] - 1;
    lineFrom[k + 1] = breaks[k];
  }
  lineTo[lineCount - 1] = doc.length;

  /**
   * The first token that starts at or after `pos` (`count` when none does).
   * Not `Tree.tokenAt`, which answers the token CONTAINING an offset and
   * throws outside the document.
   */
  const firstTokenFrom = (pos: number): number => {
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (startAt[mid] < pos) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const nodes: NodeFacts[] = [];
  const nodeOfOpener = new Int32Array(count).fill(-1);
  const shape: NodeShape = {
    markerKind: 0,
    category: 0,
    ctx: 0,
    close: 0,
    ws: 0,
    unknown: false,
    name: null,
    crossesLine: false,
  };

  const nodeCount = tree.nodeCount();
  const owners = tree.owners();
  const nodeCtx = new Int32Array(nodeCount);
  const nodeMarkerKind = new Int32Array(nodeCount).fill(-1);
  const nodeFlags = new Uint8Array(nodeCount);
  const nodeBlockEnd = new Uint32Array(nodeCount);

  const lineIndexAt = (pos: number): number => {
    let lo = 0;
    let hi = lineCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lineTo[mid] < pos) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  let lineCursor = 0;
  let walked = 0;
  const rows = tree.nodes;
  for (let id = 0; id < nodeCount; id++) {
    const r = rows.seek(id);
    const token = r.token;
    const ctx = r.ctx;
    const close = r.reason;
    const childFrom = r.childFrom;
    const childTo = r.childTo;
    const parent = id === 0 ? NONE : tree.parent(id);
    const inherited = parent === NONE ? 0 : nodeFlags[parent];
    nodeCtx[id] = ctx;
    nodeFlags[id] = inherited & ~IN_WRAPPER;
    nodeBlockEnd[id] = parent === NONE ? 0 : nodeBlockEnd[parent];

    const markerIdx = token === NONE || !isMarkerKind(kindAt[token]) ? -1 : markerAt[token];
    if (markerIdx < 0) continue;
    const marker = MARKERS[markerIdx];
    const first = tree.firstToken(id);
    const last = tree.lastToken(id);
    const from = startAt[first];
    const to = childFrom === childTo ? from : endAt[last];
    const lastPos = Math.min(Math.max(from, to - 1), doc.length);
    if (from < walked) lineCursor = lineIndexAt(from);
    walked = from;
    while (lineCursor + 1 < lineCount && lineTo[lineCursor] < from) lineCursor++;
    const after = lineCursor + 1 < lineCount ? lineFrom[lineCursor + 1] : doc.length + 1;

    shape.markerKind = marker?.kind ?? 0;
    shape.category = marker?.category ?? 0;
    shape.ctx = ctx;
    shape.close = close;
    shape.ws = marker?.ws ?? 0;
    shape.unknown = markerIdx === 0;
    shape.name = markerIdx === 0 ? null : (marker?.name ?? null);
    shape.crossesLine = after <= lastPos;
    const row = rowForNode(shape);

    let flags = nodeFlags[id];
    if (row.id === "note") flags |= IN_NOTE;
    if (isOriginReference(shape.name)) flags |= IN_ORIGIN;
    if (row.id === "char.wrapper") flags |= IN_WRAPPER;
    nodeFlags[id] = flags;
    nodeMarkerKind[id] = shape.markerKind;
    if (opensBlock(row) && to > nodeBlockEnd[id]) nodeBlockEnd[id] = to;
    if (close === CloseReason.Explicit && kindAt[last] === TokenKind.ClosingMarker)
      closesAt[last] = 1;

    const opener =
      childFrom !== childTo && (tree.childIds[childFrom] & NODE_ID_BIT) === 0
        ? tree.childIds[childFrom]
        : -1;
    if (opener >= 0) nodeOfOpener[opener] = nodes.length;
    nodes.push({
      id,
      row,
      markerIdx,
      close,
      from,
      to,
      contentFrom: opener >= 0 ? endAt[opener] : from,
      opener,
      lastToken: last,
    });
  }

  const designatorOf = new Int32Array(count).fill(-1);
  if (dish.toc.chapterRows.length || dish.toc.verseRows.length) {
    dish.toc.forEachChapter((_n, _f, _t, token, designator) => {
      if (token !== NONE) markerRole[token] = ROLE_CHAPTER;
      if (token !== NONE && designator !== NONE) {
        designatorRole[designator] = ROLE_CHAPTER;
        designatorOf[token] = designator;
      }
    });
    dish.toc.forEachVerse((_c, _f, _l, _at, token, designator) => {
      if (token !== NONE) markerRole[token] = ROLE_VERSE;
      if (designator !== NONE) {
        designatorRole[designator] = ROLE_VERSE;
        designatorOf[token] = designator;
      }
    });
  }

  const SHAPE: TokenShape = {
    kind: 0,
    markerKind: null,
    category: null,
    unknown: false,
    lineOpening: false,
    inNoteExtent: false,
    originScope: false,
    ctx: 0,
    parentMarkerKind: null,
    designatorOf: null,
    markerOf: null,
    insideBlockExtent: false,
    closesNode: false,
    inWrapper: false,
  };

  const shapeAt = (i: number): TokenShape => {
    const kind = kindAt[i];
    const marker = isMarkerKind(kind) ? MARKERS[markerAt[i]] : undefined;
    const owner = owners[i];
    const flags = owner === NONE ? 0 : nodeFlags[owner];
    const parent = owner === NONE ? -1 : nodeMarkerKind[owner];
    SHAPE.kind = kind;
    SHAPE.markerKind = isMarkerKind(kind) ? (marker?.kind ?? 0) : null;
    SHAPE.category = isMarkerKind(kind) ? (marker?.category ?? 0) : null;
    SHAPE.unknown = isMarkerKind(kind) ? markerAt[i] === 0 : false;
    SHAPE.lineOpening = openingAt[i] === 1;
    SHAPE.inNoteExtent = (flags & IN_NOTE) !== 0;
    SHAPE.originScope = (flags & IN_ORIGIN) !== 0;
    SHAPE.inWrapper = (flags & IN_WRAPPER) !== 0;
    SHAPE.closesNode = closesAt[i] === 1;
    SHAPE.ctx = nodeCtx[owner === NONE ? 0 : owner];
    SHAPE.parentMarkerKind = parent < 0 ? null : parent;
    SHAPE.designatorOf = roleName(designatorRole[i]);
    SHAPE.markerOf = roleName(markerRole[i]);
    SHAPE.insideBlockExtent = owner !== NONE && endAt[i] < nodeBlockEnd[owner];
    return SHAPE;
  };

  return {
    count,
    startAt,
    endAt,
    kindAt,
    markerAt,
    flagsAt,
    lineCount,
    lineFrom,
    lineTo,
    nodes,
    nodeOfOpener,
    designatorOf,
    spanning,
    tree,
    firstTokenFrom,
    payloadEnd,
    isHorizontalSpace,
    isLineOpening: (i: number) => openingAt[i] === 1,
    shapeAt,
    rowAt: (i: number) => rowForToken(shapeAt(i)),
  };
}

export const spellingAt = (cst: CstScan, i: number, doc: string): string =>
  new TokenView(cst.tree.tokens, i).spelling(doc);

export function noteExtentEnd(cst: CstScan, facts: NodeFacts): number {
  if (!trimsRecoveryNewline(facts.close)) return facts.to;
  const last = facts.lastToken;
  if (cst.kindAt[last] === TOKEN.NEWLINE && cst.endAt[last] === facts.to) return cst.startAt[last];
  return facts.to;
}

export function notePartsOf(
  note: NodeView,
  extentEnd: number,
  shapeAt: (i: number) => TokenShape,
): NotePart[] {
  // A run is grown in place as adjacent spans of the same part are met, so
  // the accumulator is mutable where the published `NotePart` is not.
  const out: NotePart[] = [];
  let run: { kind: number; from: number; to: number } | null = null;
  const flush = () => {
    if (run) out.push(run);
    run = null;
  };
  const walk = (node: NodeView, isNote: boolean) => {
    for (let i = 0, n = node.childCount(); i < n; i++) {
      const child = node.child(i);
      if (child.isNode) {
        // SAFETY: `isNode` is the reader's discriminator; true means NodeView.
        walk(child as NodeView, false);
        continue;
      }
      // SAFETY: the `isNode` branch above returned, so this child is a token.
      const t = child as TokenView;
      const s = t.span();
      if (isNote && i === 0) continue;
      if (s.from >= extentEnd) continue;
      const part = notePartOf(shapeAt(t.id));
      if (part === NOTE_PART.ORIGIN || part === NOTE_PART.BODY) {
        if (run && run.kind === part && run.to === s.from) run.to = s.to;
        else {
          flush();
          run = { kind: part, from: s.from, to: s.to };
        }
        continue;
      }
      flush();
      if (s.to > s.from) out.push({ kind: part, from: s.from, to: s.to });
    }
  };
  walk(note, true);
  flush();
  return out;
}
