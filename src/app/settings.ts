import { Schema } from "effect";

import { PRODUCERS, SEVERITIES } from "#core/findings/filter";
import type { SettingKey, SettingsService } from "#core/host/settings";
import { DEFAULT_JOURNAL_POLICY } from "#core/recovery/recovery";

import type { Message } from "./i18n";
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
  /** A dropdown instead of the segmented toggle, for a list that grows (languages). */
  readonly as?: "select";
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
  /** The person chose to work offline; Sefer reaches no server until they switch back. */
  readonly workOffline: SettingKey<boolean>;
  readonly pairBlocks: SettingKey<boolean>;
  /** Typed verse numbers ("1", "v1", "verse 1") become verses: the editor's verse shortcuts. */
  readonly verseShortcuts: SettingKey<boolean>;
  /** Spaces at a line's start that indent it a poetry level ("0" is never): the editor's `indentSpaces`. */
  readonly indentSpaces: SettingKey<string>;
  readonly syncReferences: SettingKey<boolean>;
  readonly findingsFilter: SettingKey<FindingsFilterPreference>;
  readonly sousSettings: SettingKey<SousOverrides>;
  readonly sidebarOpen: SettingKey<boolean>;
  /**
   * Refine's language panels split in two — the gateways beside the heart
   * language — or joined as one card of tabs.
   */
  readonly referenceSplit: SettingKey<boolean>;
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
  /** The projects page: the loaded projects' share of the row, beside the WACS table. */
  readonly projectsWidth: SettingKey<number>;
}

/** The sidebar's share of the workspace row, and the range a drag may reach. */
export const SIDEBAR_WIDTH = { default: 0.2, min: 0.15, max: 0.36 } as const;

/** The loaded projects' share of the projects page, and the range a drag may reach. */
export const PROJECTS_WIDTH = { default: 0.3, min: 0.22, max: 0.4 } as const;

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
    workOffline: settings.register("network.workOffline", Schema.Boolean, false),
    pairBlocks: settings.register("editor.pairBlocks", Schema.Boolean, false),
    verseShortcuts: settings.register("editor.verseShortcuts", Schema.Boolean, true),
    indentSpaces: settings.register("editor.indentSpaces", Schema.String, "4"),
    syncReferences: settings.register("editor.syncReferences", Schema.Boolean, true),
    findingsFilter: settings.register(
      "findings.filter",
      FindingsFilterPreference,
      FINDINGS_FILTER_DEFAULT,
    ),
    sousSettings: settings.register("sous.settings", SousOverrides, {}),
    sidebarOpen: settings.register("workspace.sidebarOpen", Schema.Boolean, true),
    referenceSplit: settings.register("workspace.referenceSplit", Schema.Boolean, false),
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
    projectsWidth: settings.register(
      "landing.projectsWidth",
      Schema.Number,
      PROJECTS_WIDTH.default,
    ),
  };
  registered.set(settings, keys);
  return keys;
};

const appearanceRows = (keys: ShellKeys): readonly AnyDescriptor[] => [
  {
    key: keys.locale,
    label: m.common_language(),
    description: m.settings_the_language_of_sefers_menus(),
    kind: "choice",
    as: "select",
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
    label: m.settings_display_mode(),
    description: m.settings_choose_the_theme_used_throughout(),
    kind: "choice",
    group: "appearance",
    options: [
      { value: "system", label: m.settings_system() },
      { value: "light", label: m.settings_light() },
      { value: "dark", label: m.settings_dark() },
    ],
  },
  {
    key: keys.fontSize,
    label: m.settings_interface_text_size(),
    description: m.settings_scales_every_size_in_the(),
    kind: "number",
    group: "appearance",
    min: 12,
    max: 24,
    step: 1,
    unit: "px",
  },
  {
    key: keys.zoom,
    label: m.settings_zoom(),
    description: m.settings_adjust_the_overall_application_zoom(),
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
    label: m.settings_change_colours(),
    description: m.settings_the_colours_review_draws_added(),
    kind: "choice",
    group: "appearance",
    options: [
      { value: "standard", label: m.settings_red_and_green() },
      { value: "blue-orange", label: m.settings_blue_and_orange() },
    ],
  },
  {
    key: keys.diffRemoved,
    label: m.settings_removed_words(),
    description: m.settings_how_a_removed_word_is(),
    kind: "choice",
    group: "appearance",
    options: [
      { value: "strike", label: m.settings_struck_through() },
      { value: "underline", label: m.settings_underlined() },
      { value: "none", label: m.settings_colour_only() },
    ],
    preview: "diff",
  },
];

