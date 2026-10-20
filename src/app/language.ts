import { localized } from "@sefer/text/localized";

import type { ProjectMetadata } from "#core/resources/projectMetadata";

export const languageTag = (metadata: ProjectMetadata | undefined): string =>
  metadata?.language.tag ?? "";

export const textDirection = (metadata: ProjectMetadata | undefined): "ltr" | "rtl" =>
  metadata?.language.direction ?? "ltr";

export const languageName = (
  metadata: ProjectMetadata | undefined,
  displayLocale?: string | undefined,
): string => localized(metadata?.language.name, [displayLocale, metadata?.defaultLocale]);

export const languageLabel = (
  metadata: ProjectMetadata | undefined,
  displayLocale?: string | undefined,
): string => {
  const tag = languageTag(metadata);
  if (tag === "") return "";
  const name = languageName(metadata, displayLocale);
  return name === "" || name === tag ? tag : `${name} (${tag})`;
};

export const projectDisplayName = (
  metadata: ProjectMetadata | undefined,
  displayLocale?: string | undefined,
): string => localized(metadata?.name, [displayLocale, metadata?.defaultLocale]);
