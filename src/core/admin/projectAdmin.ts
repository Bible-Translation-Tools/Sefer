/**
 * ProjectAdmin (slice 31): the jobs that act on a project as a whole rather
 * than on its text — rename, delete, read and edit its metadata, export a
 * copy. It sits over `FileSystem` and the Scripture Burrito schema, and it
 * owns two rules that must not be softened:
 *
 *   - metadata is only ever written back through the schema, so an edit
 *     cannot leave `metadata.json` invalid for the next reader;
 *   - deleting a project asks first, always, through a confirm port the host
 *     supplies — there is no silent path.
 */
import {
  Context,
  Data,
  Effect,
  FileSystem,
  Layer,
  Option,
  type PlatformError,
  Result,
} from "effect";

import { writeFileStringAtomic } from "../fileSystem/atomic";
import { type BurritoMetadata, decodeBurritoMetadata } from "../resources/burrito";

/** Scripture Burrito's own name for the file; not ours to choose. */
export const METADATA_FILE = "metadata.json";

/**
 * Where a project's name lives when it is not a burrito. `.sefer/` is Sefer's
 * own corner of a project folder — never something another tool reads.
 */
export const SEFER_PROJECT_FILE = ".sefer/project.json";

export type ExportFormat = "burrito" | "usfm-zip";

/**
 * `NotFound` — the project, or the metadata being edited, is not there.
 * `Invalid` — `metadata.json` is not JSON, or not Scripture Burrito.
 * `Refused` — the person said no, or Sefer declined the request.
 * `Unsupported` — the format is not implemented in this build.
 * `Io` — the host's storage failed.
 */
export type AdminFailureReason = "NotFound" | "Invalid" | "Refused" | "Unsupported" | "Io";

export class AdminError extends Data.TaggedError("AdminError")<{
  readonly reason: AdminFailureReason;
  readonly description?: string | undefined;
}> {}

/**
 * The host's confirmation, seen as a plain port so core does not depend on
 * the `Dialogs` service. Composition passes `Dialogs.confirm`.
 */
export type Confirm = (message: string) => Effect.Effect<boolean>;

/** A shallow patch over decoded metadata: whole top-level members replace. */
export type MetadataPatch = Partial<BurritoMetadata>;

export interface ProjectAdminService {
  /**
   * Renames the project as people see it, not the folder on disk: a burrito's
   * `identification.name` is rewritten in place, and a project without
   * metadata records the name in `.sefer/project.json`. Moving the folder is a
   * separate job with different consequences (open books, git remotes).
   */
  readonly rename: (root: string, name: string) => Effect.Effect<void, AdminError>;
  /** Removes the project folder, but only after `confirm` answers true. */
  readonly delete: (root: string, confirm: Confirm) => Effect.Effect<void, AdminError>;
  /** `None` when the project carries no `metadata.json`; `Invalid` when it does but it is broken. */
  readonly metadata: (root: string) => Effect.Effect<Option.Option<BurritoMetadata>, AdminError>;
  /** Merges, re-validates through the schema, and refuses rather than writing something invalid. */
  readonly updateMetadata: (root: string, patch: MetadataPatch) => Effect.Effect<void, AdminError>;
  /** Returns the path that was written. */
  readonly export: (
    root: string,
    format: ExportFormat,
    to: string,
  ) => Effect.Effect<string, AdminError>;
}

export class ProjectAdmin extends Context.Service<ProjectAdmin, ProjectAdminService>()(
  "ProjectAdmin",
) {}

const ioFailure = (error: PlatformError.PlatformError): AdminError =>
  new AdminError({
    reason: error.reason._tag === "NotFound" ? "NotFound" : "Io",
    description: error.reason.description ?? error.message,
  });

/** The locale a rename writes into: the project's own default, or the one already there. */
const nameLocale = (metadata: BurritoMetadata): string => {
  const declared = metadata.meta.defaultLocale;
  if (declared !== undefined) return declared;
  const existing = Object.keys(metadata.identification.name).at(0);
  return existing ?? "en";
};