const editorRows = (keys: ShellKeys): readonly AnyDescriptor[] => [
  {
    key: keys.editorFontSize,
    label: m.settings_scripture_text_size(),
    description: m.settings_how_large_the_book_itself(),
    kind: "number",
    group: "editor",
    min: EDITOR_FONT_SIZE_RANGE.min,
    max: EDITOR_FONT_SIZE_RANGE.max,
    step: 1,
    unit: "px",
  },
  {
    key: keys.excerptContext,
    label: m.settings_context_around_a_result(),
    description: m.settings_how_many_verses_or_headings(),
    kind: "number",
    group: "editor",
    min: 0,
    max: 10,
    step: 1,
  },
  {
    key: keys.reviewLayout,
    label: m.settings_review_layout(),
    description: m.settings_how_review_draws_a_difference(),
    kind: "choice",
    group: "editor",
    options: [
      { value: "auto", label: m.common_side_by_side_when_there() },
      { value: "split", label: m.common_side_by_side() },
      { value: "unified", label: m.settings_unified() },
    ],
  },
  {
    key: keys.reviewScope,
    label: m.settings_review_shows(),
    description: m.settings_each_change_as_a_card(),
    kind: "choice",
    group: "editor",
    options: [
      { value: "changes", label: m.common_changes() },
      { value: "book", label: m.settings_the_whole_book() },
    ],
  },
];

const editorBehaviourRows = (keys: ShellKeys): readonly AnyDescriptor[] => [
  {
    key: keys.startInUsfmMode,
    label: m.settings_editor_mode_default(),
    description: m.settings_open_books_in_usfm_mode(),
    kind: "boolean",
    group: "editor",
  },
  {
    key: keys.preferChapterView,
    label: m.settings_open_books_one_chapter_at(),
    description: m.settings_a_book_is_one_document(),
    kind: "boolean",
    group: "editor",
  },
  {
    key: keys.annotateEmptyParagraphs,
    label: m.settings_name_paragraphs_that_have_no(),
    description: m.settings_a_paragraph_or_poetry_marker(),
    kind: "boolean",
    group: "editor",
  },
  {
    key: keys.pairBlocks,
    label: m.settings_show_what_a_block_corresponds(),
    description: m.settings_marks_the_block_you_are(),
    kind: "boolean",
    group: "editor",
  },
  {
    key: keys.verseShortcuts,
    label: m.settings_verse_shortcuts(),
    description: m.settings_typing_1_1_v1_or(),
    kind: "boolean",
    group: "editor",
  },
  {
    key: keys.indentSpaces,
    label: m.settings_spaces_that_indent_a_line(),
    description: m.settings_in_refine_this_many_spaces(),
    kind: "choice",
    group: "editor",
    options: [
      { value: "0", label: m.settings_off() },
      { value: "2", label: "2" },
      { value: "4", label: "4" },
      { value: "8", label: "8" },
    ],
  },
  {
    key: keys.syncReferences,
    label: m.settings_references_follow_the_book_you(),
    description: m.settings_scrolling_the_book_moves_every(),
    kind: "boolean",
    group: "editor",
  },
];

const advancedRows = (keys: ShellKeys): readonly AnyDescriptor[] => [
  {
    key: keys.backupIdleMs,
    label: m.settings_back_up_work_after(),
    description: m.settings_how_long_typing_must_pause(),
    kind: "number",
    group: "advanced",
    min: 200,
    max: 10000,
    step: 100,
    unit: "ms",
  },
  {
    key: keys.offerRecovery,
    label: m.settings_offer_unsaved_work_on_open(),
    description: m.settings_ask_about_unsaved_work_found(),
    kind: "boolean",
    group: "advanced",
  },
  {
    key: keys.enableReplaceAll,
    label: m.settings_enable_replace_all(),
    description: m.settings_allow_find_to_replace_every(),
    kind: "boolean",
    group: "advanced",
  },
  {
    key: keys.showGatewayProjects,
    label: m.settings_show_gateway_languages_on_the(),
    description: m.settings_lists_the_gateway_languages_on(),
    kind: "boolean",
    group: "advanced",
  },
];

const networkRows = (keys: ShellKeys): readonly AnyDescriptor[] => [
  {
    key: keys.contentHost,
    label: m.settings_content_host(),
    description: m.settings_the_wacs_server_a_sign(),
    kind: "string",
    group: "network",
  },
  {
    key: keys.catalogueUrl,
    label: m.settings_catalogue(),
    description: m.settings_the_language_api_the_projects(),
    kind: "string",
    group: "network",
  },
  {
    key: keys.webTransport,
    label: m.settings_browser_transport(),
    description: m.settings_how_this_browser_reaches_each(),
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
  readonly title: Message;
  readonly subtitle: Message;
}[] = [
  {
    id: "appearance",
    title: m.settings_app_appearance,
    subtitle: m.settings_how_sefer_looks_on_this,
  },
  { id: "editor", title: m.settings_editor, subtitle: m.settings_what_a_book_does_when },
  {
    id: "network",
    title: m.settings_network,
    subtitle: m.settings_which_servers_this_build_talks,
  },
  { id: "advanced", title: m.common_advanced, subtitle: m.settings_timings_and_machinery },
];
