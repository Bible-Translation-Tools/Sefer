import type { FormatEdit } from "./format";

export type BlockWhere = "leading" | "inside";

export interface BlockAddress {
  readonly sid: string;
  readonly where: BlockWhere;
  readonly ordinal: number;
  readonly marker: string;
}

export interface SkeletonRow extends BlockAddress {
  readonly from: number;
  readonly to: number;
  readonly end: number;
  readonly empty: boolean;
}

export interface SkeletonVerse {
  readonly sid: string;
  readonly from: number;
  readonly to: number;
  readonly textFrom: number;
  readonly textTo: number;
}

export interface Skeleton {
  readonly verses: readonly SkeletonVerse[];
  readonly blocks: readonly SkeletonRow[];
}

export type UnpairedReason = "absent" | "bridge" | "ambiguous";

export type Equivalent =
  | { readonly kind: "found"; readonly row: SkeletonRow }
  | { readonly kind: "absent"; readonly insertAt: number; readonly where: BlockWhere }
  | { readonly kind: "unpaired"; readonly reason: UnpairedReason };

export interface Inserted {
  readonly address: BlockAddress;
  readonly marker: string;
  readonly at: number;
  readonly empty: boolean;
}

export interface Removed {
  readonly address: BlockAddress;
  readonly marker: string;
  readonly from: number;
  readonly to: number;
}

export interface Collapsed {
  readonly sid: string;
  readonly marker: string;
  readonly count: number;
}

export interface Unpaired {
  readonly sid: string;
  readonly side: "target" | "source";
  readonly reason: UnpairedReason;
}

export interface OverlayReport {
  readonly inserted: readonly Inserted[];
  readonly removed: readonly Removed[];
  readonly collapsed: readonly Collapsed[];
  readonly unpaired: readonly Unpaired[];
}

export interface OverlayEdits {
  readonly edits: readonly FormatEdit[];
  readonly report: OverlayReport;
}

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
  return {
    ...address,
    from: num(value.from),
    to: num(value.to),
    end: num(value.end),
    empty: flag(value.empty),
  };
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

export const decodeBlockSkeleton = (json: string): Skeleton => {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed)) return { verses: [], blocks: [] };
  return { verses: list(parsed.verses, readVerse), blocks: list(parsed.blocks, readRow) };
};

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

export const overlayOptions = (options?: OverlayOptions): object => ({
  utf16: true,
  ...(options?.markers === undefined ? {} : { markers: [...options.markers] }),
  ...(options?.scope === undefined ? {} : { scope: options.scope }),
});

export const decodeOverlay = (edits: readonly FormatEdit[], reportJson: string): OverlayEdits => ({
  edits,
  report: decodeReport(reportJson),
});

export const blockAtOffset = (
  blocks: readonly SkeletonRow[],
  offset: number,
): SkeletonRow | undefined => {
  let lo = 0;
  let hi = blocks.length - 1;
  let found: SkeletonRow | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = blocks[mid];
    if (row === undefined) break;
    if (row.from <= offset) {
      found = row;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found !== undefined && offset < found.end ? found : undefined;
};

const sameSid = (left: string, right: string): boolean =>
  left === right || left.toUpperCase() === right.toUpperCase();

export const equivalentBlock = (
  blocks: readonly SkeletonRow[],
  address: { readonly sid: string; readonly where: BlockWhere; readonly ordinal: number },
): SkeletonRow | undefined =>
  blocks.find(
    (row) =>
      sameSid(row.sid, address.sid) &&
      row.where === address.where &&
      row.ordinal === address.ordinal,
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

export const equivalentVerse = (skeleton: Skeleton, sid: string): SkeletonVerse | undefined =>
  skeleton.verses.find((row) => sameSid(row.sid, sid));
