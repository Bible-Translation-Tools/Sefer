import { Schema } from "effect";

import { PRODUCERS, SEVERITIES } from "#core/findings/filter";
import type { SettingKey, SettingsService } from "#core/host/settings";
import { DEFAULT_JOURNAL_POLICY } from "#core/recovery/recovery";

import { automaticLocale, nativeName, shippedLocales } from "./locale";
import { m } from "./paraglide/messages";
import { SousOverrides } from "./sousSettings";
import { DEFAULT_EDITOR_FONT_SIZE, EDITOR_FONT_SIZE_RANGE } from "./ui/theme";

export type SettingGroup = "appearance" | "editor" | "network" | "advanced";

interface Described {
  readonly label: string;
  /** The sentence under the label. Optional: some rows need no explaining. */
  readonly description?: string;
  readonly group: SettingGroup;
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

export interface ChoiceSetting extends Described {
  readonly kind: "choice";
  readonly key: SettingKey<string>;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  /** A sample drawn under the row that shows the choice in force. */
  readonly preview?: "diff";
}

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

export type AnyDescriptor = BooleanSetting | StringSetting | NumberSetting | ChoiceSetting;

const RecentProjects = Schema.Record(Schema.String, Schema.String);

const ProjectSlugs = Schema.Record(Schema.String, Schema.String);

export type ProjectSlugs = typeof ProjectSlugs.Type;

export type RecentProjects = typeof RecentProjects.Type;

const LastLocations = Schema.Record(
  Schema.String,
  Schema.Struct({
    bookId: Schema.String,
    chapter: Schema.NullOr(Schema.Number),
    at: Schema.optionalKey(Schema.Number),
    place: Schema.optionalKey(
      Schema.Struct({
        chapter: Schema.String,
        verse: Schema.optionalKey(Schema.String),
        offset: Schema.optionalKey(Schema.Number),
        hash: Schema.optionalKey(Schema.String),
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
  /** The interface language: a locale tag, or "" for the browser's best match (`locale.ts`). */
  readonly locale: SettingKey<string>;
  /** The diff's hues: `standard` red and green, or `blue-orange` for red-green colour blindness. */
  readonly diffPalette: SettingKey<string>;
  /** What marks a removed word besides its colour: `strike`, `underline` or `none`. */
  readonly diffRemoved: SettingKey<string>;
  readonly startInUsfmMode: SettingKey<boolean>;
  /** Whether the settings route shows its advanced group. */
  readonly showAdvancedSettings: SettingKey<boolean>;
  readonly backupIdleMs: SettingKey<number>;
  readonly preferChapterView: SettingKey<boolean>;
  readonly lineByLine: SettingKey<boolean>;
  readonly annotateEmptyParagraphs: SettingKey<boolean>;
  /** Enables the destructive multi-match action in Find. */
  readonly enableReplaceAll: SettingKey<boolean>;
  readonly showGatewayProjects: SettingKey<boolean>;
  /** Ask about unsaved work found when a project opens. Backups are written either way. */
  readonly offerRecovery: SettingKey<boolean>;
  readonly excerptContext: SettingKey<number>;
  readonly reviewLayout: SettingKey<string>;
  readonly reviewScope: SettingKey<string>;
  readonly contentHost: SettingKey<string>;
  /** The catalogue, same rule. */
  readonly catalogueUrl: SettingKey<string>;
  /** The Web transport's `host=proxy` pairs, same rule. */
  readonly webTransport: SettingKey<string>;
  readonly pairBlocks: SettingKey<boolean>;
  readonly syncReferences: SettingKey<boolean>;
  readonly findingsFilter: SettingKey<FindingsFilterPreference>;
  readonly sousSettings: SettingKey<SousOverrides>;
  readonly sidebarOpen: SettingKey<boolean>;
  /** Is the reference column beside the editor open (the crumb strip's split toggle). */
  readonly referenceOpen: SettingKey<boolean>;
  readonly sidebarWidth: SettingKey<number>;
  readonly fontSize: SettingKey<number>;
  readonly zoom: SettingKey<number>;
  readonly editorFontSize: SettingKey<number>;
  /** Project root → ISO-8601 of the last open. See `RecentProjects`. */
  readonly recentProjects: SettingKey<RecentProjects>;
  /** Slug → project root, for `/project/<slug>`. See `ProjectSlugs`. */
  readonly projectSlugs: SettingKey<ProjectSlugs>;
  /** Project root → the book, the clip and the chapter the reader last had on screen. */
  readonly lastLocation: SettingKey<LastLocations>;
  readonly referenceWidth: SettingKey<number>;
}

/** The sidebar's share of the workspace row, and the range a drag may reach. */
export const SIDEBAR_WIDTH = { default: 0.2, min: 0.15, max: 0.36 } as const;

/** The reference pane's share of the editor row, and the range a drag may reach. */
export const REFERENCE_WIDTH = { default: 0.34, min: 0.18, max: 0.6 } as const;

const registered = new WeakMap<SettingsService, ShellKeys>();

export const shellKeys = (settings: SettingsService): ShellKeys => {
  const held = registered.get(settings);
  if (held !== undefined) return held;
  const keys: ShellKeys = {
    theme: settings.register("shell.theme", Schema.String, "system"),
    locale: settings.register("ui.locale", Schema.String, ""),
    diffPalette: settings.register("review.palette", Schema.String, "standard"),
    diffRemoved: settings.register("review.removedWords", Schema.String, "strike"),
    startInUsfmMode: settings.register("shell.startInUsfmMode", Schema.Boolean, false),
    showAdvancedSettings: settings.register("shell.showAdvancedSettings", Schema.Boolean, false),
    backupIdleMs: settings.register(
      "shell.backupIdleMs",
      Schema.Number,
      DEFAULT_JOURNAL_POLICY.idleMs,
    ),
    preferChapterView: settings.register("editor.preferChapterView", Schema.Boolean, false),
    lineByLine: settings.register("editor.lineByLine", Schema.Boolean, false),
    annotateEmptyParagraphs: settings.register(
      "editor.annotateEmptyParagraphs",
      Schema.Boolean,
      true,
    ),
    enableReplaceAll: settings.register("find.enableReplaceAll", Schema.Boolean, false),
    showGatewayProjects: settings.register("projects.showGateways", Schema.Boolean, false),
    offerRecovery: settings.register("recovery.offerOnOpen", Schema.Boolean, true),
    excerptContext: settings.register("excerpts.context", Schema.Number, 0),
    reviewLayout: settings.register("review.layout", Schema.String, "auto"),
    reviewScope: settings.register("review.scope", Schema.String, "changes"),
    contentHost: settings.register("network.contentHost", Schema.String, ""),
    catalogueUrl: settings.register("network.catalogueUrl", Schema.String, ""),
    webTransport: settings.register("network.webTransport", Schema.String, ""),
    pairBlocks: settings.register("editor.pairBlocks", Schema.Boolean, false),
    syncReferences: settings.register("editor.syncReferences", Schema.Boolean, true),
    findingsFilter: settings.register(
      "findings.filter",
      FindingsFilterPreference,
      FINDINGS_FILTER_DEFAULT,
    ),
    sousSettings: settings.register("sous.settings", SousOverrides, {}),
    sidebarOpen: settings.register("workspace.sidebarOpen", Schema.Boolean, true),
    referenceOpen: settings.register("workspace.referenceOpen", Schema.Boolean, true),
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

const appearanceRows = (keys: ShellKeys): readonly AnyDescriptor[] => [
  {
    key: keys.locale,
    label: "Language",
    description:
      "The language of Sefer's menus, buttons and messages. It does not change the text of your projects.",
    kind: "choice",
    group: "appearance",
    options: [
      {
        value: "",
        label: m.settings_language_automatic({ language: nativeName(automaticLocale()) }),
      },
      ...shippedLocales().map(({ tag, name }) => ({ value: tag, label: name })),
    ],
  },
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
];

const diffRows = (keys: ShellKeys): readonly AnyDescriptor[] => [
  {
    key: keys.diffPalette,
    label: "Change colours",
    description:
      "The colours Review draws added and removed words in. Blue and orange are for readers who find red and green hard to tell apart.",
    kind: "choice",
    group: "appearance",
    options: [
      { value: "standard", label: "Red and green" },
      { value: "blue-orange", label: "Blue and orange" },
    ],
  },
  {
    key: keys.diffRemoved,
    label: "Removed words",
    description: "How a removed word is marked besides its colour.",
    kind: "choice",
    group: "appearance",
    options: [
      { value: "strike", label: "Struck through" },
      { value: "underline", label: "Underlined" },
      { value: "none", label: "Colour only" },
    ],
    preview: "diff",
  },
];

const editorRows = (keys: ShellKeys): readonly AnyDescriptor[] => [
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
    key: keys.excerptContext,
    label: "Context around a result",
    description:
      "How many verses or headings a card in Find, Spiritual terms, Findings and Review shows either side of its own verse. Each card's arrows widen it from there.",
    kind: "number",
    group: "editor",
    min: 0,
    max: 10,
    step: 1,
  },
  {
    key: keys.reviewLayout,
    label: "Review layout",
    description:
      "How Review draws a difference: side by side, as one text with the other's words struck through, or side by side only when there is room.",
    kind: "choice",
    group: "editor",
    options: [
      { value: "auto", label: "Side by side when there is room" },
      { value: "split", label: "Side by side" },
      { value: "unified", label: "Unified" },
    ],
  },
  {
    key: keys.reviewScope,
    label: "Review shows",
    description:
      "Each change as a card with its context, across every book, or the whole book with its changes drawn in place.",
    kind: "choice",
    group: "editor",
    options: [
      { value: "changes", label: "Changes" },
      { value: "book", label: "The whole book" },
    ],
  },
];

const editorBehaviourRows = (keys: ShellKeys): readonly AnyDescriptor[] => [
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
];

const advancedRows = (keys: ShellKeys): readonly AnyDescriptor[] => [
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
    key: keys.offerRecovery,
    label: "Offer unsaved work on open",
    description:
      "Ask about unsaved work found when a project opens. Off, Sefer still backs up as you type; it only stops asking. Useful while developing with hot reload.",
    kind: "boolean",
    group: "advanced",
  },
  {
    key: keys.enableReplaceAll,
    label: "Enable Replace all",
    description: "Allow Find to replace every matching occurrence in one action.",
    kind: "boolean",
    group: "advanced",
  },
  {
    key: keys.showGatewayProjects,
    label: "Show gateway languages on the projects page",
    description:
      "Lists the gateway languages on the projects page too. A download from there goes to Source texts, never Your projects; to revise one, use Edit as your own project in Settings.",
    kind: "boolean",
    group: "advanced",
  },
];

const networkRows = (keys: ShellKeys): readonly AnyDescriptor[] => [
  {
    key: keys.contentHost,
    label: "Content host",
    description: "The WACS server a sign-in, the repository list and a publish go to.",
    kind: "string",
    group: "network",
  },
  {
    key: keys.catalogueUrl,
    label: "Catalogue",
    description:
      "The Language API the projects page lists from. Each project it lists carries its own address, so this can point at a different server from the content host.",
    kind: "string",
    group: "network",
  },
  {
    key: keys.webTransport,
    label: "Browser transport",
    description:
      "How this browser reaches each server, as host=proxy pairs separated by commas. Each proxy serves exactly one server, so a wrong pair breaks every transfer to it.",
    kind: "string",
    group: "network",
    hosts: ["web"],
  },
];

/** The shell's preferences as the settings form's rows, in display order. */
export const shellSettings = (settings: SettingsService): readonly AnyDescriptor[] => {
  const keys = shellKeys(settings);
  return [
    ...appearanceRows(keys),
    ...diffRows(keys),
    ...editorRows(keys),
    ...editorBehaviourRows(keys),
    ...advancedRows(keys),
    ...networkRows(keys),
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
    subtitle: "Which servers this build talks to. Changing one needs a reload.",
  },
  { id: "advanced", title: "Advanced", subtitle: "Timings and machinery." },
];
