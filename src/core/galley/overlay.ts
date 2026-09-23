// overlay.ts
//
// THE OVERLAY DOORS: match formatting, as the engine sees it.
//
// The ask (engine-asks item 3): show the source text and highlight the
// equivalent block in the target, so a translator can carry paragraphing and
// poetry across without retyping the words. The old app did it in TypeScript by
// verse anchors; Will's answer was that it belongs in the engine, and
// scripture-kitchen v0.1.0 is where it landed (`galley/src/overlay.md`).
//
// Four ideas, and they are the whole model.
//
//  1. A BLOCK ADDRESS, not an offset. `{ sid, where, ordinal, marker }`: which
//     verse, whether the block sits immediately before the verse's `\v`
//     (`leading`) or after its text (`inside`), which one of those it is, and
//     what it is called. The two documents have different lengths and different
//     words; an address is the only thing they can share.
//
//  2. `marker` is a CHECK, not the key. The position is the key. If the
//     position still exists but now spells something else the node doors THROW
//     ("… names q2 but the node there is q1 — the address is stale") rather
//     than answering about a different node, which is the stale-range bug this
//     whole codebase is arranged to make impossible.
//
//  3. An inserted INSIDE block arrives EMPTY. Where a verse's text splits is
//     unknowable across languages, so the transaction inserts the marker and no
//     words; the report says which ones (`inserted[].empty`) and the screen
//     shows a placeholder. The file holds an empty block; nothing is invented.
//
//  4. It is a SUGGESTION, applied on request. Never a finding, never automatic.
//
// ## Offsets
//
// The overlay doors answer in BYTES unless asked for UTF-16 — the unit is a
// property of the call, not of the engine. Sefer has no byte offsets and must
// never acquire one (a byte offset that reached `book.apply` would splice
// inside a character), so every call from `galley.ts` passes `utf16: true` and
// nothing here converts.
//
// ## Drawing the live highlight
//
// Fetch `skeleton()` for both sides ONCE per edit (~0.4 ms each) and match
// addresses in TypeScript as the cursor moves. `targetNodeFor`/`sourceNodeFor`
// are ~1.4 ms and are for one-off questions — "where would this go?" — not for
// a per-keystroke loop.

import type { FormatEdit } from "./format";

/** Which side of its verse a block sits on. */
export type BlockWhere = "leading" | "inside";

/**
 * One block's address, shared by both sides of an overlay.
 *
 * `ordinal` counts from ONE per `(sid, where)` pair, so the second `\q` line
 * leading `GEN 1:1` is ordinal 2.
 */
export interface BlockAddress {
  readonly sid: string;
  readonly where: BlockWhere;
  readonly ordinal: number;
  /** The spelling that position held — `"q1"`, no backslash. Checked, not keyed. */
  readonly marker: string;
}

/**
 * One row of a skeleton: an address, ITS MARKER'S SPAN, and whether the block
 * holds words.
 *
 * `from..to` is the marker and nothing else — `\p` is two characters — which
 * is the right shape for an overlay that inserts and removes markers and the
 * wrong one for asking which block an offset is in. Verified over en_ulb:
 * 31,720 rows across 66 books, every one 6 characters or fewer, none out of
 * order, none overlapping.
 *
 * Note the asymmetry with `SkeletonVerse`, which carries `textFrom`/`textTo`
 * beside its marker span. A block carries no such pair, so the extent is the
 * caller's to derive — `blockExtents` below is that derivation, and the
 * measurement above is what makes it safe.
 */
export interface SkeletonRow extends BlockAddress {
  readonly from: number;
  readonly to: number;
  /** Onion's empty paragraph. A source folds runs of these away. */
  readonly empty: boolean;
}

/** One verse of a skeleton: the `\v` marker's span, and the verse's own text. */
export interface SkeletonVerse {
  readonly sid: string;
  readonly from: number;
  readonly to: number;
  readonly textFrom: number;
  readonly textTo: number;
}

