// library.ts
//
// The Library: the registry of resources this installation knows about, and the
// picks that give a resource a *role* in a project. Two independent facts are
// kept apart: a resource's container (Burrito, Resource Container, loose USFM —
// what it is packed as) and its contextual role in a project (`source`,
// `notes`, `reference`, `glossary` — what it is *for*). `add` records the
// container once; `pick` records the role per project, so the same resource
// can be a source in one project and a reference in another, and nothing about
// the resource itself changes.
//
// The registry is small, read on nearly every screen and written rarely, so it
// is held in memory for the life of the Layer and persisted to
// `<libraryRoot>/library.json` on each mutation with `writeFileAtomic`.
//
// A pick is NOT in the registry: it is this device's memory of one project
// ("on this project I usually read that source text"), so it lives with the
// project, as `referencePicks` in its `.sefer/project.json` (Will,
// 2026-10-06), read when the project is reopened. Picks written by an older
// build into `library.json`'s `bindings` move there the first time the
// project's picks are read.
// Classification is not duplicated here: `add` calls `classify` from
// ./import.ts, the one place that decides what a folder is.

import { localized } from "@sefer/text/localized";
import { decode } from "@sefer/text/source";
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
import { readProjectMetadata } from "../project/discovery";
import { readProjectState, updateProjectState } from "../project/projectState";
import { classify, readJson, type Classification } from "./import";
import { recognize, type ContainerKind, type ContentKind, type Recognition } from "./kinds/content";
import { type Declared } from "./projectMetadata";
import { normaliseRepoUrl, type RelatedResource } from "./relationships";

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
  readonly container: ContainerKind;
  /**
   * What it HOLDS (`kinds/content.ts`), recognised from its metadata when it
   * was added and kept. A surface asks a handle for a slot, never this; the
   * kind table and the renderer registry are the two that read it.
   */
  readonly content: ContentKind;
  /** The one reader that parses it, chosen with `content`. */
  readonly format: Recognition["format"];
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
  /** What the resource calls itself (`ulb`), to match a project's declared source. */
  readonly identifier?: string;
  /** The version it declares (`24-07`), to say when it is not the one a project listed. */
  readonly version?: string;
  /**
   * Where this copy was cloned from, and the commit it holds. Per device: a
   * project names its source texts by language and resource, never by URL.
   * Absent for a folder a person picked.
   */
  readonly upstream?: Upstream;
}

/** The remote a copy came from. `url` is stored normalised, which is how it is compared. */
export interface Upstream {
  readonly url: string;
  readonly commit: string;
}

type LibraryRefusal = "Unclassified" | "Unsupported" | "NotFound" | "Io";

class LibraryError extends Data.TaggedError("LibraryError")<{
  readonly reason: LibraryRefusal;
  readonly description: string;
}> {}

