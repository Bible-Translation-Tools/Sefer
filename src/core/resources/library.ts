// library.ts
//
// The Library: the registry of resources this installation knows about, and the
// bindings that give a resource a *role* in a project. Two independent facts
// are kept apart: a resource's semantic kind (Burrito, Resource Container,
// loose USFM — what it *is*) and its contextual role in a project (`source`,
// `notes`, `reference`, `glossary` — what it is *for*). `add` records the kind
// once; `bind` records the role per project, so the same resource can be a
// source in one project and a reference in another, and nothing about the
// resource itself changes.
//
// The registry is small, read on nearly every screen and written rarely, so it
// is held in memory for the life of the Layer and persisted to
// `<libraryRoot>/library.json` on each mutation with `writeFileAtomic`.
// Classification is not duplicated here: `add` calls `classify` from
// ./import.ts, the one place that decides what a folder is.

import {
  Context,
  Data,
  Effect,
  FileSystem,
  Layer,
  Option,
  Result,
  Schema,
  type PlatformError,
} from "effect";

import { writeFileStringAtomic } from "../fileSystem/atomic";
import { joinPath, lastSegment, parentPath } from "../fileSystem/path";
import { Observability, type ObservabilityService } from "../observability";
import { decode } from "../source/source";
import { decodeBurritoMetadata } from "./burrito";
import { classify, readJson, type Classification } from "./import";
import { decodeResourceContainerManifest } from "./resourceContainer";

/** What a resource is. The `unknown` classification is never registered. */
export type ResourceKind = "burrito" | "resourceContainer" | "looseUsfm";

/**
 * What a resource is *for*, in one project. The well-known roles are named
 * here; the type stays open so a project can bind a role Sefer has no surface
 * for yet (translation notes, translation words, questions) without a core
 * change. A role holds MANY resources: two source texts side by side, or a
 * notes set per language, are ordinary — nothing here is pre-baked to one.
 */
export type Role = "source" | "notes" | "reference" | "glossary" | (string & {});

export const ROLES = {
  source: "source",
  notes: "notes",
  reference: "reference",
  glossary: "glossary",
  translationNotes: "tn",
  translationWords: "tw",
  translationQuestions: "tq",
} as const satisfies Record<string, Role>;

export interface Resource {
  /**
   * Stable local identity. It is the normalised root path: a resource is where
   * it lives, and nothing in core mints identifiers. Moving a resource makes a
   * new one, which is the honest answer — its provenance moved too.
   */
  readonly id: string;
  readonly kind: ResourceKind;
  readonly root: string;
  readonly title: string;
  readonly language?: string;
  /**
   * What the container says it holds — a Burrito flavor (`textTranslation`),
   * or a Resource Container subject (`Bible`, `Translation Notes`,
   * `Translation Words`). Sefer does not render every subject yet; carrying it
   * lets a surface pick the renderer, and lets the library list what it holds.
   */
  readonly subject?: string;
}

type LibraryRefusal = "Unclassified" | "NotFound" | "Io";

class LibraryError extends Data.TaggedError("LibraryError")<{
  readonly reason: LibraryRefusal;
  readonly description: string;
}> {}

export interface LibraryService {
  /** Every registered resource, in the order it was added. */
  readonly resources: () => Effect.Effect<readonly Resource[]>;
  /**
   * Classifies `root` and registers it. Refuses `Unclassified` when
   * ./import.ts cannot say what the folder holds. Adding a root that is already
   * registered re-reads its metadata and replaces the entry.
   */
  readonly add: (root: string) => Effect.Effect<Resource, LibraryError>;
  /** Forgets a resource and every binding that pointed at it. */
  readonly remove: (id: string) => Effect.Effect<void, LibraryError>;
  /** Adds `resourceId` to the resources holding `role` in `projectId`; idempotent, order kept. */
  readonly bind: (
    projectId: string,
    role: Role,
    resourceId: string,
  ) => Effect.Effect<void, LibraryError>;
  /** Removes one binding; a no-op when it was not there. */
  readonly unbind: (projectId: string, role: Role, resourceId: string) => Effect.Effect<void>;
  /** Every resource bound to `role` in `projectId`, in binding order; empty is explicit, never substituted. */
  readonly resolve: (projectId: string, role: Role) => Effect.Effect<readonly Resource[]>;
  /** Every binding of one project, so a shell can lay out panes without knowing the roles up front. */
  readonly bound: (
    projectId: string,
  ) => Effect.Effect<readonly { readonly role: Role; readonly resource: Resource }[]>;
  /**
   * The WHOLE canonical text of one book of a registered resource — the bytes
   * of its `.usfm` file, decoded the one way `src/core/source/source.ts`
   * decodes anything.
   *
   * There is no door that answers a verse: the engine parses a book and not
   * a fragment, and only its TOC knows where a verse begins, so a caller that
   * wants one passage reads the book and asks the engine (the STET workflow's
   * `sourceReadings` does). This is file resolution and decoding, and nothing
   * else — no slicing, no interpretation.
   *
   * `none` when the resource is not registered or holds no file for `bookId`
   * — a reference Bible that simply lacks Philemon is the ordinary case and
   * the pane says so. Fails `Io` only when a file that exists cannot be read
   * or does not decode.
   */
  readonly readBook: (
    resourceId: string,
    bookId: string,
  ) => Effect.Effect<Option.Option<string>, LibraryError>;
}

