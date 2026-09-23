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
import { zipSync } from "fflate";

import { writeFileAtomic, writeFileStringAtomic } from "../fileSystem/atomic";
import { joinPath, lastSegment, parentPath } from "../fileSystem/path";
import { MANIFEST_FILE, METADATA_FILE } from "../project/discovery";
import { type BurritoMetadata, decodeBurritoMetadata } from "../resources/burrito";
import { refreshIngredientChecksums } from "../resources/checksum";
import {
  fromBurrito,
  readResourceContainer,
  type ProjectMetadata,
} from "../resources/projectMetadata";

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
  /**
   * What the project declares, from `metadata.json` or `manifest.yaml`.
   * `None` when it carries neither; `Invalid` only when a BURRITO is broken.
   */
  readonly metadata: (root: string) => Effect.Effect<Option.Option<ProjectMetadata>, AdminError>;
  /**
   * The name a `rename` recorded for a project that has no burrito to carry
   * one — `.sefer/project.json`'s `name`, and `None` when there is no such
   * file or it says nothing.
   *
   * It exists because `rename` has always WRITTEN this file and nothing has
   * ever read it: renaming a folder of loose USFM reported success and changed
   * nothing anybody could see. The burrito is still the first answer; this is
   * the second, and the folder's own name is the third.
   *
   * Never fails. A project whose private corner is unreadable is a project
   * with no recorded name, which is the ordinary case anyway.
   */
  readonly recordedName: (root: string) => Effect.Effect<Option.Option<string>>;
  /** Merges, re-validates through the schema, and refuses rather than writing something invalid. */
  readonly updateMetadata: (root: string, patch: MetadataPatch) => Effect.Effect<void, AdminError>;
  /**
   * Recomputes `checksum.md5` and `size` for the named ingredients (every one,
   * when `names` is omitted) from the files on disk, and writes the metadata
   * back through the same schema gate as every other edit. Returns the names
   * that moved — empty means nothing was written.
   *
   * A project with no `metadata.json` has no ingredients to refresh and
   * succeeds with nothing changed: the caller is a save hook, and a folder of
   * loose USFM is not an error.
   */
  readonly refreshChecksums: (
    root: string,
    names?: readonly string[],
  ) => Effect.Effect<readonly string[], AdminError>;
  /**
   * The project as a zip, in memory — the bytes `export("usfm-zip")` writes.
   *
   * Separate from `export` because a browser has nowhere to write a file the
   * person can find: the Web host hands these bytes to a download instead of
   * naming a path (see documentation/architecture/landing.md). A host with a
   * real filesystem uses `export`.
   */
  readonly archive: (root: string) => Effect.Effect<Uint8Array, AdminError>;
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

/**
 * What a shared copy of a project does NOT carry.
 *
 * `.sefer/` is Sefer's own corner — provenance, a fallback name — and it
 * describes this device's history with the project, not the project. A
 * `.sefer-tmp` sibling is an atomic write that was interrupted. `.git` is a
 * repository, which is a transfer of its own (`Remote`), not a folder to zip.
 */
const isPrivatePath = (name: string): boolean =>
  name === ".sefer" ||
  name.startsWith(".sefer/") ||
  name.includes("/.sefer/") ||
  name.endsWith(".sefer-tmp") ||
  name === ".git" ||
  name.startsWith(".git/") ||
  name.includes("/.git/");

/**
 * The burrito root a file belongs to: the nearest ancestor holding
 * `metadata.json`, and the name the file goes by inside it — which is exactly
 * the ingredient key the metadata uses.
 *
 * `None` when there is none within `depth` levels, which is the ordinary
 * answer for a folder of loose USFM. The save hook asks this about every book
 * it writes, so the walk is bounded rather than open-ended: a burrito's
 * ingredients live at the root or a folder or two below it, never further up
 * a stranger's directory tree.
 */
