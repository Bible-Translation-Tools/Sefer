import { type EditorState, Facet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * Every phrase the package draws, by key, in English. A host translates them
 * through `EditorWords.phrase`; a key it leaves out (returns `undefined` for)
 * stays English, so a partial translation never shows a blank.
 */
export const PHRASES = {
  "chip.pageBreak": "page break",
  "chip.publishedAs": "published as",
  "attributes.hint": "Enter saves · Esc closes",
  "attributes.readOnly": "Read only",
  "attributes.none": "No attributes. Add one in USFM mode.",
  "attributes.keyLocked": "Keys are locked: change one in USFM mode",
  "verseMenu.changeNumber": "Change number",
  "verseMenu.verseNumber": "Verse number",
  "verseMenu.removeMarker": "Remove verse marker",
  "verseMenu.addVerseAfter": "Add verse after",
  "verseLines.verse": "Verse",
  "verseLines.chapter": "Chapter",
  "emptyChapter.prompt": "Click here to start editing {title}",
} as const;

export type PhraseKey = keyof typeof PHRASES;

/** What a reader calls a marker, in English: the chips' labels. */
const MARKER_WORDS: Readonly<Record<string, string>> = {
  tr: "table row",
  th: "heading cell",
  thc: "heading cell",
  thr: "heading cell",
  tc: "cell",
  tcc: "cell",
  tcr: "cell",
  fig: "figure",
  esb: "sidebar",
  esbe: "sidebar end",
  cat: "category",
  pb: "page break",
  cp: "published chapter",
  periph: "peripheral",
};

/**
 * The words the editor shows, from the host: its language, its names. Both
 * optional, and either may return `undefined` for anything it does not cover.
 */
export interface EditorWords {
  /**
   * What a reader calls a marker (`pb`, `tr`, `fig`, `q2`), as spelled with no
   * backslash; `null` is an attribute list. `closing` is a closer (`\fig*`).
   */
  readonly marker?: (
    marker: string | null,
    context: { readonly closing: boolean },
  ) => string | undefined;
  /**
   * A phrase of the package's UI, by key (`PHRASES`), with its placeholders'
   * values (`{title}` is `values.title`).
   */
  readonly phrase?: (
    key: PhraseKey,
    values: Readonly<Record<string, string>>,
  ) => string | undefined;
}

export const editorWords = Facet.define<EditorWords, EditorWords>({
  combine: (values) => values[0] ?? {},
});

/** A UI phrase in the host's words, or English, its placeholders filled. */
export const phrase = (
  state: EditorState,
  key: PhraseKey,
  values: Readonly<Record<string, string>> = {},
): string =>
  state.facet(editorWords).phrase?.(key, values) ??
  PHRASES[key].replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all);

/** A CSS string literal: the phrase quoted, its quotes and backslashes escaped. */
const cssString = (text: string): string => `"${text.replace(/["\\]/g, "\\$&")}"`;

/**
 * The words the stylesheet draws itself ("Verse 1", "Chapter 2", as `::before`
 * content), handed to it as custom properties in the host's words.
 */
export const drawnWords = EditorView.editorAttributes.of((view) => ({
  style:
    `--usfm-verse-label: ${cssString(phrase(view.state, "verseLines.verse"))}; ` +
    `--usfm-chapter-label: ${cssString(phrase(view.state, "verseLines.chapter"))}`,
}));

/** A marker in the host's words, or English: `\tr` is "table row", `\fig*` "figure end". */
export const markerWords = (
  state: EditorState,
  marker: string | null,
  closing: boolean,
): string => {
  const own = state.facet(editorWords).marker?.(marker, { closing });
  if (own !== undefined) return own;
  if (marker === null) return "attributes";
  const english = MARKER_WORDS[marker.replace(/\d+$/, "")] ?? MARKER_WORDS[marker] ?? marker;
  return closing ? `${english} end` : english;
};
