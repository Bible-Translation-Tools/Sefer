/**
 * What a person reads for a finding's producer and code — first-pass English
 * until the app has real i18n.
 *
 * Exhaustive by type, not by hope. Each table is a `Record` over the union
 * kitchen exports for its producer (0.1.10): onion's `DiagnosticName` and
 * sous's `SousCode` — so a code kitchen adds fails the typecheck here until it
 * has a label. An unknown string (a newer engine) falls back to the raw code.
 */

import type { DiagnosticName } from "@wycliffeassociates/scripture-kitchen/reader";
import type { SousCode } from "@wycliffeassociates/scripture-kitchen/sous-reader";

import type { Producer } from "#core/findings/finding";

import { t } from "../../i18n";

/** USFM checks, proofreading, and anything Sefer finds across books. */
export const producerLabel = (producer: Producer): string => {
  switch (producer) {
    case "onion":
      return t("USFM");
    case "sous":
      return t("Proofreading");
    case "project":
      return t("Other");
  }
};

const ONION = {
  "unclosed-note": "Note not closed",
  "unclosed-char": "Character style not closed",
  "unclosed-at-eof": "Not closed by the end of the book",
  "unterminated-container": "Section not ended",
  "unterminated-milestone": "Milestone not ended",
  "orphan-closer": "Closing marker with nothing open",
  "orphan-terminator": "End marker with nothing open",
  "orphan-container-end": "Section end with nothing open",
  "content-outside-sidebar-rule": "Text outside a sidebar",
  "unknown-marker": "Unknown marker",
  "nested-spelling-misuse": "Nested marker spelled wrong",
  "missing-paragraph": "Text with no paragraph",
  "designator-malformed": "Chapter or verse number malformed",
  "chapter-duplicate": "Chapter repeated",
  "chapter-out-of-order": "Chapter out of order",
  "chapter-gap": "Chapter missing in sequence",
  "verse-duplicate": "Verse repeated",
  "verse-out-of-order": "Verse out of order",
  "verse-gap": "Verse missing in sequence",
  "missing-verse-one": "No verse 1",
  "verse-before-first-chapter": "Verse before the first chapter",
  "missing-chapter": "Chapter missing",
  "missing-id": "No book code (\\id)",
  "book-code-unknown": "Unknown book code",
  "book-code-not-uppercase": "Book code not in capitals",
  "chapter-without-designator": "Chapter with no number",
  "verse-without-designator": "Verse with no number",
  "ca-cp-placement": "Alternate chapter number misplaced",
  "va-vp-placement": "Alternate verse number misplaced",
  "caller-shape": "Note caller malformed",
  "numbering-mix": "Numbering styles mixed",
  "marker-not-ws-preceded": "Marker not preceded by a space",
  "delimiter-shape": "Spacing around a marker",
  "empty-paragraph": "Empty paragraph",
  "attr-trailing-form-deprecated": "Old-style attribute",
  "attr-both-lists": "Attributes written twice",
  "attr-terminator-mismatch": "Attribute end mismatch",
  "attr-pipe-hint": "Stray attribute bar",
  "attr-unknown-name": "Unknown attribute",
  "attr-malformed": "Attribute malformed",
  "attr-required-if": "Required attribute missing",
  "deprecated-marker": "Outdated marker",
  "deprecated-attribute": "Outdated attribute",
  "marker-out-of-band": "Marker in the wrong place",
  "duplicate-id": "Book code repeated",
  "paragraph-before-first-chapter": "Paragraph before the first chapter",
  "delimiter-surplus": "Extra spacing",
  "duplicate-usfm": "USFM version repeated",
  // Formatting repairs: never findings (their severity is "form"), named so
  // the table stays exhaustive.
  "remove-marker": "Marker to remove",
  "bridge-empty-verses": "Empty verses to bridge",
  "dedupe-verse-number": "Repeated verse number",
  "block-marker-own-line": "Block marker on its own line",
  "char-marker-line-join": "Character marker split across lines",
  "collapse-blank-lines": "Blank lines",
  "normalize-newlines": "Line endings",
  "trim-text-edges": "Spaces at text edges",
  "delimiter-single": "Double spacing",
  "designator-ws-single": "Spacing after a number",
  "marker-ws-at-line-start": "Space before a marker at line start",
} satisfies Record<DiagnosticName, string>;

/** Sous by its own code; Sefer files them under `sous.<code>`. */
const SOUS = {
  "hygiene.C0Control": "Invisible control character",
  "hygiene.Delete": "Delete character",
  "hygiene.C1Control": "Invisible control character",
  "hygiene.ReplacementChar": "Replacement character (�)",
  "hygiene.StrayCarriageReturn": "Stray carriage return",
  "hygiene.StrandedBackslash": "Stray backslash",
  "hygiene.ConflictMarker": "Merge conflict marker",
  "hygiene.FreeCombiningMark": "Accent mark with no letter",
  "hygiene.MisplacedFormat": "Misplaced formatting character",
  "hygiene.NoBreakSpace": "No-break space",
  "hygiene.Noncharacter": "Invalid character",
  "presence.Missing": "Verse missing",
  "presence.Extra": "Extra verse",
  "presence.Empty": "Empty verse",
  "convention.ExactNeighbor": "Unusual punctuation pair",
  "convention.PooledNeighbor": "Unusual punctuation next to a letter",
  "convention.RunShape": "Unusual run of punctuation",
  "convention.Placement": "Punctuation in an unusual place",
  "convention.Rarity": "Rare character",
  "convention.Casing": "Unusual capitalization",
  "convention.WordLength": "Unusually long word",
  "convention.Doubled": "Doubled word",
  "convention.LetterRun": "Repeated letters",
  "convention.SentenceStart": "Sentence starts in lowercase",
  "convention.BookRate": "Unusual for this book",
  sourceCopy: "Copied from the source",
  lengthProportionality: "Verse length differs from the source",
} satisfies Record<SousCode, string>;

const lookup = (table: Readonly<Record<string, string>>, key: string): string | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined;

/** A finding code as a person reads it; the raw code when this table has none. */
/** Sefer's two kebab-case sous codes, as kitchen spells them. */
const SOUS_SPELLING: Readonly<Record<string, string>> = {
  "source-copy": "sourceCopy",
  "length-proportionality": "lengthProportionality",
};

/** A finding code as a person reads it; the raw code when this table has none. */
export const codeLabel = (code: string): string => {
  const sous = code.startsWith("sous.") ? code.slice("sous.".length) : undefined;
  const english =
    sous === undefined ? lookup(ONION, code) : lookup(SOUS, SOUS_SPELLING[sous] ?? sous);
  return english === undefined ? code : t(english);
};
