import { Schema } from "effect";

import type { SettingKey, SettingsService } from "#core/host/settings";

export interface SyncPreferences {
  readonly checkOnOpen: boolean;
  readonly sendOnSave: boolean;
  readonly skipReviewMine: boolean;
  readonly skipReviewIncoming: boolean;
}

const SYNC_DEFAULTS: SyncPreferences = {
  checkOnOpen: true,
  sendOnSave: true,
  skipReviewMine: false,
  skipReviewIncoming: false,
};

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

export const syncPreferences = (settings: SettingsService, root: string): SyncPreferences => ({
  ...SYNC_DEFAULTS,
  ...settings.get(syncKeys(settings).byProject)[root],
});

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

export type CollabMode = "shared" | "copy";

export const chosenMode = (settings: SettingsService, root: string): CollabMode | undefined =>
  settings.get(syncKeys(settings).byProject)[root]?.works;

export const setChosenMode = (settings: SettingsService, root: string, mode: CollabMode) => {
  const keys = syncKeys(settings);
  const all = settings.get(keys.byProject);
  return settings.set(keys.byProject, { ...all, [root]: { ...all[root], works: mode } });
};

export const authorName = (settings: SettingsService): string =>
  settings.get(syncKeys(settings).authorName).trim();

export const setAuthorName = (settings: SettingsService, name: string) =>
  settings.set(syncKeys(settings).authorName, name.trim());
