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

import { PRODUCERS, SEVERITIES } from "../core/findings/filter";
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
 * The persistent half of the findings panel's filter (vision §11.4: "category
 * and severity filters should be persistent user preferences").
 *
 * Only the half that is a PREFERENCE is here. Which rungs and which producers
 * a reader wants to see, and whether stale rows are hidden, are lasting
 * choices about how they read; the free-text box and the book selection are
 * session state, because a text filter that survived a restart would present
 * as an empty project and a remembered book set would hide the book you just
 * opened. `src/routes/findings.tsx` holds those two in signals and persists
 * neither.
 *
 * There is no `kind` for a struct, so this key is deliberately NOT in
 * `shellSettings`: the settings form draws one widget per `kind`, and a
 * multi-select over two closed sets is the findings panel's own chip row
 * rather than a generic widget. The panel is the only editor of this key.
 */
const FindingsFilterPreference = Schema.Struct({
  severities: Schema.Array(Schema.Literals(SEVERITIES)),
  producers: Schema.Array(Schema.Literals(PRODUCERS)),
  hideStale: Schema.Boolean,
});

export type FindingsFilterPreference = typeof FindingsFilterPreference.Type;

/** Everything shown: the panel must not open hiding the reason a project is unclean. */
const FINDINGS_FILTER_DEFAULT: FindingsFilterPreference = {
  severities: SEVERITIES,
  producers: PRODUCERS,
  hideStale: false,
};

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
  /**
   * The findings panel's persistent filter. Edited on `/findings`, not on
   * `/settings` — see `FindingsFilterPreference`.
   */
  readonly findingsFilter: SettingKey<FindingsFilterPreference>;
  /**
   * Is the project sidebar showing, or is the workspace down to its icon rail?
   * Written by the rail's panel toggle, and read once when the shell is built.
   */
  readonly sidebarOpen: SettingKey<boolean>;
  /**
   * How wide the project sidebar is, as a FRACTION of the workspace row (rail
   * excluded), because that is the unit `Resizable` speaks: a split conserves
   * fractions, so a pixel width would have to be converted against a root that
   * has not been measured when the panel first renders. Clamped by the panel's
   * own `minSize`/`maxSize`, so a stale value from a much wider window still
   * lands somewhere usable.
   */
  readonly sidebarWidth: SettingKey<number>;
}

/** The sidebar's share of the workspace row, and the range a drag may reach. */
export const SIDEBAR_WIDTH = { default: 0.2, min: 0.15, max: 0.36 } as const;

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
    findingsFilter: settings.register(
      "findings.filter",
      FindingsFilterPreference,
      FINDINGS_FILTER_DEFAULT,
    ),
    sidebarOpen: settings.register("workspace.sidebarOpen", Schema.Boolean, true),
    sidebarWidth: settings.register("workspace.sidebarWidth", Schema.Number, SIDEBAR_WIDTH.default),
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
