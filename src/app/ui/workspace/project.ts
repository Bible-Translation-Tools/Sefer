/**
 * What the workspace chrome needs to know about the open project, read once
 * and in one place: what to call it, what language it is in, and the paths of
 * its routes.
 *
 * All of it comes from the burrito the project already decoded
 * (`Project.metadata()`), with honest fallbacks — a folder of USFM files with
 * no `metadata.json` is a perfectly ordinary project, and the last segment of
 * its root is what a person calls it.
 */

import { Option } from "effect";

import type { Project } from "../../../core/project/project";
import type { BurritoMetadata } from "../../../core/resources/burrito";

export const metadataOf = (project: Project | undefined): BurritoMetadata | undefined =>
  project === undefined ? undefined : Option.getOrUndefined(project.metadata());

/** The first localized string in a burrito's `{ locale: text }` record. */
const anyLocale = (text: Readonly<Record<string, string>> | undefined): string | undefined => {
  if (text === undefined) return undefined;
  for (const value of Object.values(text)) if (value !== "") return value;
  return undefined;
};

/** The project's name: what the burrito calls it, else the folder's own name. */
export const projectName = (project: Project | undefined): string => {
  if (project === undefined) return "";
  const declared = anyLocale(metadataOf(project)?.identification.name);
  if (declared !== undefined) return declared;
  const root = project.root.replace(/\/+$/, "");
  const segment = root.slice(root.lastIndexOf("/") + 1);
  return segment === "" ? project.root : segment;
};

/**
 * The language tag the project is IN — its first declared language. A burrito
 * may list several (a diglot names both), and the first is the one the
 * identification is about.
 */
export const projectLanguage = (project: Project | undefined): string =>
  metadataOf(project)?.languages[0]?.tag ?? "";

/** The route of one project. */
export const projectPath = (root: string): string => `/project/${encodeURIComponent(root)}`;

/** The route of one book in one project, with both segments encoded once. */
export const bookPath = (root: string, bookId: string): string =>
  `/project/${encodeURIComponent(root)}/book/${encodeURIComponent(bookId)}`;
