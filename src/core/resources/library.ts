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
  readonly id: string;
  readonly container: ContainerKind;
  readonly content: ContentKind;
  readonly format: Recognition["format"];
  readonly root: string;
  readonly title: string;
  /** The text's shorthand (`ULB`), for where a title is too long; never the id. */
  readonly abbreviation?: string;
  readonly language?: string;
  /** The language's name as the text's own metadata gives it, for a tag the browser cannot name (`nxi`). */
  readonly languageName?: string;
  readonly subject?: string;
  readonly identifier?: string;
  readonly version?: string;
  readonly upstream?: Upstream;
}

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
  readonly resources: () => Effect.Effect<readonly Resource[]>;
  readonly add: (root: string, upstream?: Upstream) => Effect.Effect<Resource, LibraryError>;
  readonly cloned: (url: string) => Effect.Effect<Option.Option<Resource>>;
  readonly declare: (
    projectRoot: string,
    related: readonly RelatedResource[],
  ) => Effect.Effect<void>;
  readonly remove: (id: string) => Effect.Effect<void, LibraryError>;
  readonly pick: (
    projectRoot: string,
    role: Role,
    resourceId: string,
  ) => Effect.Effect<void, LibraryError>;
  readonly unpick: (projectRoot: string, role: Role, resourceId: string) => Effect.Effect<void>;
  /**
   * Every resource picked for `role` in the project, in pick order. For
   * `source` with nothing picked, the held copies of what the project declares
   * (Will, 2026-10-06: the declared source text is the default).
   */
  readonly resolve: (projectRoot: string, role: Role) => Effect.Effect<readonly Resource[]>;
  readonly picked: (
    projectRoot: string,
  ) => Effect.Effect<readonly { readonly role: Role; readonly resource: Resource }[]>;
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
  content: Schema.optionalKey(
    Schema.Literals(["usfm", "tn", "tq", "tw", "macula-greek", "macula-hebrew"]),
  ),
  format: Schema.optionalKey(Schema.Literals(["usfm", "rcHelpMarkdown"])),
  root: Schema.String,
  title: Schema.String,
  abbreviation: Schema.optionalKey(Schema.String),
  language: Schema.optionalKey(Schema.String),
  languageName: Schema.optionalKey(Schema.String),
  subject: Schema.optionalKey(Schema.String),
  identifier: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
  upstream: Schema.optionalKey(Schema.Struct({ url: Schema.String, commit: Schema.String })),
});

const Picks = Schema.Record(Schema.String, Schema.Array(Schema.String));

type Picks = typeof Picks.Type;

const decodePicks = Schema.decodeUnknownResult(Picks);

const Registry = Schema.Struct({
  resources: Schema.Array(ResourceRecord),
  bindings: Schema.optionalKey(Schema.Record(Schema.String, Picks)),
});

interface Registry {
  readonly resources: readonly Resource[];
  readonly bindings?: (typeof Registry.Type)["bindings"];
}

const decodeRegistry = Schema.decodeUnknownResult(Registry);

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

type Described = Pick<
  Resource,
  "title" | "abbreviation" | "language" | "languageName" | "subject" | "identifier" | "version"
> & {
  readonly declared?: Declared;
};

const describe = (fileSystem: FileSystem.FileSystem, root: string): Effect.Effect<Described> =>
  Effect.map(readProjectMetadata(fileSystem, root), (read) =>
    Option.match(read.metadata, {
      onNone: (): Described => ({ title: lastSegment(root) }),
      onSome: (metadata): Described => {
        const title = localized(metadata.name, [metadata.defaultLocale]);
        const abbreviation = localized(metadata.abbreviation, [metadata.defaultLocale]);
        const languageName = localized(metadata.language.name, [metadata.defaultLocale]);
        return {
          declared: metadata.declared,
          title: title === "" ? lastSegment(root) : title,
          ...(abbreviation === "" ? {} : { abbreviation }),
          ...(metadata.language.tag === "" ? {} : { language: metadata.language.tag }),
          ...(languageName === "" || languageName === metadata.language.tag
            ? {}
            : { languageName }),
          ...(metadata.subject === undefined ? {} : { subject: metadata.subject }),
          ...(metadata.id === undefined ? {} : { identifier: metadata.id.toLowerCase() }),
          ...(metadata.version === undefined ? {} : { version: metadata.version }),
        };
      },
    }),
  );

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

export const answers = (resource: Resource, ref: RelatedResource): boolean =>
  resource.upstream?.url.endsWith(`/wa-catalog/${ref.language}_${ref.resource}`) === true ||
  (resource.language?.toLowerCase() === ref.language && resource.identifier === ref.resource);

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
    let unrecognised: readonly (typeof ResourceRecord.Type)[] = [];
    if (stored !== undefined) {
      const decoded = decodeRegistry(withContainer(stored));
      if (Result.isSuccess(decoded)) {
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
      } else observability?.note("library.load", "declined", "registry did not decode");
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

    const declared = new Map<string, readonly RelatedResource[]>();

    const picksHeld = new Map<string, Picks>();

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
          const known = upstream ?? find(root)?.upstream;
          const resource: Resource = {
            id: root,
            root,
            ...described,
            ...(known === undefined
              ? {}
              : { upstream: { url: normaliseRepoUrl(known.url), commit: known.commit } }),
          };
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