/** One book's block structure — the whole truth for drawing one side. */
export interface Skeleton {
  readonly verses: readonly SkeletonVerse[];
  readonly blocks: readonly SkeletonRow[];
}

/** Why a verse has no pair on the other side. */
export type UnpairedReason = "absent" | "bridge" | "ambiguous";

/**
 * Where one side's block lands on the other. Three answers and no fourth:
 * it is there, it is not there but the overlay knows where it would go, or the
 * verse itself has no pair and the question does not arise.
 */
export type Equivalent =
  | { readonly kind: "found"; readonly row: SkeletonRow }
  | { readonly kind: "absent"; readonly insertAt: number; readonly where: BlockWhere }
  | { readonly kind: "unpaired"; readonly reason: UnpairedReason };

/** A block the overlay would add to the target. */
export interface Inserted {
  readonly address: BlockAddress;
  readonly marker: string;
  readonly at: number;
  /** An `inside` block with no words yet — the screen shows a placeholder. */
  readonly empty: boolean;
}

/** A target block the source lacks; its text joins the block before it. */
export interface Removed {
  readonly address: BlockAddress;
  readonly marker: string;
  readonly from: number;
  readonly to: number;
}

/** A run of empty source blocks folded to one. */
export interface Collapsed {
  readonly sid: string;
  readonly marker: string;
  readonly count: number;
}

/** A verse with no counterpart, and why. */
export interface Unpaired {
  readonly sid: string;
  readonly side: "target" | "source";
  readonly reason: UnpairedReason;
}

/** What the overlay did, and what it declined to do. */
export interface OverlayReport {
  readonly inserted: readonly Inserted[];
  readonly removed: readonly Removed[];
  readonly collapsed: readonly Collapsed[];
  readonly unpaired: readonly Unpaired[];
}

/**
 * The overlay, as one applicable transaction plus its narration.
 *
 * `edits` is what goes through `book.apply` — ascending, non-overlapping,
 * UTF-16 — and `report` is what the confirm dialog reads before it does.
 */
export interface OverlayEdits {
  readonly edits: readonly FormatEdit[];
  readonly report: OverlayReport;
}

/**
 * What the caller may narrow an overlay to.
 *
 * `markers` defaults to onion's paragraph-and-poetry block set with no titles,
 * which is what "match formatting" means; naming a set is how a caller says
 * "sections too" or "poetry only". `scope` bounds it to one chapter or one
 * verse, which is what a per-chapter Apply uses.
 */
export interface OverlayOptions {
  readonly markers?: readonly string[];
  readonly scope?: { readonly chapter: number } | { readonly sid: string };
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const num = (value: unknown): number => (typeof value === "number" ? value : 0);
const flag = (value: unknown): boolean => value === true;
const text = (value: unknown): string => (typeof value === "string" ? value : "");

const whereOf = (value: unknown): BlockWhere => (value === "inside" ? "inside" : "leading");

const reasonOf = (value: unknown): UnpairedReason =>
  value === "bridge" ? "bridge" : value === "ambiguous" ? "ambiguous" : "absent";

/**
 * An address off the wire. Read defensively — this is JSON crossing a wasm
 * boundary, and a reader that assumed its shape would turn a regenerated
 * artifact into silent nonsense about where a paragraph belongs.
 */
const readAddress = (value: unknown): BlockAddress => {
  if (!isRecord(value)) return { sid: "", where: "leading", ordinal: 0, marker: "" };
  return {
    sid: text(value.sid),
    where: whereOf(value.where),
    ordinal: num(value.ordinal),
    marker: text(value.marker),
  };
};

const readRow = (value: unknown): SkeletonRow | undefined => {
  if (!isRecord(value)) return undefined;
  const address = readAddress(value);
  if (address.sid === "") return undefined;
  return { ...address, from: num(value.from), to: num(value.to), empty: flag(value.empty) };
};

const readVerse = (value: unknown): SkeletonVerse | undefined => {
  if (!isRecord(value)) return undefined;
  const sid = text(value.sid);
  if (sid === "") return undefined;
  return {
    sid,
    from: num(value.from),
    to: num(value.to),
    textFrom: num(value.textFrom),
    textTo: num(value.textTo),
  };
};

const list = <T>(value: unknown, read: (entry: unknown) => T | undefined): readonly T[] => {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const entry of value) {
    const one = read(entry);
    if (one !== undefined) out.push(one);
  }
  return out;
};

