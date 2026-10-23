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
import { PROJECT_STATE_FILE, updateProjectState } from "../project/projectState";
import { type BurritoMetadata, decodeBurritoMetadata } from "../resources/burrito";
import { refreshIngredientChecksums } from "../resources/checksum";
import {
  fromBurrito,
  readResourceContainer,
  type ProjectMetadata,
} from "../resources/projectMetadata";

const SEFER_PROJECT_FILE = PROJECT_STATE_FILE;

export type ExportFormat = "burrito" | "usfm-zip";

export type AdminFailureReason = "NotFound" | "Invalid" | "Refused" | "Unsupported" | "Io";

export class AdminError extends Data.TaggedError("AdminError")<{
  readonly reason: AdminFailureReason;
  readonly description?: string | undefined;
}> {}

export type Confirm = (message: string) => Effect.Effect<boolean>;

export type MetadataPatch = Partial<BurritoMetadata>;

export interface ProjectAdminService {
  readonly rename: (root: string, name: string) => Effect.Effect<void, AdminError>;
  readonly delete: (root: string, confirm: Confirm) => Effect.Effect<void, AdminError>;
  readonly metadata: (root: string) => Effect.Effect<Option.Option<ProjectMetadata>, AdminError>;
  readonly recordedName: (root: string) => Effect.Effect<Option.Option<string>>;
  readonly updateMetadata: (root: string, patch: MetadataPatch) => Effect.Effect<void, AdminError>;
  readonly refreshChecksums: (
    root: string,
    names?: readonly string[],
  ) => Effect.Effect<readonly string[], AdminError>;
  readonly archive: (root: string) => Effect.Effect<Uint8Array, AdminError>;
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

const isPrivatePath = (name: string): boolean =>
  name === ".sefer" ||
  name.startsWith(".sefer/") ||
  name.includes("/.sefer/") ||
  name.endsWith(".sefer-tmp") ||
  name === ".git" ||
  name.startsWith(".git/") ||
  name.includes("/.git/");

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
      // SAFETY: the check above rules out null, arrays and primitives, so what remains of a JSON.parse result is a plain object with string keys.
      return Option.some({ ...(parsed as Record<string, unknown>) });
    });

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
        yield* Effect.mapError(updateProjectState(fileSystem, root, { name }), ioFailure);
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
        // SAFETY: the guard above leaves only a plain object; `name` is read as `unknown` and narrowed before it is used.
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