export class Library extends Context.Service<Library, LibraryService>()("Library") {}

const REGISTRY_FILE = "library.json";

const ResourceRecord = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["burrito", "resourceContainer", "looseUsfm"]),
  root: Schema.String,
  title: Schema.String,
  language: Schema.optionalKey(Schema.String),
  subject: Schema.optionalKey(Schema.String),
});

const Registry = Schema.Struct({
  resources: Schema.Array(ResourceRecord),
  /** `{ [projectId]: { [role]: resourceId[] } }` — a project's role assignments, many per role. */
  bindings: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Array(Schema.String))),
});

type Registry = typeof Registry.Type;

const decodeRegistry = Schema.decodeUnknownResult(Registry);

const EMPTY: Registry = { resources: [], bindings: {} };

const withId = (ids: readonly string[], id: string): readonly string[] =>
  ids.includes(id) ? ids : [...ids, id];

const refuse = (reason: LibraryRefusal, description: string): LibraryError =>
  new LibraryError({ reason, description });

const failure = (error: PlatformError.PlatformError): LibraryError => refuse("Io", error.message);

const isUsfm = (path: string): boolean => path.toLowerCase().endsWith(".usfm");

/** One localized-text value, preferring `defaultLocale` then `en` then whatever is first. */
const localized = (
  values: Readonly<Record<string, string>>,
  preferred: string | undefined,
): string | undefined => {
  if (preferred !== undefined && values[preferred] !== undefined) return values[preferred];
  if (values.en !== undefined) return values.en;
  return Object.values(values)[0];
};

/**
 * Title and language for a classified root. The metadata files were already
 * decoded once by `classify`; they are read again here rather than threaded
 * through the classification result, because `classify`'s answer is a
 * classification and nothing more. For `looseUsfm` (and for a `manifest.yaml`
 * with no JSON sibling, which core cannot parse) the folder name is the title.
 */
const describe = (
  fileSystem: FileSystem.FileSystem,
  root: string,
  kind: ResourceKind,
): Effect.Effect<{
  readonly title: string;
  readonly language?: string;
  readonly subject?: string;
}> =>
  Effect.gen(function* () {
    if (kind === "burrito") {
      const value = yield* readJson(fileSystem, joinPath(root, "metadata.json"));
      const decoded = decodeBurritoMetadata(value);
      if (Result.isSuccess(decoded)) {
        const metadata = decoded.success;
        const title = localized(metadata.identification.name, metadata.meta.defaultLocale);
        const language = metadata.languages[0]?.tag;
        return {
          title: title ?? lastSegment(root),
          ...(language === undefined ? {} : { language }),
          subject: metadata.type.flavorType.flavor.name,
        };
      }
    }
    if (kind === "resourceContainer") {
      const value = yield* readJson(fileSystem, joinPath(root, "manifest.json"));
      const decoded = decodeResourceContainerManifest(value);
      if (Result.isSuccess(decoded)) {
        const core = decoded.success.dublin_core;
        return {
          title: core.title,
          language: core.language.identifier,
          ...(core.subject === undefined ? {} : { subject: core.subject }),
        };
      }
    }
    return { title: lastSegment(root) };
  });

/** Book files under a resource root, relative to it. */
const usfmFilesUnder = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<readonly string[]> =>
  Effect.map(
    Effect.orElseSucceed(
      fileSystem.readDirectory(root, { recursive: true }),
      (): readonly string[] => [],
    ),
    (entries) => entries.filter(isUsfm).sort(),
  );

/**
 * The file for `book` inside a resource: the first `.usfm` path whose last
 * segment contains the book code, case-insensitively. That matches both
 * `58-PHM.usfm` and `PHM.usfm`; it is deliberately loose because resource
 * layouts vary and the manifest that would say authoritatively is YAML.
 */
const bookFileFor = (files: readonly string[], book: string): string | undefined => {
  const needle = book.toLowerCase();
  return files.find((file) => lastSegment(file).toLowerCase().includes(needle));
};

