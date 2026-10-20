import type { BookId } from "@sefer/text/book";
import { addressCode } from "@sefer/text/location/address";
import { tocUnits, unitAddress, unitIndexAt, type TocView } from "@sefer/text/location/locate";
import { Result, Schema } from "effect";

import { ordinalOf, siteIdentityOf } from "../galley";

export const SOUS_SUPPRESSIONS_FILE = ".sefer/sous-chef-suppressions.json";

export type Rung = "here" | "everywhere";

const EntrySchema = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
});

export type SuppressionEntry = typeof EntrySchema.Type;

const FileSchema = Schema.Struct({
  v: Schema.Literal(1),
  here: Schema.Array(EntrySchema),
  everywhere: Schema.Array(EntrySchema),
});

const decodeFile = Schema.decodeUnknownResult(FileSchema);

export interface Suppressions {
  readonly here: ReadonlyMap<string, SuppressionEntry>;
  readonly everywhere: ReadonlyMap<string, SuppressionEntry>;
}

export const NO_SUPPRESSIONS: Suppressions = { here: new Map(), everywhere: new Map() };

export const isEmpty = (suppressions: Suppressions): boolean =>
  suppressions.here.size === 0 && suppressions.everywhere.size === 0;

const byId = (entries: readonly SuppressionEntry[]): ReadonlyMap<string, SuppressionEntry> =>
  new Map(entries.map((entry) => [entry.id, entry]));

export const decodeSuppressions = (text: string): Suppressions | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const decoded = decodeFile(parsed);
  if (Result.isFailure(decoded)) return undefined;
  return { here: byId(decoded.success.here), everywhere: byId(decoded.success.everywhere) };
};

export const encodeSuppressions = (suppressions: Suppressions): string =>
  `${JSON.stringify(
    {
      v: 1,
      here: [...suppressions.here.values()],
      everywhere: [...suppressions.everywhere.values()],
    },
    null,
    2,
  )}\n`;

export const withSuppression = (
  suppressions: Suppressions,
  rung: Rung,
  id: string,
  at: string,
): Suppressions => {
  const next = new Map(suppressions[rung]);
  next.set(id, { id, at });
  return { ...suppressions, [rung]: next };
};

export const withoutSuppression = (suppressions: Suppressions, id: string): Suppressions => {
  if (!suppressions.here.has(id) && !suppressions.everywhere.has(id)) return suppressions;
  const here = new Map(suppressions.here);
  const everywhere = new Map(suppressions.everywhere);
  here.delete(id);
  everywhere.delete(id);
  return { here, everywhere };
};

export interface SuppressionKeys {
  readonly here: string;
  readonly everywhere?: string;
}

interface Verse {
  readonly ref: string;
  readonly from: number;
  readonly text: string;
}

const verseAt = (bookId: BookId, text: string, toc: TocView, at: number): Verse | undefined => {
  const units = tocUnits(toc);
  const unit = units[unitIndexAt(units, at)];
  if (unit === undefined) return undefined;
  return {
    ref: addressCode(unitAddress(bookId, toc, unit)),
    from: unit.from,
    text: text.slice(unit.from, unit.to),
  };
};

export const siteKeyOf = (
  bookId: BookId,
  text: string,
  toc: TocView,
  from: number,
  to: number,
): string | undefined => {
  const verse = verseAt(bookId, text, toc, from);
  if (verse === undefined || to > verse.from + verse.text.length) return undefined;
  const siteText = text.slice(from, to);
  return siteIdentityOf({
    verseRef: verse.ref,
    siteText,
    ordinal: ordinalOf(verse.text, siteText, from - verse.from),
  });
};

const unescape = (field: string): string =>
  field.replace(/%([0-9A-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );

const siteFields = (
  id: string,
): { readonly ref: string; readonly siteText: string; readonly ordinal: number } | undefined => {
  const fields = id.split(":");
  if (fields.length !== 5 || fields[0] !== "v1" || fields[1] !== "s") return undefined;
  const [, , ref, siteText, ordinal] = fields;
  if (ref === undefined || siteText === undefined || ordinal === undefined) return undefined;
  const ordinalNumber = Number(ordinal);
  if (!Number.isInteger(ordinalNumber) || ordinalNumber < 0) return undefined;
  return { ref: unescape(ref), siteText: unescape(siteText), ordinal: ordinalNumber };
};

export const versesOf = (
  bookId: BookId,
  text: string,
  toc: TocView,
): ReadonlyMap<string, readonly string[]> => {
  const out = new Map<string, string[]>();
  for (const unit of tocUnits(toc)) {
    const ref = addressCode(unitAddress(bookId, toc, unit));
    const held = out.get(ref);
    const verse = text.slice(unit.from, unit.to);
    if (held === undefined) out.set(ref, [verse]);
    else held.push(verse);
  }
  return out;
};

export const staleHere = (
  suppressions: Suppressions,
  versesIn: (bookId: string) => ReadonlyMap<string, readonly string[]> | undefined,
): readonly string[] => {
  const books = new Map<string, ReadonlyMap<string, readonly string[]> | undefined>();
  const out: string[] = [];
  for (const id of suppressions.here.keys()) {
    const site = siteFields(id);
    if (site === undefined || site.siteText === "") continue;
    const bookId = site.ref.split(" ")[0] ?? "";
    if (!books.has(bookId)) books.set(bookId, versesIn(bookId));
    const verses = books.get(bookId);
    if (verses === undefined) continue;
    const held = (verses.get(site.ref) ?? []).some(
      (verse) => ordinalOf(verse, site.siteText, verse.length + 1) > site.ordinal,
    );
    if (!held) out.push(id);
  }
  return out;
};