export interface LibraryService {
  /** Every registered resource, in the order it was added. */
  readonly resources: () => Effect.Effect<readonly Resource[]>;
  /**
   * Classifies `root`, recognises what it holds, and registers it. Refuses
   * `Unclassified` when ./import.ts cannot say what the folder is, and
   * `Unsupported` when its metadata declares a kind or format Sefer has no
   * reader for (`kinds/content.ts`). Adding a root that is already
   * registered re-reads its metadata and replaces the entry.
   */
  readonly add: (root: string, upstream?: Upstream) => Effect.Effect<Resource, LibraryError>;
  /** The resource cloned from `url`, compared normalised; how a second pull becomes none. */
  readonly cloned: (url: string) => Effect.Effect<Option.Option<Resource>>;
  /**
   * What an open project declares as its source texts. Held in memory for the
   * session; `resolve(projectRoot, "source")` answers with the matching held
   * copies when the person has picked none.
   */
  readonly declare: (
    projectRoot: string,
    related: readonly RelatedResource[],
  ) => Effect.Effect<void>;
  /** Forgets a resource. A project's pick of it then resolves to nothing. */
  readonly remove: (id: string) => Effect.Effect<void, LibraryError>;
  /** Adds `resourceId` to what the project shows under `role`; idempotent, order kept. */
  readonly pick: (
    projectRoot: string,
    role: Role,
    resourceId: string,
  ) => Effect.Effect<void, LibraryError>;
  /** Removes one pick; a no-op when it was not there. */
  readonly unpick: (projectRoot: string, role: Role, resourceId: string) => Effect.Effect<void>;
  /**
   * Every resource picked for `role` in the project, in pick order. For
   * `source` with nothing picked, the held copies of what the project declares
   * (Will, 2026-10-06: the declared source text is the default).
   */
  readonly resolve: (projectRoot: string, role: Role) => Effect.Effect<readonly Resource[]>;
  /** Every pick of one project, so a shell can lay out panes without knowing the roles up front. */
  readonly picked: (
    projectRoot: string,
  ) => Effect.Effect<readonly { readonly role: Role; readonly resource: Resource }[]>;
  /**
   * The WHOLE canonical text of one book of a registered resource — the bytes
   * of its `.usfm` file, decoded the one way `packages/text/src/source.ts`
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
  container: Schema.Literals(["burrito", "resourceContainer", "looseUsfm"]),
  /**
   * Optional in the record only: a registry written before kinds has none,
   * and those rows are recognised again from their metadata on load.
   */
  content: Schema.optionalKey(
    Schema.Literals(["usfm", "tn", "tq", "tw", "macula-greek", "macula-hebrew"]),
  ),
  format: Schema.optionalKey(Schema.Literals(["usfm", "rcHelpMarkdown"])),
  root: Schema.String,
  title: Schema.String,
  language: Schema.optionalKey(Schema.String),
  subject: Schema.optionalKey(Schema.String),
  identifier: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
  upstream: Schema.optionalKey(Schema.Struct({ url: Schema.String, commit: Schema.String })),
});

/** `{ [role]: resourceId[] }`: one project's picks, many per role. */
const Picks = Schema.Record(Schema.String, Schema.Array(Schema.String));

type Picks = typeof Picks.Type;

const decodePicks = Schema.decodeUnknownResult(Picks);

const Registry = Schema.Struct({
  resources: Schema.Array(ResourceRecord),
  /**
   * Picks an older build kept here, `{ [projectId]: Picks }`. Moved into each
   * project's `.sefer/project.json` when that project's picks are first read,
   * and dropped from here as they move.
   */
  bindings: Schema.optionalKey(Schema.Record(Schema.String, Picks)),
});

/** What is held and written: every row recognised, so `content` is always there. */
interface Registry {
  readonly resources: readonly Resource[];
  readonly bindings?: (typeof Registry.Type)["bindings"];
}

const decodeRegistry = Schema.decodeUnknownResult(Registry);

/**
 * A registry written before `kind` was renamed `container` says `kind`. Read as
 * the same fact; the next write stores the new name. Without this every
 * existing library would fail to decode and start empty.
 */
const withContainer = (stored: unknown): unknown => {
  if (typeof stored !== "object" || stored === null || !("resources" in stored)) return stored;
  const { resources } = stored;
  if (!Array.isArray(resources)) return stored;
  return {
    ...stored,
    resources: resources.map((record: unknown) =>
      typeof record === "object" && record !== null && "kind" in record && !("container" in record)
        ? (({ kind, ...rest }) => ({ ...rest, container: kind }))(record)
        : record,
    ),
  };
};

const EMPTY: Registry = { resources: [] };

const withId = (ids: readonly string[], id: string): readonly string[] =>
  ids.includes(id) ? ids : [...ids, id];

const refuse = (reason: LibraryRefusal, description: string): LibraryError =>
  new LibraryError({ reason, description });

const failure = (error: PlatformError.PlatformError): LibraryError => refuse("Io", error.message);

const isUsfm = (path: string): boolean => path.toLowerCase().endsWith(".usfm");