const makeProjectAdmin = (fileSystem: FileSystem.FileSystem): ProjectAdminService => {
  const metadataPath = (root: string): string => `${root}/${METADATA_FILE}`;

  /** The raw JSON object, before the schema sees it — `None` when absent. */
  const rawMetadata = (
    root: string,
  ): Effect.Effect<Option.Option<Record<string, unknown>>, AdminError> =>
    Effect.gen(function* () {
      const path = metadataPath(root);
      const present = yield* Effect.mapError(fileSystem.exists(path), ioFailure);
      if (!present) return Option.none();
      const text = yield* Effect.mapError(fileSystem.readFileString(path), ioFailure);
      const parsed = yield* Effect.try({
        try: (): unknown => JSON.parse(text),
        catch: (error) =>
          new AdminError({
            reason: "Invalid",
            description: `${METADATA_FILE} is not JSON: ${String(error)}`,
          }),
      });
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return yield* Effect.fail(
          new AdminError({ reason: "Invalid", description: `${METADATA_FILE} is not an object` }),
        );
      }
      // SAFETY: the check above rules out null, arrays and primitives, so what
      // remains of a JSON.parse result is a plain object with string keys.
      return Option.some({ ...(parsed as Record<string, unknown>) });
    });

  /** The single gate every metadata write goes through. */
  const writeMetadata = (
    root: string,
    value: Record<string, unknown>,
  ): Effect.Effect<BurritoMetadata, AdminError> => {
    const decoded = decodeBurritoMetadata(value);
    if (Result.isFailure(decoded)) {
      return Effect.fail(
        new AdminError({
          reason: "Invalid",
          description: `${METADATA_FILE} would no longer be Scripture Burrito: ${decoded.failure.message}`,
        }),
      );
    }
    return Effect.as(
      Effect.mapError(
        writeFileStringAtomic(
          fileSystem,
          metadataPath(root),
          `${JSON.stringify(value, null, 2)}\n`,
        ),
        ioFailure,
      ),
      decoded.success,
    );
  };

  const metadata = (root: string): Effect.Effect<Option.Option<BurritoMetadata>, AdminError> =>
    Effect.flatMap(rawMetadata(root), (raw) =>
      Option.match(raw, {
        onNone: () => Effect.succeed(Option.none<BurritoMetadata>()),
        onSome: (value) => {
          const decoded = decodeBurritoMetadata(value);
          return Result.isFailure(decoded)
            ? Effect.fail(
                new AdminError({ reason: "Invalid", description: decoded.failure.message }),
              )
            : Effect.succeed(Option.some(decoded.success));
        },
      }),
    );

  return {
    rename: (root, name) =>
      Effect.gen(function* () {
        const raw = yield* rawMetadata(root);
        if (Option.isSome(raw)) {
          const current = yield* metadata(root);
          if (Option.isSome(current)) {
            const locale = nameLocale(current.value);
            const identification = {
              ...current.value.identification,
              name: { ...current.value.identification.name, [locale]: name },
            };
            yield* writeMetadata(root, { ...raw.value, identification });
            return;
          }
        }
        // No burrito metadata to carry the name, so Sefer keeps it in its own
        // corner rather than inventing a metadata.json the project never had.
        yield* Effect.mapError(
          fileSystem.makeDirectory(`${root}/.sefer`, { recursive: true }),
          ioFailure,
        );
        yield* Effect.mapError(
          writeFileStringAtomic(
            fileSystem,
            `${root}/${SEFER_PROJECT_FILE}`,
            `${JSON.stringify({ name }, null, 2)}\n`,
          ),
          ioFailure,
        );
      }),

    delete: (root, confirm) =>
      Effect.gen(function* () {
        const agreed = yield* confirm(`Delete the project at ${root}? This cannot be undone.`);
        if (!agreed) {
          return yield* Effect.fail(
            new AdminError({ reason: "Refused", description: "the deletion was not confirmed" }),
          );
        }
        yield* Effect.mapError(fileSystem.remove(root, { recursive: true }), ioFailure);
      }),

    metadata,

    updateMetadata: (root, patch) =>
      Effect.gen(function* () {
        const raw = yield* rawMetadata(root);
        if (Option.isNone(raw)) {
          return yield* Effect.fail(
            new AdminError({ reason: "NotFound", description: metadataPath(root) }),
          );
        }
        yield* writeMetadata(root, { ...raw.value, ...patch });
      }),

    export: (root, format, to) =>
      format === "usfm-zip"
        ? // TODO(seam): a USFM zip needs a zip writer, and Sefer has no archive
          // dependency yet. Which one (and whether the desktop host should do it
          // in Rust instead) is a decision for whoever needs the format; until
          // then this refuses rather than writing a folder and calling it a zip.
          Effect.fail(
            new AdminError({
              reason: "Unsupported",
              description: "usfm-zip export needs an archive writer that is not chosen yet",
            }),
          )
        : Effect.as(Effect.mapError(fileSystem.copy(root, to), ioFailure), to),
  };
};

export const ProjectAdminLive: Layer.Layer<ProjectAdmin, never, FileSystem.FileSystem> =
  Layer.effect(ProjectAdmin, Effect.map(FileSystem.FileSystem, makeProjectAdmin));
