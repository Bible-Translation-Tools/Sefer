import { type EditorState, StateEffect, StateField } from "@codemirror/state";

/**
 * The editor's preferences, named for the behaviour a person sets, never for
 * a key (`keymaps.ts` says which keys and rules each one gates): switches,
 * one boolean each, and values. The host sets them at mount and changes them
 * live.
 */
export interface EditorPreferences {
  /** "1", "v1", "verse 1" then a space writes that verse (`verseNumber.accept`). */
  readonly verseShortcuts: boolean;
  /**
   * How many spaces typed at a line's start move it one poetry level in
   * (`poetry.indentBySpaces`), as Tab does; 0 is never. VS Code's tab size,
   * for a book that indents by level rather than by character.
   */
  readonly indentSpaces: number;
}

/** The switches: the preferences a bundle can be turned off by. */
export type PreferenceKey = {
  [K in keyof EditorPreferences]: EditorPreferences[K] extends boolean ? K : never;
}[keyof EditorPreferences];

export const DEFAULT_PREFERENCES: EditorPreferences = { verseShortcuts: true, indentSpaces: 4 };

const setPreferences = StateEffect.define<Partial<EditorPreferences>>();

const preferencesField = StateField.define<EditorPreferences>({
  create: () => DEFAULT_PREFERENCES,
  update: (value, tr) =>
    tr.effects.reduce(
      (current, effect) => (effect.is(setPreferences) ? { ...current, ...effect.value } : current),
      value,
    ),
});

/** The preferences as a state field, starting from the defaults with `initial` over them. */
export const editorPreferences = (initial: Partial<EditorPreferences> = {}) =>
  preferencesField.init(() => ({ ...DEFAULT_PREFERENCES, ...initial }));

/** An effect that changes some preferences, leaving the rest. */
export const changePreferences = (next: Partial<EditorPreferences>) => setPreferences.of(next);

/** A preference's value; the default where the state carries none (a satellite, the bench). */
export const preferenceOf = <K extends keyof EditorPreferences>(
  state: EditorState,
  key: K,
): EditorPreferences[K] => (state.field(preferencesField, false) ?? DEFAULT_PREFERENCES)[key];

/** A switch's value. */
export const preferenceOn = (state: EditorState, key: PreferenceKey): boolean =>
  preferenceOf(state, key);
