/**
 * What a project's language is CALLED, derived in one place.
 *
 * Two screens ask the same question — the Language column of the projects
 * table and the line under the project name in the sidebar — and they were
 * answering it two different ways: one printed `name (tag)`, the other printed
 * the bare tag.
 *
 * The rule, once:
 *
 *   * the NAME wins, read in the reader's own locale first, then the
 *     project's declared default, then any locale the record carries — "a name
 *     in some language" beats "no name at all";
 *   * the TAG is the fallback, and only the fallback. A BCP-47 tag is an
 *     identifier, not a language name, and a column headed "Language" that
 *     shows `en` has told the reader nothing they did not already know;
 *   * the FOLDER NAME is never an answer. A project with no declared language
 *     has no language to show, and printing its directory in that column is
 *     the bug this module exists to stop.
 *
 * Every function here takes `ProjectMetadata`, which is the same shape whether
 * the project declared itself in a Scripture Burrito or a Resource Container
 * (`core/resources/projectMetadata.ts`). It used to take a burrito, which is
 * why `en_ulb` — a Resource Container — showed an em dash.
 */

import type { ProjectMetadata } from "../core/resources/projectMetadata";
import { localized } from "../core/resources/projectMetadata";

/** The project's declared language tag, or "" when it declares none. */
export const languageTag = (metadata: ProjectMetadata | undefined): string =>
  metadata?.language.tag ?? "";

/**
 * Which way the project's TEXT runs — `ltr` unless it says otherwise.
 *
 * The project's text, NOT the application's chrome: a translator working in
 * Arabic reads Sefer's own menus in whatever interface language they chose and
 * their scripture right-to-left. The two are separate settings and this is
 * only the first one.
 */
export const textDirection = (metadata: ProjectMetadata | undefined): "ltr" | "rtl" =>
  metadata?.language.direction ?? "ltr";

/**
 * The language's NAME, in the display locale where the project has one.
 * Empty when the project declares no language at all — the caller decides
 * what an absent language looks like, and it is never a folder name.
 */
export const languageName = (
  metadata: ProjectMetadata | undefined,
  displayLocale?: string | undefined,
): string => localized(metadata?.language.name, [displayLocale, metadata?.defaultLocale]);

/**
 * The one line both surfaces print: the name, with the tag beside it when the
 * two are different, and the bare tag when there is no name.
 */
export const languageLabel = (
  metadata: ProjectMetadata | undefined,
  displayLocale?: string | undefined,
): string => {
  const tag = languageTag(metadata);
  if (tag === "") return "";
  const name = languageName(metadata, displayLocale);
  return name === "" || name === tag ? tag : `${name} (${tag})`;
};

/** The project's own name, in the display locale; empty when it declares none. */
export const projectDisplayName = (
  metadata: ProjectMetadata | undefined,
  displayLocale?: string | undefined,
): string => localized(metadata?.name, [displayLocale, metadata?.defaultLocale]);
