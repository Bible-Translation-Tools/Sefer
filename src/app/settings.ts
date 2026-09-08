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

/**
 * Registers the shell's preferences. Called once, from the settings screen's
 * first render, because these are the only screen that reads them; registering
 * the same name twice is a programming error the service notes.
 */
export const shellSettings = (settings: SettingsService): readonly AnyDescriptor[] => [
  {
    key: settings.register("shell.theme", Schema.String, "system"),
    label: "Theme (system, light, dark)",
    kind: "string",
  },
  {
    key: settings.register("shell.startInUsfmMode", Schema.Boolean, false),
    label: "Start books in USFM mode",
    kind: "boolean",
  },
  {
    key: settings.register("shell.autosaveIdleMs", Schema.Number, 1200),
    label: "Autosave idle (ms)",
    kind: "number",
  },
];
