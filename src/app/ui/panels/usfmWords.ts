import type { DiagnosticName } from "@wycliffeassociates/scripture-kitchen/reader";

import { m } from "#app/paraglide/messages";

import type { Message } from "../../i18n";

/** What a USFM finding names, from `diagnosticValues`: its marker, the one it refers to, its number. */
interface UsfmValues {
  readonly anchor: string;
  readonly second: string;
  readonly aux: string;
}

/**
 * Each engine code's sentence in the interface language. Kitchen ships the code
 * and its values; the words are Sefer's, so a code kitchen adds fails `tsc` here.
 */
const SENTENCES = {
  "unclosed-note": (v) => m.usfm_unclosed_note({ anchor: v.anchor }),
  "unclosed-char": (v) => m.usfm_unclosed_char({ anchor: v.anchor }),
  "unclosed-at-eof": (v) => m.usfm_unclosed_at_eof({ anchor: v.anchor }),
  "unterminated-container": (v) => m.usfm_unterminated_container({ anchor: v.anchor }),
  "unterminated-milestone": (v) => m.usfm_unterminated_milestone({ anchor: v.anchor }),
  "orphan-closer": (v) => m.usfm_orphan_closer({ anchor: v.anchor }),
  "orphan-terminator": () => m.usfm_orphan_terminator(),
  "orphan-container-end": (v) => m.usfm_orphan_container_end({ anchor: v.anchor }),
  "content-outside-sidebar-rule": (v) =>
    m.usfm_content_outside_sidebar_rule({ anchor: v.anchor, second: v.second }),
  "unknown-marker": (v) => m.usfm_unknown_marker({ anchor: v.anchor }),
  "nested-spelling-misuse": (v) => m.usfm_nested_spelling_misuse({ anchor: v.anchor }),
  "missing-paragraph": (v) => m.usfm_missing_paragraph({ anchor: v.anchor }),
  "designator-malformed": (v) => m.usfm_designator_malformed({ anchor: v.anchor }),
  "chapter-duplicate": (v) =>
    m.usfm_chapter_duplicate({ anchor: v.anchor, second: v.second, aux: v.aux }),
  "chapter-out-of-order": (v) =>
    m.usfm_chapter_out_of_order({ anchor: v.anchor, second: v.second, aux: v.aux }),
  "chapter-gap": (v) => m.usfm_chapter_gap({ anchor: v.anchor, aux: v.aux }),
  "verse-duplicate": (v) =>
    m.usfm_verse_duplicate({ anchor: v.anchor, second: v.second, aux: v.aux }),
  "verse-out-of-order": (v) =>
    m.usfm_verse_out_of_order({ anchor: v.anchor, second: v.second, aux: v.aux }),
  "verse-gap": (v) => m.usfm_verse_gap({ anchor: v.anchor, aux: v.aux }),
  "missing-verse-one": (v) => m.usfm_missing_verse_one({ anchor: v.anchor, aux: v.aux }),
  "chapter-ends-early": (v) => m.usfm_chapter_ends_early({ anchor: v.anchor, aux: v.aux }),
  "verse-beyond-scheme": (v) => m.usfm_verse_beyond_scheme({ anchor: v.anchor, aux: v.aux }),
  "verse-before-first-chapter": (v) => m.usfm_verse_before_first_chapter({ anchor: v.anchor }),
  "missing-chapter": () => m.usfm_missing_chapter(),
  "missing-id": () => m.usfm_missing_id(),
  "book-code-unknown": (v) => m.usfm_book_code_unknown({ anchor: v.anchor }),
  "book-code-not-uppercase": (v) => m.usfm_book_code_not_uppercase({ anchor: v.anchor }),
  "chapter-without-designator": (v) => m.usfm_chapter_without_designator({ anchor: v.anchor }),
  "verse-without-designator": (v) => m.usfm_verse_without_designator({ anchor: v.anchor }),
  "ca-cp-placement": (v) => m.usfm_ca_cp_placement({ anchor: v.anchor }),
  "va-vp-placement": (v) => m.usfm_va_vp_placement({ anchor: v.anchor }),
  "caller-shape": (v) => m.usfm_caller_shape({ anchor: v.anchor }),
  "numbering-mix": (v) => m.usfm_numbering_mix({ anchor: v.anchor, second: v.second, aux: v.aux }),
  "marker-not-ws-preceded": (v) => m.usfm_marker_not_ws_preceded({ anchor: v.anchor }),
  "delimiter-shape": (v) => m.usfm_delimiter_shape({ anchor: v.anchor }),
  "empty-paragraph": (v) => m.usfm_empty_paragraph({ anchor: v.anchor }),
  "attr-trailing-form-deprecated": (v) => m.usfm_attr_trailing_form_deprecated({ aux: v.aux }),
  "attr-both-lists": (v) => m.usfm_attr_both_lists({ second: v.second }),
  "attr-terminator-mismatch": (v) => m.usfm_attr_terminator_mismatch({ second: v.second }),
  "attr-pipe-hint": (v) => m.usfm_attr_pipe_hint({ second: v.second }),
  "attr-unknown-name": (v) => m.usfm_attr_unknown_name({ second: v.second }),
  "attr-malformed": (v) => m.usfm_attr_malformed({ second: v.second }),
  "attr-required-if": (v) => m.usfm_attr_required_if({ second: v.second }),
  "deprecated-marker": (v) => m.usfm_deprecated_marker({ anchor: v.anchor, aux: v.aux }),
  "deprecated-attribute": (v) => m.usfm_deprecated_attribute({ second: v.second }),
  "marker-out-of-band": (v) => m.usfm_marker_out_of_band({ anchor: v.anchor }),
  "duplicate-id": () => m.usfm_duplicate_id(),
  "paragraph-before-first-chapter": (v) =>
    m.usfm_paragraph_before_first_chapter({ anchor: v.anchor }),
  "delimiter-surplus": (v) => m.usfm_delimiter_surplus({ anchor: v.anchor }),
  "duplicate-usfm": () => m.usfm_duplicate_usfm(),
  "remove-marker": (v) => m.usfm_remove_marker({ anchor: v.anchor }),
  "bridge-empty-verses": (v) => m.usfm_bridge_empty_verses({ anchor: v.anchor }),
  "dedupe-verse-number": (v) => m.usfm_dedupe_verse_number({ anchor: v.anchor }),
  "block-marker-own-line": (v) => m.usfm_block_marker_own_line({ anchor: v.anchor }),
  "char-marker-line-join": () => m.usfm_char_marker_line_join(),
  "collapse-blank-lines": () => m.usfm_collapse_blank_lines(),
  "normalize-newlines": () => m.usfm_normalize_newlines(),
  "trim-text-edges": () => m.usfm_trim_text_edges(),
  "delimiter-single": (v) => m.usfm_delimiter_single({ anchor: v.anchor }),
  "designator-ws-single": (v) => m.usfm_designator_ws_single({ anchor: v.anchor }),
  "marker-ws-at-line-start": (v) => m.usfm_marker_ws_at_line_start({ anchor: v.anchor }),
} satisfies Record<DiagnosticName, (values: UsfmValues) => string>;

