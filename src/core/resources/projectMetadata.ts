/**
 * What Sefer knows about a project, whichever container it came in.
 *
 * A project on disk declares itself in one of two formats, and until now Sefer
 * could only read one of them:
 *
 *   metadata.json    Scripture Burrito       `burrito.ts`
 *   manifest.yaml    Resource Container      `resourceContainer.ts`
 *
 * `en_ulb` — the project most of this is tested against — is a Resource
 * Container, so its Language column was an em dash and its name was its folder.
 * Both decoders already existed and were already Effect schemas; what was
 * missing was the shape they decode INTO, so that nothing downstream has to ask
 * which kind it got.
 *
 * That is this module: one shape, two adapters, and the rule that the raw
 * container types never leave `src/core/resources`. A screen asking "what
 * language is this project in" should not have to know that one format spells
 * it `languages[0].name[locale]` and the other `dublin_core.language.title`.
 *
 * DELIBERATELY SMALL. This is what the APPLICATION needs, not the union of two
 * specifications. Burrito's ingredients and checksums stay in `checksum.ts`
 * where they are used, because they are a Burrito concept and a Resource
 * Container has no answer for them; `ProjectAdmin.updateMetadata` still writes
 * through the Burrito schema, because Sefer authors burritos and has no
 * business rewriting somebody's `manifest.yaml`. Reading is common; writing is
 * not.
 */

import { Data, Result } from "effect";
import { parse as parseYaml } from "yaml";

import { decodeBurritoMetadata, type BurritoMetadata } from "./burrito";
import {
  decodeResourceContainerManifest,
  type ResourceContainerManifest,
} from "./resourceContainer";

/** A human string keyed by locale, as both formats store their names. */
export type LocalizedText = Readonly<Record<string, string>>;

/**
 * Which way the project's TEXT runs.
 *
 * The project's, not the application's: a translator working in Arabic reads
 * Sefer's own chrome in whatever language they set, and their scripture in
 * theirs. Only the editor and the excerpt views honour this.
 */
export type TextDirection = "ltr" | "rtl";

export interface ProjectLanguageMetadata {
  /** BCP-47, or "" when the project declares no language at all. */
  readonly tag: string;
  /** The language's NAME by locale. Empty when it declares none. */
  readonly name: LocalizedText;
  /** `ltr` unless the project says otherwise — the honest default, not a guess. */
  readonly direction: TextDirection;
}

export interface ProjectMetadata {
  /** Which container this was read from, for a screen that needs to say so. */
  readonly container: "burrito" | "resourceContainer";
  /**
   * The project's own stable identity, when it claims one.
   *
   * Burrito states it as `identification.primary[authority][id]` and a
   * Resource Container as `dublin_core.identifier`; both mean "this is the
   * same project wherever you found it", which is what `ProjectId` needs so
   * that two checkouts of one project are one project. An RC project used to
   * have no identity at all here and fell back to its path.
   */
  readonly id: string | undefined;
  /** The project's own name, by locale. Empty when it declares none. */
  readonly name: LocalizedText;
  readonly language: ProjectLanguageMetadata;
  /** The locale the project itself prefers, when it names one. */
  readonly defaultLocale: string | undefined;
  /**
   * What this project calls its books, by book id then locale — Burrito's
   * `localizedNames`. A Resource Container's `projects[]` carry a `title` in
   * one language rather than a locale map, and that one is keyed under the
   * project's own default locale so both read the same way.
   */
  readonly bookNames: Readonly<Record<string, LocalizedText>>;
}

const ONE = (locale: string | undefined, value: string): LocalizedText =>
  value === "" ? {} : { [locale === undefined || locale === "" ? "und" : locale]: value };

/**
 * A burrito's primary id: the first `identification.primary[authority][id]`
 * key. Burritos in practice carry one authority and one id, so taking the
 * first is the simple reading.
 */
