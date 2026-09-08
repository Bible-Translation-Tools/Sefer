/**
 * The preferences the SHELL owns, and the descriptors the settings screen
 * renders them from.
 *
 * `SettingsService` deliberately has no "list every registered key": a key is
 * owned by the module that declared it, and a generic enumeration would invite
 * one module's screen to write another's preference. So each owner declares
 * its keys and publishes the descriptors its own UI needs — this file is the
 * shell's set, and the settings route renders exactly these.
 *
 * `kind` exists because a `Schema.Codec` cannot be asked what widget to draw.
 * It is the one piece of presentation the declaration carries.
 */

import { Schema } from "effect";

import type { SettingKey, SettingsService } from "../core/host/settings";

export interface BooleanSetting {
  readonly kind: "boolean";
  readonly key: SettingKey<boolean>;
  readonly label: string;
}

export interface StringSetting {
  readonly kind: "string";
  readonly key: SettingKey<string>;
  readonly label: string;
}

export interface NumberSetting {
  readonly kind: "number";
  readonly key: SettingKey<number>;
  readonly label: string;
}

/**
 * Every shell preference, as one list the form can walk. A discriminated
 * union rather than `Descriptor<unknown>`: `kind` is what tells the form which
 * widget to draw AND what type the key holds, and a switch on it narrows both
 * at once.
 */
export type AnyDescriptor = BooleanSetting | StringSetting | NumberSetting;

/** The tokens the shell keeps after registering, by the name the code uses. */
export interface ShellKeys {
  readonly theme: SettingKey<string>;
  readonly startInUsfmMode: SettingKey<boolean>;
  readonly autosaveIdleMs: SettingKey<number>;
  /**
   * Off by default, and that default is a decision: a book is ONE document,
   * so the editor shows the whole of it and scrolls. Turning this on clips the
   * view to a chapter at a time (`ProjectContext` picks the chapter at open,
   * the picker changes it) for people who would rather read that way.
   */
  readonly preferChapterView: SettingKey<boolean>;
}

/**
 * Registered once per `SettingsService`, and cached.
 *
 * There are two readers now — the settings screen renders the descriptors, and
 * the shell reads `preferChapterView` when it opens a book — and registering
 * the same name twice is a programming error the service notes. So the keys
 * are declared here, memoised against the service that holds them, and both
 * readers ask for the same tokens rather than each declaring their own.
 */
const registered = new WeakMap<SettingsService, ShellKeys>();

export const shellKeys = (settings: SettingsService): ShellKeys => {
  const held = registered.get(settings);
  if (held !== undefined) return held;
  const keys: ShellKeys = {
    theme: settings.register("shell.theme", Schema.String, "system"),
    startInUsfmMode: settings.register("shell.startInUsfmMode", Schema.Boolean, false),
    autosaveIdleMs: settings.register("shell.autosaveIdleMs", Schema.Number, 1200),
    preferChapterView: settings.register("editor.preferChapterView", Schema.Boolean, false),
  };
  registered.set(settings, keys);
  return keys;
};

/** The shell's preferences as the settings form's rows, in display order. */
export const shellSettings = (settings: SettingsService): readonly AnyDescriptor[] => {
  const keys = shellKeys(settings);
  return [
    { key: keys.theme, label: "Theme (system, light, dark)", kind: "string" },
    { key: keys.startInUsfmMode, label: "Start books in USFM mode", kind: "boolean" },
    {
      key: keys.preferChapterView,
      label: "Open books one chapter at a time",
      kind: "boolean",
    },
    { key: keys.autosaveIdleMs, label: "Autosave idle (ms)", kind: "number" },
  ];
};
