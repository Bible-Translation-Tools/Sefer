/**
 * The source texts a project declares, whichever format declared them.
 *
 * Three places say "this project was translated from that text":
 *
 *   Burrito             `relationships[]` with `relationType: "source"`
 *   Resource Container  `dublin_core.source[]`
 *   BTT Writer          `manifest.json` `source_translations[]`
 *
 * All three read into one `RelatedResource`: a language, a resource and the
 * version the project listed. None of them names a repository; the WA-Catalog
 * convention (`<host>/WA-Catalog/<language>_<resource>`) is what turns one into
 * a URL, here and nowhere else.
 *
 * Named for the Burrito field, not "source": in Sefer a Source is the editable
 * text of one Book (the glossary). The text a project translates from is a
 * Paired resource, and only the formats' own literals say "source".
 *
 * Pure. Reading the files is `discovery.ts`'s job, and cloning is the app's.
 */

/** The authority Sefer writes, as Tech_Advance/leb-x-bisa_reg declares it. */
export const SOURCE_AUTHORITY = {
  key: "wycliffeassociates",
  id: "https://www.wycliffeassociates.org",
  name: { en: "Wycliffe Associates" },
} as const;

export interface RelatedResource {
  /** The only relation acted on; the others are kept in the files as written. */
  readonly relation: "source";
  /** BCP-47 tag, lowercased: `en`, `pt-br`. */
  readonly language: string;
  /** The resource identifier, lowercased: `ulb`, `reg`. */
  readonly resource: string;
  /**
   * The version the project LISTED ("24-02"), as written. Burrito's
   * `revision` holds the same thing: a listed version, not a commit (Will,
   * 2026-10-06). Absent when the project listed none.
   */
  readonly version?: string;
}

/** One `relationships[]` entry, as much of it as is read. */
export interface BurritoRelationship {
  readonly relationType: string;
  readonly id: string;
  readonly revision?: string | undefined;
}

/** One `dublin_core.source[]` entry. */
export interface ResourceContainerSource {
  readonly identifier: string;
  readonly language?: string | undefined;
  readonly version?: string | undefined;
}

/** One `source_translations[]` entry from a BTT Writer `manifest.json`. */
export interface WriterSourceTranslation {
  readonly language_id: string;
  readonly resource_id: string;
  readonly version?: string | undefined;
}

const related = (
  language: string,
  resource: string,
  version: string | undefined,
): RelatedResource | undefined => {
  const lang = language.trim().toLowerCase();
  const res = resource.trim().toLowerCase();
  if (lang === "" || res === "") return undefined;
  const listed = version?.trim();
  return {
    relation: "source",
    language: lang,
    resource: res,
    ...(listed === undefined || listed === "" ? {} : { version: listed }),
  };
};

const present = <A>(value: A | undefined): value is A => value !== undefined;

/**
 * `wycliffeassociates::en/ulb` → `en`, `ulb`. An id in any other shape is not
 * acted on: it names something this resolver cannot find, and guessing would
 * fetch the wrong text.
 */
export const fromBurritoRelationships = (
  relationships: readonly BurritoRelationship[],
): readonly RelatedResource[] =>
  relationships
    .filter((entry) => entry.relationType === "source")
    .map((entry) => {
      const match = /^[^:]+::([^/\s]+)\/([^/\s]+)$/.exec(entry.id);
      return match === null ? undefined : related(match[1] ?? "", match[2] ?? "", entry.revision);
    })
    .filter(present);

export const fromResourceContainerSource = (
  sources: readonly ResourceContainerSource[],
): readonly RelatedResource[] =>
  sources
    .map((entry) => related(entry.language ?? "", entry.identifier, entry.version))
    .filter(present);

export const fromWriterSourceTranslations = (
  translations: readonly WriterSourceTranslation[],
): readonly RelatedResource[] =>
  translations
    .map((entry) => related(entry.language_id, entry.resource_id, entry.version))
    .filter(present);

/** `v24-07`, `V24-07` and `24-07` are one version. */
const bare = (version: string): string => version.replace(/^v/i, "").toLowerCase();

