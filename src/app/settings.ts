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
import { DEFAULT_JOURNAL_POLICY } from "../core/recovery/recovery";
import { DEFAULT_EDITOR_FONT_SIZE, EDITOR_FONT_SIZE_RANGE } from "./ui/theme";

/**
 * Which card a row is drawn in. A preference belongs to a group the way a
 * paragraph belongs to a section — the grouping is editorial, so it is declared
 * beside the label rather than inferred from the key's prefix.
 */
export type SettingGroup = "appearance" | "editor" | "advanced";

interface Described {
  readonly label: string;
  /** The sentence under the label. Optional: some rows need no explaining. */
  readonly description?: string;
  readonly group: SettingGroup;
}

export interface BooleanSetting extends Described {
  readonly kind: "boolean";
  readonly key: SettingKey<boolean>;
}

export interface StringSetting extends Described {
  readonly kind: "string";
  readonly key: SettingKey<string>;
}

export interface NumberSetting extends Described {
  readonly kind: "number";
  readonly key: SettingKey<number>;
  /** Bounds and step for the stepper, when the value is a bounded one. */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** How the stepper prints the value — `16` as "16px", `120` as "120%". */
  readonly unit?: string;
}

/**
 * A closed set of named values. `kind: "string"` would have drawn a text box
 * over a preference with exactly three legal answers, which is how a theme
 * ends up set to "drak".
 */
export interface ChoiceSetting extends Described {
  readonly kind: "choice";
  readonly key: SettingKey<string>;
  readonly options: readonly { readonly value: string; readonly label: string }[];
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
export type AnyDescriptor = BooleanSetting | StringSetting | NumberSetting | ChoiceSetting;

/**
 * When each project root was last opened, by root, ISO-8601.
 *
 * A record rather than a list because the question the landing screen asks is
 * "when did I last open THIS one", and a list would make that a scan plus a
 * dedupe. It is a preference and not a cache: it is the only thing that can
 * order the projects list the way someone actually works, and it must survive
 * a restart to be worth anything.
 *
 * Left out of `shellSettings` deliberately — there is no `kind` for a record,
 * and a settings form is not where you edit a history.
 */
const RecentProjects = Schema.Record(Schema.String, Schema.String);

export type RecentProjects = typeof RecentProjects.Type;

/**
 * Where the reader was in each project: the book they had open and the chapter
 * they were clipped to, by project root.
 *
 * A preference and not a cache, for the same reason `recentProjects` is one: a
 * translator works in one book for weeks, and an editor that lands them on a
 * census every morning has made them navigate back to their own work. `chapter`
 * is the CLIP — `null` for the whole book, which is the ordinary case — and it
 * is only obeyed when the book it names is still in the project.
 *
 * Left out of `shellSettings` like `recentProjects`: there is no `kind` for a
 * record, and a settings form is not where you edit a history.
 */
const LastLocations = Schema.Record(
  Schema.String,
  Schema.Struct({ bookId: Schema.String, chapter: Schema.NullOr(Schema.Number) }),
);

export type LastLocations = typeof LastLocations.Type;

/** One project's remembered place. */
export type LastLocation = LastLocations[string];

/** The tokens the shell keeps after registering, by the name the code uses. */
export interface ShellKeys {
  readonly theme: SettingKey<string>;
  readonly startInUsfmMode: SettingKey<boolean>;
  /**
   * How long typing must pause before the WORKING-STATE BACKUP is written.
   * Not the file: the file is written only when a version is recorded, so this
   * is the one automatic write left in the product and the only timing a
   * reader can trade away crash-safety with.
   */
  readonly backupIdleMs: SettingKey<number>;
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
  /**
   * Root font size in px and page zoom in percent. Both are written onto
   * `<html>` by `src/app/ui/theme.ts`, which also caches them so the first
   * paint does not have to wait for the composition.
   */
  readonly fontSize: SettingKey<number>;
  readonly zoom: SettingKey<number>;
  /**
   * The scripture column's own size in px, separate from the interface size:
   * the chrome and the text being translated are read at different distances.
   * `ProjectContext` applies it through `applyEditorFontSize`, so moving the
   * stepper resizes the open book without a reload.
   */
  readonly editorFontSize: SettingKey<number>;
  /** Project root → ISO-8601 of the last open. See `RecentProjects`. */
  readonly recentProjects: SettingKey<RecentProjects>;
  /** Project root → the book and clip the reader last had open there. */
  readonly lastLocation: SettingKey<LastLocations>;
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
    backupIdleMs: settings.register(
      "shell.backupIdleMs",
      Schema.Number,
      DEFAULT_JOURNAL_POLICY.idleMs,
    ),
    preferChapterView: settings.register("editor.preferChapterView", Schema.Boolean, false),
    findingsFilter: settings.register(
      "findings.filter",
      FindingsFilterPreference,
      FINDINGS_FILTER_DEFAULT,
    ),
    sidebarOpen: settings.register("workspace.sidebarOpen", Schema.Boolean, true),
    sidebarWidth: settings.register("workspace.sidebarWidth", Schema.Number, SIDEBAR_WIDTH.default),
    fontSize: settings.register("shell.fontSize", Schema.Number, 16),
    zoom: settings.register("shell.zoom", Schema.Number, 100),
    editorFontSize: settings.register("editor.fontSize", Schema.Number, DEFAULT_EDITOR_FONT_SIZE),
    recentProjects: settings.register("shell.recentProjects", RecentProjects, {}),
    lastLocation: settings.register("workspace.lastLocation", LastLocations, {}),
  };
  registered.set(settings, keys);
  return keys;
};