type Described = Pick<Resource, "title" | "language" | "subject" | "identifier" | "version"> & {
  readonly declared?: Declared;
};

/**
 * Title, language and what a root declares about itself, read through the
 * same `readProjectMetadata` a project's own header uses, so a Resource
 * Container's `manifest.yaml` is read here too. For loose USFM, or metadata
 * that does not decode, the folder name is the title.
 */
const describe = (fileSystem: FileSystem.FileSystem, root: string): Effect.Effect<Described> =>
  Effect.map(readProjectMetadata(fileSystem, root), (read) =>
    Option.match(read.metadata, {
      onNone: (): Described => ({ title: lastSegment(root) }),
      onSome: (metadata): Described => {
        const title = localized(metadata.name, [metadata.defaultLocale]);
        return {
          declared: metadata.declared,
          title: title === "" ? lastSegment(root) : title,
          ...(metadata.language.tag === "" ? {} : { language: metadata.language.tag }),
          ...(metadata.subject === undefined ? {} : { subject: metadata.subject }),
          ...(metadata.id === undefined ? {} : { identifier: metadata.id.toLowerCase() }),
          ...(metadata.version === undefined ? {} : { version: metadata.version }),
        };
      },
    }),
  );

/**
 * A root, described and recognised: what `add` registers, and what a row
 * written before kinds is recognised as again. `Unsupported` names what the
 * metadata declared.
 */
const describeAndRecognize = (
  fileSystem: FileSystem.FileSystem,
  root: string,
  container: ContainerKind,
): Effect.Effect<
  {
    readonly recognition: Recognition;
    readonly fields: Omit<Resource, "id" | "root" | "upstream">;
  },
  LibraryError
> =>
  Effect.gen(function* () {
    const { declared, ...described } = yield* describe(fileSystem, root);
    const recognized = recognize({
      container,
      ...(described.subject === undefined ? {} : { subject: described.subject }),
      ...(described.identifier === undefined ? {} : { identifier: described.identifier }),
      ...(declared === undefined ? {} : { declared }),
    });
    if (Result.isFailure(recognized))
      return yield* Effect.fail(
        refuse("Unsupported", `${root}: ${recognized.failure.description}`),
      );
    return {
      recognition: recognized.success,
      fields: { container, ...recognized.success, ...described },
    };
  });

/**
 * What a root holds, before it is registered: the same classification and
 * recognition `add` makes, for a caller that must know the kind to decide
 * how to store it (the Web packs a help rather than keep its tree,
 * `app/arrival.ts`). Reads metadata only.
 */
export const recognizeRoot = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<Recognition, LibraryError> =>
  Effect.gen(function* () {
    const classification = yield* classify(fileSystem, { root });
    if (classification === "unknown")
      return yield* Effect.fail(
        refuse("Unclassified", `${root} is neither a Burrito, a Resource Container nor USFM`),
      );
    const { recognition } = yield* describeAndRecognize(fileSystem, root, classification);
    return recognition;
  });

/**
 * Whether a held resource is the copy a project's declaration names: cloned
 * from `WA-Catalog/<language>_<resource>`, or declaring that language and
 * identifier itself.
 */
