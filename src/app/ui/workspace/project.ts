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

import type { Project } from "#core/project/project";
import type { ProjectMetadata } from "#core/resources/projectMetadata";

import { languageLabel, projectDisplayName } from "../../language";
import { renamedName } from "../../projectNames";

export const metadataOf = (project: Project | undefined): ProjectMetadata | undefined =>
  project === undefined ? undefined : Option.getOrUndefined(project.metadata());

/**
 * The project's name: what it was called on this device (a rename, now or
 * before this open), else what the burrito calls it, else the folder's own
 * name.
 *
 * The device's name comes FIRST, and from the overlay, because the open
 * `Project` holds only the metadata it decoded when it was opened, and a
 * device-local name never touches that.
 */
export const projectName = (project: Project | undefined): string => {
  if (project === undefined) return "";
  const renamed = renamedName(project.root);
  if (renamed !== undefined) return renamed;
  const declared = projectDisplayName(metadataOf(project));
  if (declared !== "") return declared;
  const root = project.root.replace(/\/+$/, "");
  const segment = root.slice(root.lastIndexOf("/") + 1);
  return segment === "" ? project.root : segment;
};

/**
 * The language the project is IN — its first declared one (a diglot names
 * both, and the first is the one the identification is about), as a person
 * reads it: the NAME with the tag beside it, and the bare tag only when the
 * burrito gives no name. The same derivation the projects table uses
 * (`src/app/language.ts`), so the two surfaces cannot disagree.
 */
export const projectLanguage = (project: Project | undefined): string =>
  languageLabel(metadataOf(project));
