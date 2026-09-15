/**
 * What a project's language is CALLED, derived in one place.
 *
 * Scripture Burrito stores every human-readable string under a locale key, so
 * `languages[0].name` is a record and not a string. Two screens ask the same
 * question about it — the Language column of the projects table and the line
 * under the project name in the sidebar — and they were answering it two
 * different ways: one printed `name (tag)`, the other printed the bare tag.
 *
 * The rule, once:
 *
 *   * the NAME wins, read in the reader's own locale first, then the
 *     project's declared `meta.defaultLocale`, then any locale the record
 *     carries — "a name in some language" beats "no name at all";
 *   * the TAG is the fallback, and only the fallback. A BCP-47 tag is an
 *     identifier, not a language name, and a column headed "Language" that
 *     shows `en` has told the reader nothing they did not already know;
 *   * the FOLDER NAME is never an answer. A project with no declared language
 *     has no language to show, and printing its directory in that column is
 *     the bug this module exists to stop.
 */

import type { BurritoMetadata } from "../core/resources/burrito";

/**
 * A localized Burrito string, in the first locale that has one.
 *
 * `preferred` is tried in order — the reader's locale, then the project's —
 * and a locale is matched on its language subtag too, so a reader on `en-GB`
 * still gets the `en` name.
 */
export const localized = (
  values: Readonly<Record<string, string>> | undefined,
  preferred: readonly (string | undefined)[],
): string => {
  if (values === undefined) return "";
  for (const locale of preferred) {
    if (locale === undefined || locale === "") continue;
    const exact = values[locale];
    if (exact !== undefined && exact !== "") return exact;
    const base = locale.split("-")[0] ?? "";
    const loose = base === "" ? undefined : values[base];
    if (loose !== undefined && loose !== "") return loose;
  }
  for (const value of Object.values(values)) if (value !== "") return value;
  return "";
};

/** The project's first declared language tag, or "" when it declares none. */
export const languageTag = (metadata: BurritoMetadata | undefined): string =>
  metadata?.languages.at(0)?.tag ?? "";

/**
 * The language's NAME, in the display locale where the burrito has one.
 * Empty when the project declares no language at all — the caller decides
 * what an absent language looks like, and it is never a folder name.
 */
export const languageName = (
  metadata: BurritoMetadata | undefined,
  displayLocale?: string | undefined,
): string => {
  const language = metadata?.languages.at(0);
  if (language === undefined) return "";
  return localized(language.name, [displayLocale, metadata?.meta.defaultLocale]);
};

/**
 * The one line both surfaces print: the name, with the tag beside it when the
 * two are different, and the bare tag when there is no name.
 */
export const languageLabel = (
  metadata: BurritoMetadata | undefined,
  displayLocale?: string | undefined,
): string => {
  const tag = languageTag(metadata);
  if (tag === "") return "";
  const name = languageName(metadata, displayLocale);
  return name === "" || name === tag ? tag : `${name} (${tag})`;
};

/** The project's own name, in the display locale; empty when it declares none. */
export const projectDisplayName = (
  metadata: BurritoMetadata | undefined,
  displayLocale?: string | undefined,
): string =>
  localized(metadata?.identification.name, [displayLocale, metadata?.meta.defaultLocale]);
