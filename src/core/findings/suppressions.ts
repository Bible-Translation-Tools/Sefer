// suppressions.ts
//
// Proofreading suppressions: the reader's word that a Sous finding is fine.
//
//   .sefer/sous-chef-suppressions.json   { v: 1, here: [...], everywhere: [...] }
//
//   here         "Fine here": this text at this place, whatever flags it,
//                saved as kitchen's site identity (`v1:s:GEN 1%3A2:—:0`).
//   everywhere   "Always allow": this exact claim anywhere in the project,
//                saved as kitchen's pattern identity (`v1:p:Doubled:…:bare`);
//                the check still watches everything else.
//
// Turning a whole check off is not here: that is Sous settings.
//
// An identity names TEXT, never offsets: the verse as `addressCode` spells
// it, the flagged text, and how many identical texts start earlier in the
// verse's raw USFM (kitchen's contract, `sous-messages.md`, "Stable
// identity"). So an edit elsewhere in the verse leaves a suppression alone;
// editing the flagged text, renumbering the verse, or adding the same text
// earlier in it brings the finding back.
//
// Per device, in `.sefer/`, which never reaches a commit, a zip or a
// teammate; sharing is a later decision
// (`planning/items/2026-10-06-project-state-and-suppressions.mdx`).

import type { BookId } from "@sefer/text/book";
import { addressCode } from "@sefer/text/location/address";
import { tocUnits, unitAddress, unitIndexAt, type TocView } from "@sefer/text/location/locate";
import { Result, Schema } from "effect";

import { ordinalOf, siteIdentityOf } from "../galley";

export const SOUS_SUPPRESSIONS_FILE = ".sefer/sous-chef-suppressions.json";

/** The two rungs a suppression is saved on. "Turn off" is a setting, not a rung. */
export type Rung = "here" | "everywhere";

const EntrySchema = Schema.Struct({
  /** Kitchen's identity: `v1:s:…` for `here`, `v1:p:…` for `everywhere`. */
  id: Schema.String,
  /** When it was saved, ISO. */
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

/**
 * The file's text, or `undefined` for one this build cannot read: a writer
 * must not save over a file it could not read, or it would erase it.
 */
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

/** What a finding offers the ladder: its site always, its pattern for a Convention finding. */
export interface SuppressionKeys {
  readonly here: string;
  readonly everywhere?: string;
}

/**
 * The verse a span sits in, as an identity names it: the TOC unit's address
 * and its raw USFM. Text before verse 1 is its chapter's (`PSA 3`), the
 * introduction `GEN 0`.
 */
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

/** `here`'s identity for the span `[from, to)` of a book's text. */
export const siteKeyOf = (
  bookId: BookId,
  text: string,
  toc: TocView,
  from: number,
  to: number,
): string | undefined => {
  const verse = verseAt(bookId, text, toc, from);
  // A span running past its verse (a doubled word split by `\v`) could not
  // be found in that verse again, so pruning would drop it at once: such a
  // finding offers no "Fine here".
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

/** A site identity's three fields; the verse, the site's text and the ordinal are always last. */
const siteFields = (
  id: string,
): { readonly ref: string; readonly siteText: string; readonly ordinal: number } | undefined => {
  const fields = id.split(":");
  if (fields.length !== 5 || fields[0] !== "v1" || fields[1] !== "s") return undefined;
  const [, , ref, siteText, ordinal] = fields;
  if (ref === undefined || siteText === undefined || ordinal === undefined) return undefined;
  const n = Number(ordinal);
  if (!Number.isInteger(n) || n < 0) return undefined;
  return { ref: unescape(ref), siteText: unescape(siteText), ordinal: n };
};

/**
 * Every verse of a book by its reference, raw USFM: what pruning reads. A
 * reference several units share (a duplicated `\v`, a `\v 0` beside its
 * chapter's head) keeps every one of them.
 */
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

/**
 * `here` entries whose text is gone: the verse no longer holds the flagged
 * text at that ordinal. Decided on the TEXT, never on whether a finding still
 * fires, because a check switched off hides a finding the text still has.
 * An entry whose book `versesIn` does not hold is kept: nothing says it is
 * gone. `everywhere` is never pruned.
 */
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
    // Still there if any unit with this reference holds the text at that ordinal.
    const held = (verses.get(site.ref) ?? []).some(
      (verse) => ordinalOf(verse, site.siteText, verse.length + 1) > site.ordinal,
    );
    if (!held) out.push(id);
  }
  return out;
};