export const ingredientFor = (
  fileSystem: FileSystem.FileSystem,
  path: string,
  depth = 4,
): Effect.Effect<Option.Option<{ readonly root: string; readonly name: string }>> =>
  Effect.gen(function* () {
    let directory = parentPath(path);
    for (let level = 0; level < depth && directory !== "" && directory !== "/"; level += 1) {
      const present = yield* Effect.orElseSucceed(
        fileSystem.exists(joinPath(directory, METADATA_FILE)),
        () => false,
      );
      if (present) return Option.some({ root: directory, name: path.slice(directory.length + 1) });
      directory = parentPath(directory);
    }
    return Option.none();
  });

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

  /**
   * The project folder as a zip, in memory.
   *
   * Every entry is under the project's own folder name, so unzipping produces
   * the folder and not a heap of loose files in whatever directory the reader
   * was in — and so the archive imports straight back through
   * `platform/web/intake.ts`, whose `stripCommonRoot` expects exactly that
   * shape. Sefer's private files are left out (`isPrivatePath`).
   *
   * In memory rather than streamed: a whole-Bible Burrito is a few megabytes
   * of text, `fflate`'s streaming API costs a worker to use properly, and the
   * import side of the same trade already reads archives this way.
   */
  const archive = (root: string): Effect.Effect<Uint8Array, AdminError> =>
    Effect.gen(function* () {
      const names = yield* Effect.mapError(
        fileSystem.readDirectory(root, { recursive: true }),
        ioFailure,
      );
      const folder = lastSegment(root) || "project";
      const entries: Record<string, Uint8Array> = {};
      for (const name of names) {
        if (isPrivatePath(name)) continue;
        const path = joinPath(root, name);
        const info = yield* Effect.mapError(fileSystem.stat(path), ioFailure);
        if (info.type !== "File") continue;
        entries[`${folder}/${name}`] = yield* Effect.mapError(fileSystem.readFile(path), ioFailure);
      }
      if (Object.keys(entries).length === 0)
        return yield* Effect.fail(
          new AdminError({ reason: "NotFound", description: `${root} holds no files to export` }),
        );
      return yield* Effect.try({
        try: () => zipSync(entries, { level: 6 }),
        catch: (error) => new AdminError({ reason: "Io", description: String(error) }),
      });
    });

  /**
   * The BURRITO, decoded — the write paths' read.
   *
   * `rename` and `refreshChecksums` edit `metadata.json` through its schema,
   * so they need the burrito itself and not the application's view of it. Kept
   * private: nothing outside this file writes metadata.
   */
  const burrito = (root: string): Effect.Effect<Option.Option<BurritoMetadata>, AdminError> =>
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

  /**
   * What the project declares, from whichever container it uses.
   *
   * Reading is common to both formats and writing is not: `updateMetadata`
   * below still goes through the Burrito schema, because Sefer authors
   * burritos and has no business rewriting somebody's `manifest.yaml`. So this
   * door answers `ProjectMetadata` and the write door keeps its own raw read.
   *
   * A `manifest.yaml` that does not decode is NOT an error here the way a
   * broken `metadata.json` is. A burrito is Sefer's own file and a bad one is
   * a defect worth reporting; a Resource Container came from somewhere else,
   * and a project whose manifest we cannot read is still a perfectly good
   * folder of USFM that should list and open.
   */
  const metadata = (root: string): Effect.Effect<Option.Option<ProjectMetadata>, AdminError> =>
    Effect.gen(function* () {
      const raw = yield* rawMetadata(root);
      if (Option.isSome(raw)) {
        const decoded = decodeBurritoMetadata(raw.value);
        return Result.isFailure(decoded)
          ? yield* Effect.fail(
              new AdminError({ reason: "Invalid", description: decoded.failure.message }),
            )
          : Option.some(fromBurrito(decoded.success));
      }
      const path = `${root}/${MANIFEST_FILE}`;
      const present = yield* Effect.mapError(fileSystem.exists(path), ioFailure);
      if (!present) return Option.none();
      const text = yield* Effect.mapError(fileSystem.readFileString(path), ioFailure);
      const read = readResourceContainer(text);
      return Result.isFailure(read) ? Option.none() : Option.some(read.success);
    });

  return {
    rename: (root, name) =>
      Effect.gen(function* () {
        const raw = yield* rawMetadata(root);
        if (Option.isSome(raw)) {
          const current = yield* burrito(root);
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

    recordedName: (root) =>
      Effect.gen(function* () {
        const text = yield* Effect.result(
          fileSystem.readFileString(`${root}/${SEFER_PROJECT_FILE}`),
        );
        if (Result.isFailure(text)) return Option.none<string>();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text.success);
        } catch {
          return Option.none<string>();
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
          return Option.none<string>();
        // SAFETY: the guard above leaves only a plain object; `name` is read as
        // `unknown` and narrowed before it is used.
        const name = (parsed as Record<string, unknown>).name;
        return typeof name === "string" && name.trim() !== ""
          ? Option.some(name.trim())
          : Option.none<string>();
      }),

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

    refreshChecksums: (root, names) =>
      Effect.gen(function* () {
        const raw = yield* rawMetadata(root);
        if (Option.isNone(raw)) return [];
        const current = yield* burrito(root);
        if (Option.isNone(current)) return [];
        const refreshed = yield* refreshIngredientChecksums(
          current.value,
          (name) =>
            Effect.map(Effect.result(fileSystem.readFile(joinPath(root, name))), (read) =>
              Result.isFailure(read) ? Option.none() : Option.some(read.success),
            ),
          names,
        );
        if (refreshed.changed.length === 0) return [];
        yield* writeMetadata(root, { ...raw.value, ingredients: refreshed.ingredients });
        return refreshed.changed;
      }),

    archive,

    export: (root, format, to) =>
      format === "usfm-zip"
        ? Effect.gen(function* () {
            const bytes = yield* archive(root);
            // The folder someone picked may not exist yet — a copy is usually
            // saved beside things, into a folder named for the occasion.
            const parent = parentPath(to);
            if (parent !== "")
              yield* Effect.mapError(
                fileSystem.makeDirectory(parent, { recursive: true }),
                ioFailure,
              );
            yield* Effect.mapError(writeFileAtomic(fileSystem, to, bytes), ioFailure);
            return to;
          })
        : Effect.as(Effect.mapError(fileSystem.copy(root, to), ioFailure), to),
  };
};

export const ProjectAdminLive: Layer.Layer<ProjectAdmin, never, FileSystem.FileSystem> =
  Layer.effect(ProjectAdmin, Effect.map(FileSystem.FileSystem, makeProjectAdmin));