/** `skeleton()`'s JSON as a `Skeleton` — named apart from `diff.ts`'s
 * `decodeSkeleton`, which reads a DiffSkeleton and is a different buffer. */
export const decodeBlockSkeleton = (json: string): Skeleton => {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed)) return { verses: [], blocks: [] };
  return { verses: list(parsed.verses, readVerse), blocks: list(parsed.blocks, readRow) };
};

/** `overlayReport()`'s JSON as an `OverlayReport`. */
const decodeReport = (json: string): OverlayReport => {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed)) return { inserted: [], removed: [], collapsed: [], unpaired: [] };
  return {
    inserted: list(parsed.inserted, (entry) =>
      isRecord(entry)
        ? {
            address: readAddress(entry.address),
            marker: text(entry.marker),
            at: num(entry.at),
            empty: flag(entry.empty),
          }
        : undefined,
    ),
    removed: list(parsed.removed, (entry) =>
      isRecord(entry)
        ? {
            address: readAddress(entry.address),
            marker: text(entry.marker),
            from: num(entry.from),
            to: num(entry.to),
          }
        : undefined,
    ),
    collapsed: list(parsed.collapsed, (entry) =>
      isRecord(entry)
        ? { sid: text(entry.sid), marker: text(entry.marker), count: num(entry.count) }
        : undefined,
    ),
    unpaired: list(parsed.unpaired, (entry) =>
      isRecord(entry)
        ? {
            sid: text(entry.sid),
            side: entry.side === "source" ? "source" : "target",
            reason: reasonOf(entry.reason),
          }
        : undefined,
    ),
  };
};

/**
 * `targetNodeFor`/`sourceNodeFor`'s JSON as an `Equivalent`.
 *
 * The wire is a three-way union discriminated by which key is present, and it
 * is re-tagged here with an explicit `kind` so a consumer switches on one
 * field instead of probing for three.
 */
export const decodeEquivalent = (json: string): Equivalent => {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed)) return { kind: "unpaired", reason: "absent" };
  if (parsed.found !== undefined) {
    const row = readRow(parsed.found);
    if (row !== undefined) return { kind: "found", row };
  }
  if (parsed.unpaired !== undefined) return { kind: "unpaired", reason: reasonOf(parsed.reason) };
  if (parsed.absent !== undefined)
    return { kind: "absent", insertAt: num(parsed.insertAt), where: whereOf(parsed.where) };
  return { kind: "unpaired", reason: "absent" };
};

/**
 * The options object as the wasm door reads it — plain JSON, `utf16` always
 * on. Built here so `utf16: true` is stated once and no call site can forget.
 */
export const overlayOptions = (options?: OverlayOptions): object => ({
  utf16: true,
  ...(options?.markers === undefined ? {} : { markers: [...options.markers] }),
  ...(options?.scope === undefined ? {} : { scope: options.scope }),
});

/** The overlay's two halves, read together. */
export const decodeOverlay = (edits: readonly FormatEdit[], reportJson: string): OverlayEdits => ({
  edits,
  report: decodeReport(reportJson),
});

/**
 * Every chapter an overlay touches, in ascending order.
 *
 * The confirm dialog names them, because "this will change 14 places" is not a
 * sentence anyone can act on and "this will change Psalms 3, 4 and 7" is. Read
 * off the report's addresses rather than the edits, since an address is the
 * only thing that names a place without a second parse.
 */