/** Numeric parts first, so `24-02` > `21-05` and `12` > `9`. */
const compareVersions = (a: string, b: string): number => {
  const parts = (value: string): readonly number[] =>
    bare(value)
      .split(/[^0-9]+/)
      .filter((part) => part !== "")
      .map(Number);
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? -1) - (right[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
};

export const sameVersion = (a: string, b: string): boolean => bare(a) === bare(b);

/**
 * One reference per (language, resource), at the highest version listed.
 *
 * A project that lists ULB 24-02 AND 21-05 gets one copy of ULB, not two: the
 * other listed versions are history, and stay in the files as written (Step 1
 * settled, 2026-10-02). First-seen order is kept, so the project's own order of
 * sources is the order the reference picker shows them.
 */
export const highestVersions = (refs: readonly RelatedResource[]): readonly RelatedResource[] => {
  const kept = new Map<string, RelatedResource>();
  for (const ref of refs) {
    const key = `${ref.language}/${ref.resource}`;
    const held = kept.get(key);
    if (
      held === undefined ||
      (ref.version !== undefined &&
        (held.version === undefined || compareVersions(ref.version, held.version) > 0))
    )
      kept.set(key, ref);
  }
  return [...kept.values()];
};

/** Where the WA-Catalog convention keeps a resource on `host`. */
export const catalogueUrl = (host: string, ref: RelatedResource): string =>
  `${host.replace(/\/+$/, "")}/WA-Catalog/${ref.language}_${ref.resource}`;

/**
 * A repository URL in the one form two URLs are compared in: host and path
 * case-folded (Gitea answers `wa-catalog` and `WA-Catalog` alike), no `.git`,
 * no trailing slash, no credentials.
 */
export const normaliseRepoUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "").replace(/\.git$/i, "");
    return `${parsed.protocol}//${parsed.host}${path}`.toLowerCase();
  } catch {
    return url
      .trim()
      .replace(/\/+$/, "")
      .replace(/\.git$/i, "")
      .toLowerCase();
  }
};

/**
 * How the copy on this device stands against what the project listed.
 * `listed`: the copy declares that version. `newest`: it declares another (or
 * none), and the note says so where the person reads it.
 */
export type VersionMatch = "listed" | "newest";

export interface RelatedTextResolution {
  readonly ref: RelatedResource;
  readonly url: string;
  readonly matchedBy: VersionMatch;
  /** "listed 24-02; this copy is 24-07", when the two differ. */
  readonly note?: string;
}

/**
 * Says which copy answers each reference, and whether its version is the one
 * listed. Called once the copies are on the device: `versionOf` reads the
 * version a held copy declares, by its normalised URL.
 *
 * A copy is the repository's newest version. An older one is not checked out
 * to match a listed version: tags here are missing or differ in case, and
 * since `revision` holds the listed version and not a commit (2026-10-06),
 * nothing records which commit a project meant. A difference is shown, never
 * hidden; taking another version is the upstream check's job, later.
 */
export const resolveRelatedTexts = (
  refs: readonly RelatedResource[],
  host: string,
  versionOf: (url: string) => string | undefined,
): readonly RelatedTextResolution[] =>
  refs.map((ref) => {
    const url = catalogueUrl(host, ref);
    const held = versionOf(normaliseRepoUrl(url));
    if (ref.version === undefined || (held !== undefined && sameVersion(held, ref.version)))
      return { ref, url, matchedBy: "listed" };
    return {
      ref,
      url,
      matchedBy: "newest",
      note:
        held === undefined
          ? `listed ${ref.version}; this copy does not say its version`
          : `listed ${ref.version}; this copy is ${held}`,
    };
  });

/** The Burrito form Sefer writes: one relationship per listed version, as bisa does. */
export const toBurritoRelationships = (
  refs: readonly RelatedResource[],
): readonly {
  readonly relationType: "source";
  readonly flavor: "textTranslation";
  readonly id: string;
  readonly revision?: string;
}[] =>
  refs.map((ref) => ({
    relationType: "source",
    flavor: "textTranslation",
    id: `${SOURCE_AUTHORITY.key}::${ref.language}/${ref.resource}`,
    ...(ref.version === undefined ? {} : { revision: ref.version }),
  }));
