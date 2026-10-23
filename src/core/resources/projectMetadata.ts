import type { LocalizedText } from "@sefer/text/localized";
import { Data, Result } from "effect";
import { parse as parseYaml } from "yaml";

import type { BurritoMetadata } from "./burrito";
import {
  fromBurritoRelationships,
  fromResourceContainerSource,
  type RelatedResource,
} from "./relationships";
import {
  decodeResourceContainerManifest,
  type ResourceContainerManifest,
} from "./resourceContainer";

export type TextDirection = "ltr" | "rtl";

export interface ProjectLanguageMetadata {
  readonly tag: string;
  readonly name: LocalizedText;
  readonly direction: TextDirection;
}

export interface ProjectMetadata {
  readonly container: "burrito" | "resourceContainer";
  readonly id: string | undefined;
  readonly name: LocalizedText;
  readonly language: ProjectLanguageMetadata;
  readonly defaultLocale: string | undefined;
  readonly bookNames: Readonly<Record<string, LocalizedText>>;
  readonly related: readonly RelatedResource[];
  readonly subject: string | undefined;
  readonly version: string | undefined;
  readonly declared: Declared;
}

export interface Declared {
  readonly type: string | undefined;
  readonly format: string | undefined;
}

const ONE = (locale: string | undefined, value: string): LocalizedText =>
  value === "" ? {} : { [locale === undefined || locale === "" ? "und" : locale]: value };

const primaryIdOf = (metadata: BurritoMetadata): string | undefined => {
  for (const ids of Object.values(metadata.identification.primary ?? {}))
    for (const id of Object.keys(ids)) return id;
  return undefined;
};

export const fromBurrito = (metadata: BurritoMetadata): ProjectMetadata => {
  const language = metadata.languages.at(0);
  const bookNames: Record<string, LocalizedText> = {};
  for (const [id, names] of Object.entries(metadata.localizedNames ?? {})) {
    bookNames[id] = names.short;
  }
  return {
    container: "burrito",
    id: primaryIdOf(metadata),
    name: metadata.identification.name,
    language: {
      tag: language?.tag ?? "",
      name: language?.name ?? {},
      direction: language?.scriptDirection ?? "ltr",
    },
    defaultLocale: metadata.meta.defaultLocale,
    bookNames,
    related: fromBurritoRelationships(metadata.relationships ?? []),
    subject: metadata.type.flavorType.flavor.name,
    version: undefined,
    declared: { type: undefined, format: undefined },
  };
};

const fromResourceContainer = (manifest: ResourceContainerManifest): ProjectMetadata => {
  const core = manifest.dublin_core;
  const locale = core.language.identifier;
  const bookNames: Record<string, LocalizedText> = {};
  for (const project of manifest.projects) {
    bookNames[project.identifier.toUpperCase()] = ONE(locale, project.title);
  }
  return {
    container: "resourceContainer",
    id: core.identifier === "" ? undefined : core.identifier,
    name: ONE(locale, core.title),
    language: {
      tag: locale,
      name: ONE(locale, core.language.title),
      direction: core.language.direction === "rtl" ? "rtl" : "ltr",
    },
    defaultLocale: locale === "" ? undefined : locale,
    bookNames,
    related: fromResourceContainerSource(core.source ?? []),
    subject: core.subject,
    version: core.version,
    declared: { type: core.type, format: core.format },
  };
};

class MetadataError extends Data.TaggedError("MetadataError")<{
  readonly reason: "Syntax" | "Shape";
  readonly description: string;
}> {}

export const readResourceContainer = (
  text: string,
): Result.Result<ProjectMetadata, MetadataError> =>
  Result.map(readResourceContainerManifest(text), fromResourceContainer);

export const readResourceContainerManifest = (
  text: string,
): Result.Result<ResourceContainerManifest, MetadataError> => {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (cause) {
    return Result.fail(new MetadataError({ reason: "Syntax", description: String(cause) }));
  }
  const decoded = decodeResourceContainerManifest(parsed);
  return Result.isFailure(decoded)
    ? Result.fail(new MetadataError({ reason: "Shape", description: decoded.failure.message }))
    : Result.succeed(decoded.success);
};
