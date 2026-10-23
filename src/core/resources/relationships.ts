export const SOURCE_AUTHORITY = {
  key: "wycliffeassociates",
  id: "https://www.wycliffeassociates.org",
  name: { en: "Wycliffe Associates" },
} as const;

export interface RelatedResource {
  readonly relation: "source";
  readonly language: string;
  readonly resource: string;
  readonly version?: string;
}

export interface BurritoRelationship {
  readonly relationType: string;
  readonly id: string;
  readonly revision?: string | undefined;
}

export interface ResourceContainerSource {
  readonly identifier: string;
  readonly language?: string | undefined;
  readonly version?: string | undefined;
}

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
  const resourceName = resource.trim().toLowerCase();
  if (lang === "" || resourceName === "") return undefined;
  const listed = version?.trim();
  return {
    relation: "source",
    language: lang,
    resource: resourceName,
    ...(listed === undefined || listed === "" ? {} : { version: listed }),
  };
};

const present = <A>(value: A | undefined): value is A => value !== undefined;

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

const bare = (version: string): string => version.replace(/^v/i, "").toLowerCase();

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

const sameVersion = (a: string, b: string): boolean => bare(a) === bare(b);

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

export const catalogueUrl = (host: string, ref: RelatedResource): string =>
  `${host.replace(/\/+$/, "")}/WA-Catalog/${ref.language}_${ref.resource}`;

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

export type VersionMatch = "listed" | "newest";

export interface RelatedTextResolution {
  readonly ref: RelatedResource;
  readonly url: string;
  readonly matchedBy: VersionMatch;
  readonly note?: string;
}

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