/** The repair each code offers, where it offers one. */
const FIX_LABELS: Partial<Record<DiagnosticName, Message>> = {
  "unclosed-note": m.usfm_fix_unclosed_note,
  "unclosed-char": m.usfm_fix_unclosed_char,
  "unclosed-at-eof": m.usfm_fix_unclosed_at_eof,
  "unterminated-container": m.usfm_fix_unterminated_container,
  "unterminated-milestone": m.usfm_fix_unterminated_milestone,
  "orphan-closer": m.usfm_fix_orphan_closer,
  "orphan-terminator": m.usfm_fix_orphan_terminator,
  "missing-paragraph": m.usfm_fix_missing_paragraph,
  "chapter-duplicate": m.usfm_fix_chapter_duplicate,
  "chapter-out-of-order": m.usfm_fix_chapter_out_of_order,
  "verse-duplicate": m.usfm_fix_verse_duplicate,
  "verse-out-of-order": m.usfm_fix_verse_out_of_order,
  "book-code-not-uppercase": m.usfm_fix_book_code_not_uppercase,
  "verse-without-designator": m.usfm_fix_verse_without_designator,
  "marker-not-ws-preceded": m.usfm_fix_marker_not_ws_preceded,
  "empty-paragraph": m.usfm_fix_empty_paragraph,
  "deprecated-marker": m.usfm_fix_deprecated_marker,
  "duplicate-id": m.usfm_fix_duplicate_id,
  "delimiter-surplus": m.usfm_fix_delimiter_surplus,
  "duplicate-usfm": m.usfm_fix_duplicate_usfm,
  "remove-marker": m.usfm_fix_remove_marker,
  "bridge-empty-verses": m.usfm_fix_bridge_empty_verses,
  "dedupe-verse-number": m.usfm_fix_dedupe_verse_number,
  "block-marker-own-line": m.usfm_fix_block_marker_own_line,
  "char-marker-line-join": m.usfm_fix_char_marker_line_join,
  "collapse-blank-lines": m.usfm_fix_collapse_blank_lines,
  "normalize-newlines": m.usfm_fix_normalize_newlines,
  "trim-text-edges": m.usfm_fix_trim_text_edges,
  "delimiter-single": m.usfm_fix_delimiter_single,
  "designator-ws-single": m.usfm_fix_designator_ws_single,
  "marker-ws-at-line-start": m.usfm_fix_marker_ws_at_line_start,
};

const known = (code: string): code is DiagnosticName => Object.hasOwn(SENTENCES, code);

export const usfmSentence = (
  code: string,
  values: Readonly<Record<string, string>>,
): string | undefined =>
  known(code)
    ? SENTENCES[code]({
        anchor: values.anchor ?? "",
        second: values.second ?? "",
        aux: values.aux ?? "",
      })
    : undefined;

export const usfmFixLabel = (code: string): string | undefined =>
  known(code) ? FIX_LABELS[code]?.() : undefined;