const primaryIdOf = (metadata: BurritoMetadata): string | undefined => {
  for (const ids of Object.values(metadata.identification.primary ?? {}))
    for (const id of Object.keys(ids)) return id;
  return undefined;
};

/** A Burrito, in the shape the application reads. */
export const fromBurrito = (metadata: BurritoMetadata): ProjectMetadata => {
  const language = metadata.languages.at(0);
  const bookNames: Record<string, LocalizedText> = {};
  for (const [id, names] of Object.entries(metadata.localizedNames ?? {})) {
    // `short` is the one every burrito carries and the one a crumb wants;
    // `long` is for a title bar and nothing asks for it yet.
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
  };
};

/**
 * A Resource Container, in the same shape.
 *
 * Dublin Core has no locale map — `title` is one string in one language, and
 * the language it is in is the one the manifest declares. So both names are
 * keyed under `dublin_core.language.identifier`, which makes `localized()` find
 * them for a reader in that language and fall through to "any name at all"
 * for everyone else. That is the correct answer and not a workaround: a
 * one-language name IS available in exactly one locale.
 */
export const fromResourceContainer = (manifest: ResourceContainerManifest): ProjectMetadata => {
  const core = manifest.dublin_core;
  const locale = core.language.identifier;
  const bookNames: Record<string, LocalizedText> = {};
  for (const project of manifest.projects) {
    // RC identifiers are lowercase (`gen`); every id Sefer holds is upper.
    bookNames[project.identifier.toUpperCase()] = ONE(locale, project.title);
  }
  return {
    container: "resourceContainer",
    id: core.identifier === "" ? undefined : core.identifier,
    name: ONE(locale, core.title),
    language: {
      tag: locale,
      name: ONE(locale, core.language.title),
      // RC states direction as a bare string, so anything that is not `rtl` is
      // read as `ltr` rather than trusted through.
      direction: core.language.direction === "rtl" ? "rtl" : "ltr",
    },
    defaultLocale: locale === "" ? undefined : locale,
    bookNames,
  };
};

export class MetadataError extends Data.TaggedError("MetadataError")<{
  /** `Syntax` — not JSON, or not YAML. `Shape` — parsed, but not the format. */
  readonly reason: "Syntax" | "Shape";
  readonly description: string;
}> {}

/** `metadata.json`'s bytes, decoded and narrowed. */
export const readBurrito = (text: string): Result.Result<ProjectMetadata, MetadataError> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return Result.fail(new MetadataError({ reason: "Syntax", description: String(cause) }));
  }
  const decoded = decodeBurritoMetadata(parsed);
  return Result.isFailure(decoded)
    ? Result.fail(new MetadataError({ reason: "Shape", description: decoded.failure.message }))
    : Result.succeed(fromBurrito(decoded.success));
};

/**
 * `manifest.yaml`'s bytes, decoded and narrowed.
 *
 * The YAML parser is a real one. Sefer classified a Resource Container by
 * regex before this — `/^dublin_core\s*:/m` over the first twenty lines — with
 * a comment saying the reader that needed the values would supply the parser.
 * This is that reader, and a regex cannot feed a schema.
 */
export const readResourceContainer = (
  text: string,
): Result.Result<ProjectMetadata, MetadataError> => {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (cause) {
    return Result.fail(new MetadataError({ reason: "Syntax", description: String(cause) }));
  }
  const decoded = decodeResourceContainerManifest(parsed);
  return Result.isFailure(decoded)
    ? Result.fail(new MetadataError({ reason: "Shape", description: decoded.failure.message }))
    : Result.succeed(fromResourceContainer(decoded.success));
};

/**
 * A localized string, in the first locale that has one.
 *
 * `preferred` is tried in order — the reader's locale, then the project's — and
 * a locale matches on its language subtag too, so a reader on `en-GB` still
 * gets the `en` name. The last resort is any value at all: "a name in some
 * language" beats "no name".
 */
export const localized = (
  values: LocalizedText | undefined,
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
