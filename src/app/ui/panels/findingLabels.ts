import type { DiagnosticName } from "@wycliffeassociates/scripture-kitchen/reader";
import type { SousCode } from "@wycliffeassociates/scripture-kitchen/sous-reader";

import { m } from "#app/paraglide/messages";
import type { Producer } from "#core/findings/finding";

import type { Message } from "../../i18n";

export const producerLabel = (producer: Producer): string => {
  switch (producer) {
    case "onion":
      return m.findings_usfm();
    case "sous":
      return m.common_proofreading();
    case "project":
      return m.findings_other();
  }
};

const ONION = {
  "unclosed-note": m.finding_unclosed_note,
  "unclosed-char": m.finding_unclosed_char,
  "unclosed-at-eof": m.finding_unclosed_at_eof,
  "unterminated-container": m.finding_unterminated_container,
  "unterminated-milestone": m.finding_unterminated_milestone,
  "orphan-closer": m.finding_orphan_closer,
  "orphan-terminator": m.finding_orphan_terminator,
  "orphan-container-end": m.finding_orphan_container_end,
  "content-outside-sidebar-rule": m.finding_content_outside_sidebar_rule,
  "unknown-marker": m.finding_unknown_marker,
  "nested-spelling-misuse": m.finding_nested_spelling_misuse,
  "missing-paragraph": m.finding_missing_paragraph,
  "designator-malformed": m.finding_designator_malformed,
  "chapter-duplicate": m.finding_chapter_duplicate,
  "chapter-out-of-order": m.finding_chapter_out_of_order,
  "chapter-gap": m.finding_chapter_gap,
  "verse-duplicate": m.finding_verse_duplicate,
  "verse-out-of-order": m.finding_verse_out_of_order,
  "verse-gap": m.finding_verse_gap,
  "missing-verse-one": m.finding_missing_verse_one,
  "verse-before-first-chapter": m.finding_verse_before_first_chapter,
  "missing-chapter": m.finding_missing_chapter,
  "missing-id": m.finding_missing_id,
  "book-code-unknown": m.finding_book_code_unknown,
  "book-code-not-uppercase": m.finding_book_code_not_uppercase,
  "chapter-without-designator": m.finding_chapter_without_designator,
  "verse-without-designator": m.finding_verse_without_designator,
  "ca-cp-placement": m.finding_ca_cp_placement,
  "va-vp-placement": m.finding_va_vp_placement,
  "caller-shape": m.finding_caller_shape,
  "numbering-mix": m.finding_numbering_mix,
  "marker-not-ws-preceded": m.finding_marker_not_ws_preceded,
  "delimiter-shape": m.finding_delimiter_shape,
  "empty-paragraph": m.finding_empty_paragraph,
  "attr-trailing-form-deprecated": m.finding_attr_trailing_form_deprecated,
  "attr-both-lists": m.finding_attr_both_lists,
  "attr-terminator-mismatch": m.finding_attr_terminator_mismatch,
  "attr-pipe-hint": m.finding_attr_pipe_hint,
  "attr-unknown-name": m.finding_attr_unknown_name,
  "attr-malformed": m.finding_attr_malformed,
  "attr-required-if": m.finding_attr_required_if,
  "deprecated-marker": m.finding_deprecated_marker,
  "deprecated-attribute": m.finding_deprecated_attribute,
  "marker-out-of-band": m.finding_marker_out_of_band,
  "duplicate-id": m.finding_duplicate_id,
  "paragraph-before-first-chapter": m.finding_paragraph_before_first_chapter,
  "delimiter-surplus": m.finding_delimiter_surplus,
  "duplicate-usfm": m.finding_duplicate_usfm,
  "remove-marker": m.finding_remove_marker,
  "bridge-empty-verses": m.finding_bridge_empty_verses,
  "dedupe-verse-number": m.finding_dedupe_verse_number,
  "block-marker-own-line": m.finding_block_marker_own_line,
  "char-marker-line-join": m.finding_char_marker_line_join,
  "collapse-blank-lines": m.finding_collapse_blank_lines,
  "normalize-newlines": m.finding_normalize_newlines,
  "trim-text-edges": m.finding_trim_text_edges,
  "delimiter-single": m.finding_delimiter_single,
  "designator-ws-single": m.finding_designator_ws_single,
  "marker-ws-at-line-start": m.finding_marker_ws_at_line_start,
} satisfies Record<DiagnosticName, Message>;

const SOUS = {
  "hygiene.C0Control": m.finding_hygiene_c0control,
  "hygiene.Delete": m.finding_hygiene_delete,
  "hygiene.C1Control": m.finding_hygiene_c0control,
  "hygiene.ReplacementChar": m.finding_hygiene_replacementchar,
  "hygiene.StrayCarriageReturn": m.finding_hygiene_straycarriagereturn,
  "hygiene.StrandedBackslash": m.finding_hygiene_strandedbackslash,
  "hygiene.ConflictMarker": m.finding_hygiene_conflictmarker,
  "hygiene.FreeCombiningMark": m.finding_hygiene_freecombiningmark,
  "hygiene.MisplacedFormat": m.finding_hygiene_misplacedformat,
  "hygiene.NoBreakSpace": m.finding_hygiene_nobreakspace,
  "hygiene.Noncharacter": m.finding_hygiene_noncharacter,
  "presence.Missing": m.finding_presence_missing,
  "presence.Extra": m.finding_presence_extra,
  "presence.Empty": m.finding_presence_empty,
  "convention.ExactNeighbor": m.finding_convention_exactneighbor,
  "convention.PooledNeighbor": m.finding_convention_pooledneighbor,
  "convention.RunShape": m.finding_convention_runshape,
  "convention.Placement": m.finding_convention_placement,
  "convention.Rarity": m.finding_convention_rarity,
  "convention.Casing": m.finding_convention_casing,
  "convention.WordLength": m.finding_convention_wordlength,
  "convention.Doubled": m.finding_convention_doubled,
  "convention.LetterRun": m.finding_convention_letterrun,
  "convention.SentenceStart": m.finding_convention_sentencestart,
  "convention.BookRate": m.finding_convention_bookrate,
  sourceCopy: m.finding_sourcecopy,
  lengthProportionality: m.finding_lengthproportionality,
} satisfies Record<SousCode, Message>;

const lookup = (table: Readonly<Record<string, Message>>, key: string): Message | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined;

const SOUS_SPELLING: Readonly<Record<string, string>> = {
  "source-copy": "sourceCopy",
  "length-proportionality": "lengthProportionality",
};

export const codeLabel = (code: string): string => {
  const sous = code.startsWith("sous.") ? code.slice("sous.".length) : undefined;
  const label =
    sous === undefined ? lookup(ONION, code) : lookup(SOUS, SOUS_SPELLING[sous] ?? sous);
  return label === undefined ? code : label();
};