/** The shell's preferences as the settings form's rows, in display order. */
export const shellSettings = (settings: SettingsService): readonly AnyDescriptor[] => {
  const keys = shellKeys(settings);
  return [
    {
      key: keys.theme,
      label: "Display mode",
      description: "Choose the theme used throughout the application.",
      kind: "choice",
      group: "appearance",
      options: [
        { value: "system", label: "System" },
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ],
    },
    {
      key: keys.fontSize,
      label: "Interface text size",
      description: "Scales every size in the interface, in pixels.",
      kind: "number",
      group: "appearance",
      min: 12,
      max: 24,
      step: 1,
      unit: "px",
    },
    {
      key: keys.zoom,
      label: "Zoom",
      description: "Adjust the overall application zoom.",
      kind: "number",
      group: "appearance",
      min: 50,
      max: 200,
      step: 10,
      unit: "%",
    },
    {
      key: keys.editorFontSize,
      label: "Scripture text size",
      description: "How large the book itself is set, in pixels.",
      kind: "number",
      group: "editor",
      min: EDITOR_FONT_SIZE_RANGE.min,
      max: EDITOR_FONT_SIZE_RANGE.max,
      step: 1,
      unit: "px",
    },
    {
      key: keys.startInUsfmMode,
      label: "Editor mode default",
      description: "Open books in USFM mode instead of the reading projection.",
      kind: "boolean",
      group: "editor",
    },
    {
      key: keys.preferChapterView,
      label: "Open books one chapter at a time",
      description: "A book is one document; turn this on to clip the view to a chapter.",
      kind: "boolean",
      group: "editor",
    },
    {
      key: keys.backupIdleMs,
      label: "Back up work after",
      description:
        "How long typing must pause before the working-state backup is written. The file itself is written only when you record a version.",
      kind: "number",
      group: "advanced",
      min: 200,
      max: 10000,
      step: 100,
      unit: "ms",
    },
  ];
};

/** The cards `/settings` draws, in display order, with their headings. */
export const SETTING_GROUPS: readonly {
  readonly id: SettingGroup;
  readonly title: string;
  readonly subtitle: string;
}[] = [
  {
    id: "appearance",
    title: "App appearance",
    subtitle: "How Sefer looks on this device.",
  },
  { id: "editor", title: "Editor", subtitle: "What a book does when it opens." },
  { id: "advanced", title: "Advanced", subtitle: "Timings and machinery." },
];
