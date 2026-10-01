/**
 * The proofreading (Sous) settings: what Sefer stores, and what it hands the
 * engine.
 *
 *   stored   { doubled_separated: true, support_floor: 8 }
 *   engine   { placement: true, …, doubled_separated: true, support_floor: 8, … }
 *
 * Kitchen owns the settings — every key, its kind, default, range, group,
 * label and plain description (`SOUS_SETTINGS`) — so Sefer stores only what
 * the reader changed and fills the rest from kitchen's defaults. A key kitchen
 * drops is ignored, one it adds arrives at its default, and a stored value
 * that no longer fits its kind or range is ignored rather than sent.
 */

import { Schema } from "effect";

import {
  SOUS_SETTING_KEYS,
  SOUS_SETTINGS,
  type SousSettingGroup,
  type SousSettingKey,
  type SousSettingsValues,
} from "#core/galley";

/** The reader's changes from kitchen's defaults, by setting key. */
export const SousOverrides = Schema.Record(
  Schema.String,
  Schema.Union([Schema.Boolean, Schema.Number]),
);

export type SousOverrides = typeof SousOverrides.Type;

/** Does `value` fit the setting's kind and range? */
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

/** Every setting: the reader's value where it fits, kitchen's default elsewhere. */
export const sousValues = (overrides: SousOverrides): SousSettingsValues => {
  const values: Record<SousSettingKey, boolean | number> = { ...defaults };
  for (const key of SOUS_SETTING_KEYS) {
    const held = overrides[key];
    if (held !== undefined && fits(key, held)) values[key] = held;
  }
  // SAFETY: every key starts at its own default and is replaced only by a
  // value `fits` accepted for that key's kind, which is the type
  // `SousSettingsValues` gives it.
  return values as SousSettingsValues;
};

/** `overrides` with one setting changed; its default is stored as no change. */
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

/** The headings for kitchen's three groups, in display order. */
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
