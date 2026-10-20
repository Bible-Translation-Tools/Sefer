import { Schema } from "effect";

import {
  SOUS_SETTING_KEYS,
  SOUS_SETTINGS,
  type SousSettingGroup,
  type SousSettingKey,
  type SousSettingsValues,
} from "#core/galley";

export const SousOverrides = Schema.Record(
  Schema.String,
  Schema.Union([Schema.Boolean, Schema.Number]),
);

export type SousOverrides = typeof SousOverrides.Type;

export const fits = (key: SousSettingKey, value: boolean | number | undefined): boolean => {
  const spec = SOUS_SETTINGS[key];
  if (spec.kind === "switch") return typeof value === "boolean";
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (spec.kind !== "decimal" && !Number.isInteger(value)) return false;
  return (
    (spec.min === undefined || value >= spec.min) && (spec.max === undefined || value <= spec.max)
  );
};

// SAFETY: one entry per key, each holding that key's own default.
const defaults = Object.fromEntries(
  SOUS_SETTING_KEYS.map((key) => [key, SOUS_SETTINGS[key].default]),
) as Record<SousSettingKey, boolean | number>;

export const sousValues = (overrides: SousOverrides): SousSettingsValues => {
  const values: Record<SousSettingKey, boolean | number> = { ...defaults };
  for (const key of SOUS_SETTING_KEYS) {
    const held = overrides[key];
    if (held !== undefined && fits(key, held)) values[key] = held;
  }
  // SAFETY: every key starts at its own default and is replaced only by a value `fits` accepted for that key's kind, which is the type `SousSettingsValues` gives it.
  return values as SousSettingsValues;
};

export const withSetting = (
  overrides: SousOverrides,
  key: SousSettingKey,
  value: boolean | number | undefined,
): SousOverrides => {
  const { [key]: _dropped, ...rest } = overrides;
  return value === undefined || value === SOUS_SETTINGS[key].default
    ? rest
    : { ...rest, [key]: value };
};

const CHECK_SWITCHES: Readonly<Record<string, SousSettingKey>> = {
  "sous.convention.Placement": "placement",
  "sous.convention.RunShape": "run_shape",
  "sous.convention.ExactNeighbor": "exact_neighbor",
  "sous.convention.PooledNeighbor": "pooled_neighbor",
  "sous.convention.Rarity": "rarity",
  "sous.convention.Casing": "casing",
  "sous.convention.WordLength": "word_length",
  "sous.convention.Doubled": "doubled",
  "sous.convention.LetterRun": "letter_runs",
  "sous.convention.SentenceStart": "sentence_start",
  "sous.convention.BookRate": "book_rate",
  "sous.source-copy": "source_copy",
  "sous.length-proportionality": "lengths_enabled",
};

export const checkSwitchOf = (code: string): SousSettingKey | undefined =>
  CHECK_SWITCHES[code] ?? (code.startsWith("sous.presence.") ? "presence" : undefined);

export const SOUS_GROUPS = {
  rules: {
    title: "Checks",
    subtitle: "Which kinds of difference to look for.",
  },
  thresholds: {
    title: "Thresholds",
    subtitle: "How often something must happen before a difference from it counts.",
  },
  reference: {
    title: "Against a source text",
    subtitle: "Checks that compare each book with a source bound to the project.",
  },
} as const satisfies Record<
  SousSettingGroup,
  { readonly title: string; readonly subtitle: string }
>;
