/**
 * The kind table: for every `ContentKind`, the role a pick of it plays in a
 * project and how to open a handle on it.
 *
 * A record keyed by the closed union, not a switch: adding a kind to
 * `ContentKind` fails to compile here until it has a row, which is the whole
 * of what "closed" buys. It lives in `src/app` because a row may point at a
 * core adapter (Translation Notes, over the `FileSystem` port) or at a
 * platform one (Macula, which fetches and initialises wasm), and only the app
 * may import both.
 *
 * Nothing outside this table and the renderer registry
 * (`ui/kinds/registry.tsx`) reads `Resource.content`.
 */

import { Effect, type FileSystem } from "effect";

import type { ContentKind } from "#core/resources/kinds/content";
import { Unavailable, type OpenHandle } from "#core/resources/kinds/handle";
import { openTranslationNotes } from "#core/resources/kinds/tn/adapter";
import { indexHelp, packHelp } from "#core/resources/kinds/tn/pack";
import type { PackProgress, UpstreamTree } from "#core/resources/kinds/tree";
import { ROLES, type Resource, type Role } from "#core/resources/library";

interface KindRow {
  /** The role a pick of this kind takes in a project (`Library.pick`). */
  readonly role: Role;
  /**
   * Its files are USFM books the engine can register: what Find's reference
   * scope and the overlays read (`workflows/references.ts`). Tier 3, said
   * here so no workflow has to ask which kind a resource is.
   */
  readonly engineBooks: boolean;
  /**
   * How the kind is kept where its upstream tree is too many files to write
   * (the Web's OPFS, `storage.md`): from a tree staged in memory to a root
   * holding only what the kind reads. Absent: the tree is kept as cloned.
   */
  readonly pack?: (
    from: UpstreamTree,
    to: { readonly fileSystem: FileSystem.FileSystem; readonly root: string },
    provenance: { readonly at: string; readonly commit?: string },
    onProgress?: (progress: PackProgress) => void,
  ) => Effect.Effect<unknown, Unavailable>;
  /**
   * How the kind readies a tree kept as cloned (desktop), once, when it
   * arrives, so its first read is not the one that indexes it. Absent:
   * nothing to ready.
   */
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

/** A kind Sefer knows by name and has no reader for yet. */
const notYet = (what: string) => (): Effect.Effect<OpenHandle, Unavailable> =>
  Effect.fail(new Unavailable({ reason: "Unsupported", description: `${what}: no reader yet` }));

const info = (resource: Resource, content: ContentKind) => ({
  content,
  title: resource.title,
  ...(resource.language === undefined ? {} : { language: resource.language }),
  direction: "ltr" as const,
});

const KINDS: { readonly [K in ContentKind]: KindRow } = {
  // Scripture fills no tier-2 slot yet: its pane reads the book's text itself
  // and parses it with the engine (tier 3), as it did before kinds.
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
  // Macula arrives through a `builtin` container and a platform adapter
  // (`src/platform/*/macula.ts`), not through `recognize`; the row is here so
  // the registry has to say what it shows for it.
  "macula-greek": { role: ROLES.reference, engineBooks: false, open: notYet("Macula Greek") },
  "macula-hebrew": { role: ROLES.reference, engineBooks: false, open: notYet("Macula Hebrew") },
};

/** The role a pick of `resource` takes in a project. */
export const roleFor = (resource: Resource): Role => KINDS[resource.content].role;

/** How `content` is packed where its tree is not kept, or `undefined` to keep the tree. */
export const packFor = (content: ContentKind): KindRow["pack"] => KINDS[content].pack;

export const indexFor = (content: ContentKind): KindRow["index"] => KINDS[content].index;

/** Whether `resource`'s files are USFM books for the engine's corpus. */
export const holdsEngineBooks = (resource: Resource): boolean =>
  KINDS[resource.content].engineBooks;

/** Every role some kind is picked under, in table order, once each. */
export const KIND_ROLES: readonly Role[] = [
  ...new Set(Object.values(KINDS).map((row) => row.role)),
];

/** Opens a handle on `resource` through its kind's row. */
export const openHandle = (
  fileSystem: FileSystem.FileSystem,
  resource: Resource,
): Effect.Effect<OpenHandle, Unavailable> => KINDS[resource.content].open(fileSystem, resource);
