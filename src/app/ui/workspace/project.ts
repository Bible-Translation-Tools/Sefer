import { Option } from "effect";

import type { Project } from "#core/project/project";
import type { ProjectMetadata } from "#core/resources/projectMetadata";

import { languageLabel, projectDisplayName } from "../../language";
import { renamedName } from "../../projectNames";

export const metadataOf = (project: Project | undefined): ProjectMetadata | undefined =>
  project === undefined ? undefined : Option.getOrUndefined(project.metadata());

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

export const projectLanguage = (project: Project | undefined): string =>
  languageLabel(metadataOf(project));