export const answers = (resource: Resource, ref: RelatedResource): boolean =>
  resource.upstream?.url.endsWith(`/wa-catalog/${ref.language}_${ref.resource}`) === true ||
  (resource.language?.toLowerCase() === ref.language && resource.identifier === ref.resource);

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
    /**
     * Rows written before kinds that could not be recognised on this load —
     * a Burrito on a drive that is not mounted, metadata that did not read
     * this time. Not offered, but KEPT: every save writes them back, so a
     * transient failure never deletes a row and its upstream, and the next
     * load tries again. `add` of the same root, or `remove`, settles one.
     */
    let unrecognised: readonly (typeof ResourceRecord.Type)[] = [];
    if (stored !== undefined) {
      const decoded = decodeRegistry(withContainer(stored));
      if (Result.isSuccess(decoded)) {
        // A row written before kinds says nothing about what it holds. It is
        // recognised again from its own metadata, never assumed: a row that
        // cannot be recognised now is not offered (and said so), and is kept
        // in the registry as it was (`unrecognised`).
        const resources: Resource[] = [];
        const kept: (typeof ResourceRecord.Type)[] = [];
        for (const record of decoded.success.resources) {
          const { content, format, ...rest } = record;
          if (content !== undefined && format !== undefined) {
            resources.push({ ...rest, content, format });
            continue;
          }
          const again = yield* Effect.result(
            describeAndRecognize(fileSystem, record.root, record.container),
          );
          if (Result.isSuccess(again))
            resources.push({
              ...again.success.fields,
              id: record.id,
              root: record.root,
              ...(record.upstream === undefined ? {} : { upstream: record.upstream }),
            });
          else {
            kept.push(record);
            observability?.note("library.load", "declined", again.failure.description);
          }
        }
        unrecognised = kept;
        held = {
          resources,
          ...(decoded.success.bindings === undefined ? {} : { bindings: decoded.success.bindings }),
        };
      } else
        // A registry we cannot decode is not a reason to refuse to start: the
        // user's resources are still on disk and can be added again. Say so
        // loudly in telemetry and carry on with an empty library.
        observability?.note("library.load", "declined", "registry did not decode");
    }

    const persist = (next: Registry): Effect.Effect<void, LibraryError> =>
      Effect.mapError(
        Effect.gen(function* () {
          yield* fileSystem.makeDirectory(parentPath(registryPath), { recursive: true });
          const written = {
            ...next,
            resources: [
              ...next.resources,
              ...unrecognised.filter((row) => !next.resources.some((each) => each.id === row.id)),
            ],
          };
          yield* writeFileStringAtomic(
            fileSystem,
            registryPath,
            `${JSON.stringify(written, undefined, 2)}\n`,
          );
          held = next;
        }),
        failure,
      );

    const find = (id: string): Resource | undefined =>
      held.resources.find((resource) => resource.id === id);

    /** Per session: what each opened project declares. Re-declared on every open. */
    const declared = new Map<string, readonly RelatedResource[]>();

    /** Picks read this session, by project root: read once, then written through. */
    const picksHeld = new Map<string, Picks>();

    /**
     * One project's picks. The first read of a project that has none in its
     * `.sefer/project.json` takes what an older build kept in `library.json`
     * — under the root, or `root#<metadata id>` — writes it there, and drops it
     * from the registry. Never fails: a project whose state cannot be read or
     * written simply has no picks.
     */
    const picksOf = (projectRoot: string): Effect.Effect<Picks> =>
      Effect.gen(function* () {
        const cached = picksHeld.get(projectRoot);
        if (cached !== undefined) return cached;
        const state = yield* readProjectState(fileSystem, projectRoot);
        const stored = decodePicks(state.referencePicks);
        if (state.referencePicks !== undefined && Result.isSuccess(stored)) {
          picksHeld.set(projectRoot, stored.success);
          return stored.success;
        }
        const legacy = Object.entries(held.bindings ?? {}).filter(
          ([projectId]) => projectId === projectRoot || projectId.startsWith(`${projectRoot}#`),
        );
        const merged: Record<string, readonly string[]> = {};
        for (const [, roles] of legacy)
          for (const [role, ids] of Object.entries(roles))
            merged[role] = ids.reduce(withId, merged[role] ?? []);
        if (legacy.length > 0) {
          yield* Effect.ignore(
            updateProjectState(fileSystem, projectRoot, { referencePicks: merged }),
          );
          const moved = new Set(legacy.map(([projectId]) => projectId));
          const kept = Object.fromEntries(
            Object.entries(held.bindings ?? {}).filter(([projectId]) => !moved.has(projectId)),
          );
          yield* Effect.ignore(
            persist(
              Object.keys(kept).length === 0
                ? { resources: held.resources }
                : { resources: held.resources, bindings: kept },
            ),
          );
          observability?.note("library.picks.moved", "passed", undefined, {
            "library.picks.roles": Object.keys(merged).length,
          });
        }
        picksHeld.set(projectRoot, merged);
        return merged;
      });

    const writePicks = (projectRoot: string, picks: Picks): Effect.Effect<void, LibraryError> =>
      Effect.mapError(
        Effect.map(updateProjectState(fileSystem, projectRoot, { referencePicks: picks }), () => {
          picksHeld.set(projectRoot, picks);
        }),
        failure,
      );

    return {
      resources: () => Effect.succeed(held.resources),

      add: (root, upstream) =>
        Effect.gen(function* () {
          const classification: Classification = yield* classify(fileSystem, { root });
          if (classification === "unknown")
            return yield* Effect.fail(
              refuse("Unclassified", `${root} is neither a Burrito, a Resource Container nor USFM`),
            );
          const { fields: described } = yield* describeAndRecognize(
            fileSystem,
            root,
            classification,
          );
          // Re-adding a root keeps where it came from unless told otherwise:
          // a person picking a downloaded copy again has not changed its origin.
          const known = upstream ?? find(root)?.upstream;
          const resource: Resource = {
            id: root,
            root,
            ...described,
            ...(known === undefined
              ? {}
              : { upstream: { url: normaliseRepoUrl(known.url), commit: known.commit } }),
          };
          // Recognised now: no longer kept aside as unrecognised.
          unrecognised = unrecognised.filter((row) => row.id !== resource.id);
          yield* persist({
            ...held,
            resources: [...held.resources.filter((held) => held.id !== resource.id), resource],
          });
          observability?.note("library.add", "ready", undefined, {
            "resource.id": resource.id,
            "resource.classification": classification,
            "resource.content": resource.content,
            "resource.format": resource.format,
            "resource.cloned": upstream !== undefined,
          });
          return resource;
        }),

      cloned: (url) =>
        Effect.sync(() => {
          const wanted = normaliseRepoUrl(url);
          return Option.fromNullishOr(
            held.resources.find((resource) => resource.upstream?.url === wanted),
          );
        }),

      declare: (projectRoot, related) =>
        Effect.sync(() => {
          declared.set(projectRoot, related);
        }),

      remove: (id) =>
        Effect.suspend(() => {
          unrecognised = unrecognised.filter((row) => row.id !== id);
          return persist({
            ...held,
            resources: held.resources.filter((resource) => resource.id !== id),
          });
        }),

      pick: (projectRoot, role, resourceId) =>
        Effect.gen(function* () {
          if (find(resourceId) === undefined)
            return yield* Effect.fail(
              refuse("NotFound", `${resourceId} is not a registered resource`),
            );
          const picks = yield* picksOf(projectRoot);
          yield* writePicks(projectRoot, {
            ...picks,
            [role]: withId(picks[role] ?? [], resourceId),
          });
        }),

      unpick: (projectRoot, role, resourceId) =>
        Effect.ignore(
          Effect.gen(function* () {
            const picks = { ...(yield* picksOf(projectRoot)) };
            const ids = (picks[role] ?? []).filter((id) => id !== resourceId);
            if (ids.length === 0) delete picks[role];
            else picks[role] = ids;
            yield* writePicks(projectRoot, picks);
          }),
        ),

      resolve: (projectRoot, role) =>
        Effect.gen(function* () {
          const picks = yield* picksOf(projectRoot);
          const chosen = (picks[role] ?? [])
            .map(find)
            .filter((resource): resource is Resource => resource !== undefined);
          if (chosen.length > 0 || role !== ROLES.source) return chosen;
          return (declared.get(projectRoot) ?? []).flatMap((ref) => {
            const copy = held.resources.find((resource) => answers(resource, ref));
            return copy === undefined ? [] : [copy];
          });
        }),

      picked: (projectRoot) =>
        Effect.map(picksOf(projectRoot), (picks) =>
          Object.entries(picks).flatMap(([role, ids]) =>
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
