import { Schema } from "effect";

import { m } from "#app/paraglide/messages";
import {
  SOUS_SETTING_KEYS,
  SOUS_SETTINGS,
  type SousSettingGroup,
  type SousSettingKey,
  type SousSettingsValues,
} from "#core/galley";

import type { Message } from "./i18n";

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
    title: m.sous_checks,
    subtitle: m.sous_which_kinds_of_difference_to,
  },
  thresholds: {
    title: m.sous_thresholds,
    subtitle: m.sous_how_often_something_must_happen,
  },
  reference: {
    title: m.sous_against_a_source_text,
    subtitle: m.sous_checks_that_compare_each_book,
  },
} as const satisfies Record<
  SousSettingGroup,
  { readonly title: Message; readonly subtitle: Message }
>;

/** Sefer's words for each setting; kitchen's `label` and `description` are the English these came from. */
export const SOUS_SETTING_WORDS: Readonly<
  Record<SousSettingKey, { readonly label: Message; readonly description: Message }>
> = {
  placement: { label: m.sous_setting_placement, description: m.sous_setting_placement_description },
  run_shape: { label: m.sous_setting_run_shape, description: m.sous_setting_run_shape_description },
  exact_neighbor: {
    label: m.sous_setting_exact_neighbor,
    description: m.sous_setting_exact_neighbor_description,
  },
  pooled_neighbor: {
    label: m.sous_setting_pooled_neighbor,
    description: m.sous_setting_pooled_neighbor_description,
  },
  rarity: { label: m.sous_setting_rarity, description: m.sous_setting_rarity_description },
  casing: { label: m.sous_setting_casing, description: m.sous_setting_casing_description },
  terminal_upper_share_bp: {
    label: m.sous_setting_terminal_upper_share_bp,
    description: m.sous_setting_terminal_upper_share_bp_description,
  },
  terminal_lower_share_bp: {
    label: m.sous_setting_terminal_lower_share_bp,
    description: m.sous_setting_terminal_lower_share_bp_description,
  },
  sentence_start: {
    label: m.sous_setting_sentence_start,
    description: m.sous_setting_sentence_start_description,
  },
  sentence_start_upper_bp: {
    label: m.sous_setting_sentence_start_upper_bp,
    description: m.sous_setting_sentence_start_upper_bp_description,
  },
  word_length: {
    label: m.sous_setting_word_length,
    description: m.sous_setting_word_length_description,
  },
  word_length_sigma: {
    label: m.sous_setting_word_length_sigma,
    description: m.sous_setting_word_length_sigma_description,
  },
  doubled: { label: m.sous_setting_doubled, description: m.sous_setting_doubled_description },
  doubled_bare: {
    label: m.sous_setting_doubled_bare,
    description: m.sous_setting_doubled_bare_description,
  },
  doubled_separated: {
    label: m.sous_setting_doubled_separated,
    description: m.sous_setting_doubled_separated_description,
  },
  doubles_productive_bp: {
    label: m.sous_setting_doubles_productive_bp,
    description: m.sous_setting_doubles_productive_bp_description,
  },
  letter_runs: {
    label: m.sous_setting_letter_runs,
    description: m.sous_setting_letter_runs_description,
  },
  book_rate: { label: m.sous_setting_book_rate, description: m.sous_setting_book_rate_description },
  book_rate_ratio: {
    label: m.sous_setting_book_rate_ratio,
    description: m.sous_setting_book_rate_ratio_description,
  },
  book_rate_min_bp: {
    label: m.sous_setting_book_rate_min_bp,
    description: m.sous_setting_book_rate_min_bp_description,
  },
  book_rate_min_uses: {
    label: m.sous_setting_book_rate_min_uses,
    description: m.sous_setting_book_rate_min_uses_description,
  },
  lengths_enabled: {
    label: m.sous_setting_lengths_enabled,
    description: m.sous_setting_lengths_enabled_description,
  },
  z_long: { label: m.sous_setting_z_long, description: m.sous_setting_z_long_description },
  z_short: { label: m.sous_setting_z_short, description: m.sous_setting_z_short_description },
  min_verses: {
    label: m.sous_setting_min_verses,
    description: m.sous_setting_min_verses_description,
  },
  presence: { label: m.sous_setting_presence, description: m.sous_setting_presence_description },
  source_copy: {
    label: m.sous_setting_source_copy,
    description: m.sous_setting_source_copy_description,
  },
  source_copy_min_run: {
    label: m.sous_setting_source_copy_min_run,
    description: m.sous_setting_source_copy_min_run_description,
  },
  support_floor: {
    label: m.sous_setting_support_floor,
    description: m.sous_setting_support_floor_description,
  },
  word_support_floor: {
    label: m.sous_setting_word_support_floor,
    description: m.sous_setting_word_support_floor_description,
  },
};
