import { type EditorState, StateEffect, StateField } from "@codemirror/state";

/**
 * The editor's switches: one boolean each, named for the behaviour a person
 * turns on or off, never for a key (`keymaps.ts` says which keys and rules
 * each one gates). The host sets them at mount and changes them live.
 */
export interface EditorPreferences {
  /** "1", "v1", "verse 1" then a space writes that verse (`verseNumber.accept`). */
  readonly verseShortcuts: boolean;
}

export type PreferenceKey = keyof EditorPreferences;

export const DEFAULT_PREFERENCES: EditorPreferences = { verseShortcuts: true };

const setPreferences = StateEffect.define<Partial<EditorPreferences>>();

const preferencesField = StateField.define<EditorPreferences>({
  create: () => DEFAULT_PREFERENCES,
  update: (value, tr) =>
    tr.effects.reduce(
      (current, effect) => (effect.is(setPreferences) ? { ...current, ...effect.value } : current),
      value,
    ),
});

/** The switches as a state field, starting from the defaults with `initial` over them. */
export const editorPreferences = (initial: Partial<EditorPreferences> = {}) =>
  preferencesField.init(() => ({ ...DEFAULT_PREFERENCES, ...initial }));

/** An effect that changes some switches, leaving the rest. */
export const changePreferences = (next: Partial<EditorPreferences>) => setPreferences.of(next);

/** A switch's value; the default where the state carries none (a satellite, the bench). */
export const preferenceOn = (state: EditorState, key: PreferenceKey): boolean =>
  (state.field(preferencesField, false) ?? DEFAULT_PREFERENCES)[key];
