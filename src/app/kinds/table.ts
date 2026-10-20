import { Effect, type FileSystem } from "effect";

import type { ContentKind } from "#core/resources/kinds/content";
import { Unavailable, type OpenHandle } from "#core/resources/kinds/handle";
import { openTranslationNotes } from "#core/resources/kinds/tn/adapter";
import { indexHelp, packHelp } from "#core/resources/kinds/tn/pack";
import type { PackProgress, UpstreamTree } from "#core/resources/kinds/tree";
import { ROLES, type Resource, type Role } from "#core/resources/library";

interface KindRow {
  readonly role: Role;
  readonly engineBooks: boolean;
  readonly pack?: (
    from: UpstreamTree,
    to: { readonly fileSystem: FileSystem.FileSystem; readonly root: string },
    provenance: { readonly at: string; readonly commit?: string },
    onProgress?: (progress: PackProgress) => void,
  ) => Effect.Effect<unknown, Unavailable>;
  readonly index?: (
    fileSystem: FileSystem.FileSystem,
    root: string,
    onProgress?: (progress: PackProgress) => void,
  ) => Effect.Effect<unknown, Unavailable>;
  readonly open: (
    fileSystem: FileSystem.FileSystem,
    resource: Resource,
  ) => Effect.Effect<OpenHandle, Unavailable>;
}

const notYet = (what: string) => (): Effect.Effect<OpenHandle, Unavailable> =>
  Effect.fail(new Unavailable({ reason: "Unsupported", description: `${what}: no reader yet` }));

const info = (resource: Resource, content: ContentKind) => ({
  content,
  title: resource.title,
  ...(resource.language === undefined ? {} : { language: resource.language }),
  direction: "ltr" as const,
});

const KINDS: { readonly [K in ContentKind]: KindRow } = {
  usfm: {
    role: ROLES.source,
    engineBooks: true,
    open: (_fileSystem, resource) =>
      Effect.succeed({
        content: "usfm",
        handle: { info: info(resource, "usfm"), release: Effect.void },
      }),
  },
  tn: {
    role: ROLES.translationNotes,
    engineBooks: false,
    pack: packHelp,
    index: indexHelp,
    open: (fileSystem, resource) =>
      Effect.map(openTranslationNotes(fileSystem, resource), (handle) => ({
        content: "tn",
        handle,
      })),
  },
  tq: {
    role: ROLES.translationQuestions,
    engineBooks: false,
    open: notYet("Translation Questions"),
  },
  tw: { role: ROLES.translationWords, engineBooks: false, open: notYet("Translation Words") },
  "macula-greek": { role: ROLES.reference, engineBooks: false, open: notYet("Macula Greek") },
  "macula-hebrew": { role: ROLES.reference, engineBooks: false, open: notYet("Macula Hebrew") },
};

export const roleFor = (resource: Resource): Role => KINDS[resource.content].role;

export const packFor = (content: ContentKind): KindRow["pack"] => KINDS[content].pack;

export const indexFor = (content: ContentKind): KindRow["index"] => KINDS[content].index;

export const holdsEngineBooks = (resource: Resource): boolean =>
  KINDS[resource.content].engineBooks;

export const KIND_ROLES: readonly Role[] = [
  ...new Set(Object.values(KINDS).map((row) => row.role)),
];

export const openHandle = (
  fileSystem: FileSystem.FileSystem,
  resource: Resource,
): Effect.Effect<OpenHandle, Unavailable> => KINDS[resource.content].open(fileSystem, resource);
