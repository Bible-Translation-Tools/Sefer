/**
 * The four sync settings, per project, how this device works on the project
 * (`CollabMode`), and this device's author name.
 *
 * Two of the four reach the network — checking on open and sending after a
 * save — and they are ON by default, so an ordinary translator never has to
 * learn the words fetch and push. The other two are tolerances, off by
 * default: skipping Review of one's own changes, and receiving incoming
 * changes without Review when the policy lets every book through.
 *
 * They are stored on this device, keyed by project root, and never in the
 * repository: whether this laptop checks on open is not a fact about the
 * translation. Registered here rather than in `settings.ts`, the way
 * `sousSettings.ts` keeps its own shape, and read by Settings' Cloud section, the project
 * open, and Record a version.
 */
import { Schema } from "effect";

import type { SettingKey, SettingsService } from "#core/host/settings";

export interface SyncPreferences {
  /** When the project opens, ask the shared project what changed. */
  readonly checkOnOpen: boolean;
  /** When a version is recorded, send it — only when this device is ahead. */
  readonly sendOnSave: boolean;
  /** Record a version without opening Review first. */
  readonly skipReviewMine: boolean;
  /** Receive incoming changes without Review, when no book needs a person. */
  readonly skipReviewIncoming: boolean;
}

const SYNC_DEFAULTS: SyncPreferences = {
  checkOnOpen: true,
  sendOnSave: true,
  skipReviewMine: false,
  skipReviewIncoming: false,
};

/** Only what the reader changed from the defaults, per project root. */
const SyncByProject = Schema.Record(
  Schema.String,
  Schema.Struct({
    checkOnOpen: Schema.optionalKey(Schema.Boolean),
    sendOnSave: Schema.optionalKey(Schema.Boolean),
    skipReviewMine: Schema.optionalKey(Schema.Boolean),
    skipReviewIncoming: Schema.optionalKey(Schema.Boolean),
    works: Schema.optionalKey(Schema.Literals(["shared", "copy"])),
  }),
);

type SyncByProject = typeof SyncByProject.Type;

interface SyncKeys {
  readonly byProject: SettingKey<SyncByProject>;
  /**
   * The name a commit made on this device carries when nobody is signed in,
   * asked for once, the first time a version is recorded. Empty until then.
   */
  readonly authorName: SettingKey<string>;
}

const registered = new WeakMap<SettingsService, SyncKeys>();

const syncKeys = (settings: SettingsService): SyncKeys => {
  const held = registered.get(settings);
  if (held !== undefined) return held;
  const keys: SyncKeys = {
    byProject: settings.register("sync.projects", SyncByProject, {}),
    authorName: settings.register("identity.name", Schema.String, ""),
  };
  registered.set(settings, keys);
  return keys;
};

/** The project's sync settings: its own choices over the defaults. */
export const syncPreferences = (settings: SettingsService, root: string): SyncPreferences => ({
  ...SYNC_DEFAULTS,
  ...settings.get(syncKeys(settings).byProject)[root],
});

/** Changes one of a project's sync settings; a default is stored as no change. */
export const setSyncPreference = (
  settings: SettingsService,
  root: string,
  key: keyof SyncPreferences,
  value: boolean,
) => {
  const keys = syncKeys(settings);
  const all = settings.get(keys.byProject);
  const { [key]: _dropped, ...rest } = all[root] ?? {};
  const mine = value === SYNC_DEFAULTS[key] ? rest : { ...rest, [key]: value };
  return settings.set(keys.byProject, { ...all, [root]: mine });
};

/**
 * How this device works on a project with other people: in the ONE shared
 * project, or in the person's own copy of it, offering changes when ready.
 * Two modes and no more, so nobody picks a remote per press (see
 * documentation/architecture/sync.md, "Two ways to work").
 */
export type CollabMode = "shared" | "copy";

/** The mode chosen on this device, or `undefined` when nobody chose one. */
export const chosenMode = (settings: SettingsService, root: string): CollabMode | undefined =>
  settings.get(syncKeys(settings).byProject)[root]?.works;

export const setChosenMode = (settings: SettingsService, root: string, mode: CollabMode) => {
  const keys = syncKeys(settings);
  const all = settings.get(keys.byProject);
  return settings.set(keys.byProject, { ...all, [root]: { ...all[root], works: mode } });
};

/** The author name this device records, or `""` when none was given yet. */
export const authorName = (settings: SettingsService): string =>
  settings.get(syncKeys(settings).authorName).trim();

export const setAuthorName = (settings: SettingsService, name: string) =>
  settings.set(syncKeys(settings).authorName, name.trim());
