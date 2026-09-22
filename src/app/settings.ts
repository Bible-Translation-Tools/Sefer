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
export type SettingGroup = "appearance" | "editor" | "network" | "advanced";

interface Described {
  readonly label: string;
  /** The sentence under the label. Optional: some rows need no explaining. */
  readonly description?: string;
  readonly group: SettingGroup;
  /**
   * The hosts this row is worth showing on. Absent means all of them.
   *
   * It exists for one preference: the WACS endpoint on the Web is normally a
   * proxy, because a browser cannot reach the content host directly, and
   * desktop has no such problem. Offering the same box on both would invite
   * somebody to paste a proxy URL into a build that does not need one.
   */
  readonly hosts?: readonly ("web" | "tauri")[];
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

/**
 * Slug → project root: the readable name a project has in a URL.
 *
 * A separate key rather than a field on `recentProjects`, and additively so:
 * the recents record is root → timestamp and has been written by older builds,
 * so widening its value would mean a migration for a mapping that is derived
 * anyway. This key can be absent, empty, or stale without costing anything —
 * a slug with no root behind it is a 404, which is the honest answer for a
 * bookmark to a project that has been removed.
 *
 * Keyed BY SLUG because that is the lookup the router makes on every
 * navigation; root → slug is the rarer direction and a scan is fine for it.
 */
const ProjectSlugs = Schema.Record(Schema.String, Schema.String);

export type ProjectSlugs = typeof ProjectSlugs.Type;

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
 * `at` is the other half of the answer, and the reason the clip alone was not
 * enough: a book opens WHOLE by default, so a reader who scrolled down to
 * Psalm 3 had a clip of `null` and came back to the top of the book. It is the
 * chapter ordinal at the TOP OF THE VIEWPORT, which the editor already
 * measures for the location bar, written as the reader scrolls. Optional
 * because a preferences file written by an older build has no such field, and
 * a location with no `at` still names the right book.
 *
 * Left out of `shellSettings` like `recentProjects`: there is no `kind` for a
 * record, and a settings form is not where you edit a history.
 */
const LastLocations = Schema.Record(
  Schema.String,
  Schema.Struct({
    bookId: Schema.String,
    chapter: Schema.NullOr(Schema.Number),
    at: Schema.optionalKey(Schema.Number),
    /**
     * The PLACE at the top of the viewport, as a reference: `\c`'s label and
     * the verse number, both as written.
     *
     * A reference and not an offset, which was the first attempt. An offset is
     * a remembered range over a document that keeps changing — the stale-range
     * bug this codebase is arranged to make impossible (`recipes/emptyBlocks.ts`
     * argues the same thing about ghosts). Come back after an edit and it
     * points at different words; come back after the verse was deleted and it
     * points inside its neighbour. A reference either resolves or honestly
     * does not.
     *
     * Both are strings because both are what the document SAYS. A chapter
     * ordinal is positional and a book that gained a `\toc` line renumbers
     * every one of them; "16" is still 16.
     */
    place: Schema.optionalKey(
      Schema.Struct({
        chapter: Schema.String,
        verse: Schema.optionalKey(Schema.String),
        /**
         * The exact offset, and the CONTENT HASH of the document it was taken
         * from — the engine's own `Analysis.sourceHash`, off the parse that
         * had already happened, so nothing is hashed for this.
         *
         * The hash is what makes the exact offset safe to use: same hash, same
         * document, so the offset means what it meant. A different hash means
         * the text moved while the reader was away — they may have been in
         * Find for exactly that purpose — and the offset is discarded in
         * favour of the coarse-but-true rungs beside it.
         *
         * A string because `sourceHash` is a `bigint` and JSON has no such
         * thing. It is compared, never arithmetic.
         */
        offset: Schema.optionalKey(Schema.Number),
        hash: Schema.optionalKey(Schema.String),
        /**
         * The document's length beside the hash, because the hash is not
         * always THERE.
         *
         * `Analysis` is attached to the state by the analyzer, and a freshly
         * created `EditorView` has not run it yet — which is why `supply()` in
         * `BookEditor` guards on `analysis !== null`. So at the one moment the
         * offset is wanted, the hash to check it against can be missing, and
         * the exact rung could never fire. Length always can.
         */
        length: Schema.optionalKey(Schema.Number),
      }),
    ),
  }),
);

export type LastLocations = typeof LastLocations.Type;

/** One project's remembered place. */
export type LastLocation = LastLocations[string];

/** The tokens the shell keeps after registering, by the name the code uses. */
export interface ShellKeys {
  readonly theme: SettingKey<string>;
  readonly startInUsfmMode: SettingKey<boolean>;
  /** Whether the settings route shows its advanced group. */
  readonly showAdvancedSettings: SettingKey<boolean>;
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
  readonly annotateEmptyParagraphs: SettingKey<boolean>;
  /** Enables the destructive multi-match action in Find. */
  readonly enableReplaceAll: SettingKey<boolean>;
  /**
   * The WACS endpoint, overriding the one this build was released with.
   *
   * Empty means "use the build's" — `src/app/endpoints.ts` resolves the two,
   * and is the only reader of either.
   */
  readonly wacsUrl: SettingKey<string>;
  /** The Language API, same rule. */
  readonly languageApiUrl: SettingKey<string>;
  /**
   * Mark the block the caret is in, and the block that answers it in every
   * reference beside it. Off by default: it paints on every block change, and
   * a reader who is drafting rather than matching shape does not want the page
   * moving under them.
   */
  readonly pairBlocks: SettingKey<boolean>;
  /**
   * Do reference panes follow the editor's place? On by default — a reference
   * that does not move is a reference you scroll twice — but it is per-pane at
   * the pane (`ReferencePane`'s header), and this is only the value a newly
   * opened one starts from.
   */
  readonly syncReferences: SettingKey<boolean>;
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
  /** Slug → project root, for `/project/<slug>`. See `ProjectSlugs`. */
  readonly projectSlugs: SettingKey<ProjectSlugs>;
  /** Project root → the book, the clip and the chapter the reader last had on screen. */
  readonly lastLocation: SettingKey<LastLocations>;
  /**
   * How wide the reference pane is on the book screen, as a FRACTION of the
   * editor row — the same unit and for the same reason as `sidebarWidth`: a
   * split conserves fractions, and a pixel width would have to be converted
   * against a root nothing has measured when the panel first renders.
   *
   * It is a preference and not session state because reading beside a source
   * is how a translator works all day: the width they settled on is a
   * decision about their screen, and re-making it on every navigation is the
   * kind of small tax that makes a pane not worth opening.
   *
   * Only obeyed while something is bound. With no reference the pane
   * collapses to the picker alone at a fixed narrow width, which is a layout
   * and not a preference — see `documentation/architecture/shell.md`.
   */
  readonly referenceWidth: SettingKey<number>;
}

/** The sidebar's share of the workspace row, and the range a drag may reach. */
export const SIDEBAR_WIDTH = { default: 0.2, min: 0.15, max: 0.36 } as const;

/** The reference pane's share of the editor row, and the range a drag may reach. */
export const REFERENCE_WIDTH = { default: 0.34, min: 0.18, max: 0.6 } as const;

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
    showAdvancedSettings: settings.register("shell.showAdvancedSettings", Schema.Boolean, false),
    backupIdleMs: settings.register(
      "shell.backupIdleMs",
      Schema.Number,
      DEFAULT_JOURNAL_POLICY.idleMs,
    ),
    preferChapterView: settings.register("editor.preferChapterView", Schema.Boolean, false),
    // On by default: the blocks this names are invisible without it, and the
    // first time most readers meet one is straight after Match Formatting —
    // where the empty blocks ARE the result, and a page of blank lines reads
    // as the button having done nothing.
    annotateEmptyParagraphs: settings.register(
      "editor.annotateEmptyParagraphs",
      Schema.Boolean,
      true,
    ),
    enableReplaceAll: settings.register("find.enableReplaceAll", Schema.Boolean, false),
    wacsUrl: settings.register("network.wacsUrl", Schema.String, ""),
    languageApiUrl: settings.register("network.languageApiUrl", Schema.String, ""),
    // Off by default, for the reason on the interface: it is a comparison
    // tool, and the comparison is not what most sessions are doing.
    pairBlocks: settings.register("editor.pairBlocks", Schema.Boolean, false),
    syncReferences: settings.register("editor.syncReferences", Schema.Boolean, true),
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
    projectSlugs: settings.register("shell.projectSlugs", ProjectSlugs, {}),
    lastLocation: settings.register("workspace.lastLocation", LastLocations, {}),
    referenceWidth: settings.register(
      "workspace.referenceWidth",
      Schema.Number,
      REFERENCE_WIDTH.default,
    ),
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
      key: keys.annotateEmptyParagraphs,
      label: "Name paragraphs that have no text",
      description:
        "A paragraph or poetry marker with nothing after it is invisible. Turn this on to show its name where the words would go — it is never written to the file.",
      kind: "boolean",
      group: "editor",
    },
    {
      key: keys.pairBlocks,
      label: "Show what a block corresponds to",
      description:
        "Marks the block you are in, and the block at the same place in every reference open beside it — so you can see which paragraph or poetry line answers which.",
      kind: "boolean",
      group: "editor",
    },
    {
      key: keys.syncReferences,
      label: "References follow the book you are reading",
      description:
        "Scrolling the book moves every reference beside it to the same place. Each pane can be unpinned on its own from its header; this is what a newly opened one starts as.",
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
    {
      key: keys.enableReplaceAll,
      label: "Enable Replace all",
      description: "Allow Find to replace every matching occurrence in one action.",
      kind: "boolean",
      group: "advanced",
    },
    {
      key: keys.wacsUrl,
      label: "WACS endpoint",
      description:
        "Where sign-in, the repository list and every transfer go. A Gitea instance, or the proxy in front of one — they answer on the same paths, so either works here. Empty uses this build's.",
      kind: "string",
      group: "network",
      hosts: ["web"],
    },
    {
      key: keys.languageApiUrl,
      label: "Language API",
      description:
        "Language names and directions, and the catalogue the Find Project screen lists. Empty uses this build's.",
      kind: "string",
      group: "network",
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
  {
    id: "network",
    title: "Network",
    subtitle: "Which hosts this build talks to. Changing one needs a reload.",
  },
  { id: "advanced", title: "Advanced", subtitle: "Timings and machinery." },
];