const makeLibrary = (
  fileSystem: FileSystem.FileSystem,
  libraryRoot: string,
  observability: ObservabilityService | undefined,
): Effect.Effect<LibraryService> =>
  Effect.gen(function* () {
    const registryPath = joinPath(libraryRoot, REGISTRY_FILE);
    const stored = yield* readJson(fileSystem, registryPath);
    let held = EMPTY;
    if (stored !== undefined) {
      const decoded = decodeRegistry(stored);
      if (Result.isSuccess(decoded)) held = decoded.success;
      else
        // A registry we cannot decode is not a reason to refuse to start: the
        // user's resources are still on disk and can be added again. Say so
        // loudly in telemetry and carry on with an empty library.
        observability?.note("library.load", "declined", "registry did not decode");
    }

    const persist = (next: Registry): Effect.Effect<void, LibraryError> =>
      Effect.mapError(
        Effect.gen(function* () {
          yield* fileSystem.makeDirectory(parentPath(registryPath), { recursive: true });
          yield* writeFileStringAtomic(
            fileSystem,
            registryPath,
            `${JSON.stringify(next, undefined, 2)}\n`,
          );
          held = next;
        }),
        failure,
      );

    const find = (id: string): Resource | undefined =>
      held.resources.find((resource) => resource.id === id);

    return {
      resources: () => Effect.succeed(held.resources),

      add: (root) =>
        Effect.gen(function* () {
          const classification: Classification = yield* classify(fileSystem, { root });
          if (classification === "unknown")
            return yield* Effect.fail(
              refuse("Unclassified", `${root} is neither a Burrito, a Resource Container nor USFM`),
            );
          const described = yield* describe(fileSystem, root, classification);
          const resource: Resource = {
            id: root,
            kind: classification,
            root,
            title: described.title,
            ...(described.language === undefined ? {} : { language: described.language }),
          };
          yield* persist({
            ...held,
            resources: [...held.resources.filter((held) => held.id !== resource.id), resource],
          });
          observability?.note("library.add", "ready", undefined, {
            "resource.id": resource.id,
            "resource.classification": classification,
          });
          return resource;
        }),

      remove: (id) =>
        Effect.suspend(() => {
          const bindings: Record<string, Record<string, readonly string[]>> = {};
          for (const [projectId, roles] of Object.entries(held.bindings)) {
            const kept = Object.entries(roles)
              .map(([role, ids]) => [role, ids.filter((resourceId) => resourceId !== id)] as const)
              .filter(([, ids]) => ids.length > 0);
            if (kept.length > 0) bindings[projectId] = Object.fromEntries(kept);
          }
          return persist({
            resources: held.resources.filter((resource) => resource.id !== id),
            bindings,
          });
        }),

      bind: (projectId, role, resourceId) =>
        Effect.suspend(() =>
          find(resourceId) === undefined
            ? Effect.fail(refuse("NotFound", `${resourceId} is not a registered resource`))
            : persist({
                ...held,
                bindings: {
                  ...held.bindings,
                  [projectId]: {
                    ...held.bindings[projectId],
                    [role]: withId(held.bindings[projectId]?.[role] ?? [], resourceId),
                  },
                },
              }),
        ),

      unbind: (projectId, role, resourceId) =>
        Effect.suspend(() => {
          const ids = (held.bindings[projectId]?.[role] ?? []).filter((id) => id !== resourceId);
          const roles = { ...held.bindings[projectId] };
          if (ids.length === 0) delete roles[role];
          else roles[role] = ids;
          return Effect.ignore(
            persist({ ...held, bindings: { ...held.bindings, [projectId]: roles } }),
          );
        }),

      resolve: (projectId, role) =>
        Effect.sync(() =>
          (held.bindings[projectId]?.[role] ?? [])
            .map(find)
            .filter((resource): resource is Resource => resource !== undefined),
        ),

      bound: (projectId) =>
        Effect.sync(() =>
          Object.entries(held.bindings[projectId] ?? {}).flatMap(([role, ids]) =>
            ids
              .map(find)
              .filter((resource): resource is Resource => resource !== undefined)
              .map((resource) => ({ role, resource })),
          ),
        ),

      readBook: (resourceId, bookId) =>
        Effect.gen(function* () {
          const resource = find(resourceId);
          if (resource === undefined) return Option.none<string>();
          const files = yield* usfmFilesUnder(fileSystem, resource.root);
          const file = bookFileFor(files, bookId);
          if (file === undefined) return Option.none<string>();
          const bytes = yield* Effect.mapError(
            fileSystem.readFile(joinPath(resource.root, file)),
            failure,
          );
          const source = decode(bytes);
          if (Result.isFailure(source))
            return yield* Effect.fail(refuse("Io", `${file}: ${source.failure.description}`));
          return Option.some(source.success.text);
        }),
    };
  });

export const LibraryLive = (options: {
  readonly libraryRoot: string;
}): Layer.Layer<Library, never, FileSystem.FileSystem> =>
  Layer.effect(
    Library,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const observability = yield* Effect.serviceOption(Observability);
      return yield* makeLibrary(
        fileSystem,
        options.libraryRoot,
        Option.getOrUndefined(observability),
      );
    }),
  );
