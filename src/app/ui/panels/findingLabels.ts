/**
 * What a person reads for a finding's producer and code — first-pass English
 * until the app has real i18n.
 *
 * Exhaustive by type, not by hope. Each table is a `Record` over the producer's
 * OWN vocabulary from kitchen — onion's catalogue names (`CODES`), and sous's
 * hygiene classes, presence kinds and convention channels — so a code kitchen
 * adds fails the typecheck here until it has a label. An unknown string (a
 * newer engine, `sous.convention.unknown`) falls back to the raw code.
 */

import type { CODES } from "@wycliffeassociates/scripture-kitchen/reader";
import type {
  Channel,
  HygieneClass,
  PresenceKind,
} from "@wycliffeassociates/scripture-kitchen/sous-reader";

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

type OnionCode = (typeof CODES)[number]["name"];

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
} satisfies Record<OnionCode, string>;

const HYGIENE = {
  C0Control: "Invisible control character",
  Delete: "Delete character",
  C1Control: "Invisible control character",
  ReplacementChar: "Replacement character (�)",
  StrayCarriageReturn: "Stray carriage return",
  StrandedBackslash: "Stray backslash",
  ConflictMarker: "Merge conflict marker",
  FreeCombiningMark: "Accent mark with no letter",
  MisplacedFormat: "Misplaced formatting character",
  NoBreakSpace: "No-break space",
  Noncharacter: "Invalid character",
} satisfies Record<HygieneClass, string>;

const PRESENCE = {
  Missing: "Verse missing",
  Extra: "Extra verse",
  Empty: "Empty verse",
} satisfies Record<PresenceKind, string>;

const CONVENTION = {
  ExactNeighbor: "Unusual punctuation pair",
  PooledNeighbor: "Unusual punctuation next to a letter",
  RunShape: "Unusual run of punctuation",
  Placement: "Punctuation in an unusual place",
  Rarity: "Rare character",
  Casing: "Unusual capitalization",
  WordLength: "Unusually long word",
  Doubled: "Doubled word",
  LetterRun: "Repeated letters",
  SentenceStart: "Sentence starts in lowercase",
  BookRate: "Unusual for this book",
} satisfies Record<Channel, string>;

const lookup = (table: Readonly<Record<string, string>>, key: string): string | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined;

/** A finding code as a person reads it; the raw code when this table has none. */
export const codeLabel = (code: string): string => {
  const sous = /^sous\.(hygiene|presence|convention)\.(.+)$/.exec(code);
  const english =
    sous !== null
      ? lookup(
          sous[1] === "hygiene" ? HYGIENE : sous[1] === "presence" ? PRESENCE : CONVENTION,
          sous[2] ?? "",
        )
      : code === "sous.source-copy"
        ? "Copied from the source"
        : code === "sous.length-proportionality"
          ? "Verse length differs from the source"
          : lookup(ONION, code);
  return english === undefined ? code : t(english);
};