/**
 * One block, plus where it actually reaches.
 *
 * A `SkeletonRow`'s `from..to` is the MARKER'S OWN SPAN — `\p` is two
 * characters — not the block it opens. That is the right shape for the
 * overlay, which inserts and removes markers, and the wrong one for anything
 * that asks "which block am I in": measured on en_ulb's Genesis, the rows are
 * 491 two-character spans in a 204,738-character document, so a containment
 * test against them answers "none" almost everywhere.
 *
 * A block therefore runs from its own marker to where the NEXT one begins,
 * which is the only definition the skeleton supports and the one a reader
 * means. The last block runs to the end of the document.
 */
export interface BlockExtent extends SkeletonRow {
  /** Where this block's content ends — the next block's marker, or `docLength`. */
  readonly reaches: number;
}

/**
 * Every block with its extent, in document order.
 *
 * Computed once per skeleton and kept by the caller: it is a pass over an
 * array that is already sorted, and doing it per caret move would be a pass
 * per keystroke for an answer that only changes when the document does.
 */
export const blockExtents = (skeleton: Skeleton, docLength: number): readonly BlockExtent[] => {
  const rows = skeleton.blocks;
  return rows.map((row, at) => ({ ...row, reaches: rows[at + 1]?.from ?? docLength }));
};

/**
 * The block that holds `offset`, or `undefined`.
 *
 * Binary search, because this runs on caret moves: the rows are in document
 * order and their extents abut, so the last block beginning at or before the
 * offset is the only candidate.
 *
 * `undefined` is an ordinary answer, not a failure — an offset before the
 * first block marker is in the front matter, which belongs to no block. A
 * caret there has no pair, which is different from having a pair that is
 * missing.
 */
export const blockAtOffset = (
  extents: readonly BlockExtent[],
  offset: number,
): BlockExtent | undefined => {
  let lo = 0;
  let hi = extents.length - 1;
  let found: BlockExtent | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = extents[mid];
    if (row === undefined) break;
    if (row.from <= offset) {
      found = row;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found !== undefined && offset < found.reaches ? found : undefined;
};

/**
 * The block of THESE extents at the same address, or `undefined`.
 *
 * `(sid, where, ordinal)` and NOT the marker: matching on the name too would
 * mean a `\q1` here and a `\q2` there never pair, which is exactly the
 * correspondence the reader opened this to see (`equivalentBlock` in
 * `app/workflows/stet.ts` says the same thing for the two-column view).
 */
export const equivalentExtent = (
  extents: readonly BlockExtent[],
  address: { readonly sid: string; readonly where: BlockWhere; readonly ordinal: number },
): BlockExtent | undefined =>
  extents.find(
    (row) =>
      row.sid === address.sid && row.where === address.where && row.ordinal === address.ordinal,
  );

/**
 * The verse that holds `offset`, or `undefined`.
 *
 * A `SkeletonVerse` carries BOTH spans — `from..to` is its `\v` marker,
 * `textFrom..textTo` its words — so unlike a block this needs no derivation.
 * Measured on en_ulb Genesis: 1,533 verses, no two overlapping, and a verse's
 * text runs THROUGH the block markers inside it (`GEN 49:1`'s text carries its
 * own `\q1`), which is what makes the verse the right unit for a
 * correspondence: it is the thing both texts agree exists.
 *
 * The match is on the marker and the text together — a caret on the `\v 3`
 * itself is in verse 3 — and `undefined` for an offset in front matter, a
 * heading, or a block between two verses.
 */
export const verseAtOffset = (skeleton: Skeleton, offset: number): SkeletonVerse | undefined => {
  const rows = skeleton.verses;
  let lo = 0;
  let hi = rows.length - 1;
  let found: SkeletonVerse | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = rows[mid];
    if (row === undefined) break;
    if (row.from <= offset) {
      found = row;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found !== undefined && offset < found.textTo ? found : undefined;
};

/** The verse of THIS skeleton with the same sid. The sid is the whole address. */
export const equivalentVerse = (skeleton: Skeleton, sid: string): SkeletonVerse | undefined =>
  skeleton.verses.find((row) => row.sid === sid);
