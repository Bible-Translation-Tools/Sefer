import { type EditorState, Facet } from "@codemirror/state";

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
  /** A phrase of the package's UI, by key (`PHRASES`). */
  readonly phrase?: (key: PhraseKey) => string | undefined;
}

export const editorWords = Facet.define<EditorWords, EditorWords>({
  combine: (values) => values[0] ?? {},
});

/** A UI phrase in the host's words, or English. */
export const phrase = (state: EditorState, key: PhraseKey): string =>
  state.facet(editorWords).phrase?.(key) ?? PHRASES[key];

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
