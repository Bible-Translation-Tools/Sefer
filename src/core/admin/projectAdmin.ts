import {
  edit,
  fingerprint,
  read as readManifestBytes,
  type BurritoMetadata,
  type ManifestFinding,
} from "@wycliffeassociates/scripture-kitchen/bento";
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
import { METADATA_FILE, readManifest } from "../project/discovery";
import { PROJECT_STATE_FILE, updateProjectState } from "../project/projectState";
import { fromManifest, unreadable, type ProjectMetadata } from "../resources/projectMetadata";

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

/**
 * Left out of an export: Sefer's own folder, and of the repository only what is this device's
 * (hooks, logs, locks). The history and the remotes go along, so a project handed over as a zip
 * is the same project to the next device: same versions, same shared project.
 */
const isPrivatePath = (name: string): boolean =>
  name === ".sefer" ||
  name.startsWith(".sefer/") ||
  name.includes("/.sefer/") ||
  name.endsWith(".sefer-tmp") ||
  name.includes("/.git/") ||
  name.startsWith(".git/hooks/") ||
  name.startsWith(".git/logs/") ||
  (name.startsWith(".git/") && name.endsWith(".lock"));

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

  const shapeFindings = (findings: readonly ManifestFinding[]): ReadonlySet<string> =>
    new Set(
      findings
        .filter((finding) => finding.severity === "error" || finding.check === "manifest-valid")
        .map((finding) => `${finding.at ?? ""} ${finding.message}`),
    );

  /**
   * Writes `value` as the project's metadata.json, refused when bento finds it
   * unreadable or finds a shape problem (`manifest-valid`) the file did not
   * already have: an older project's own warnings never block an edit.
   */
  const writeMetadata = (
    root: string,
    value: Record<string, unknown>,
    before: Uint8Array | undefined,
  ): Effect.Effect<void, AdminError> => {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    const after = readManifestBytes(METADATA_FILE, new TextEncoder().encode(text));
    const had =
      before === undefined
        ? new Set<string>()
        : shapeFindings(readManifestBytes(METADATA_FILE, before).findings);
    const fresh = after.findings.filter(
      (finding) =>
        (finding.severity === "error" || finding.check === "manifest-valid") &&
        !had.has(`${finding.at ?? ""} ${finding.message}`),
    );
    if (fresh.length > 0)
      return Effect.fail(
        new AdminError({
          reason: "Invalid",
          description: `${METADATA_FILE} would no longer be Scripture Burrito: ${fresh.map((finding) => finding.message).join(" ")}`,
        }),
      );
    return Effect.mapError(writeFileStringAtomic(fileSystem, metadataPath(root), text), ioFailure);
  };

  const metadataBytes = (root: string): Effect.Effect<Option.Option<Uint8Array>, AdminError> =>
    Effect.gen(function* () {
      const path = metadataPath(root);
      if (!(yield* Effect.mapError(fileSystem.exists(path), ioFailure))) return Option.none();
      return Option.some(yield* Effect.mapError(fileSystem.readFile(path), ioFailure));
    });

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

  const metadata = (root: string): Effect.Effect<Option.Option<ProjectMetadata>, AdminError> =>
    Effect.gen(function* () {
      const file = yield* Effect.mapError(readManifest(fileSystem, root), ioFailure);
      if (Option.isNone(file)) return Option.none();
      const { name, read } = file.value;
      if (unreadable(read)) {
        if (read.detail?.format === "rc" || name !== METADATA_FILE) return Option.none();
        return yield* Effect.fail(
          new AdminError({
            reason: "Invalid",
            description: read.findings.map((finding) => finding.message).join(" "),
          }),
        );
      }
      return Option.fromUndefinedOr(fromManifest(read));
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
        const before = Option.getOrUndefined(yield* metadataBytes(root));
        yield* writeMetadata(root, { ...raw.value, ...patch }, before);
      }),

    refreshChecksums: (root, names) =>
      Effect.gen(function* () {
        const bytes = yield* metadataBytes(root);
        if (Option.isNone(bytes)) return [];
        const read = readManifestBytes(METADATA_FILE, bytes.value);
        if (read.detail?.format !== "burrito" || unreadable(read)) return [];
        const ingredients = read.detail.document.ingredients ?? {};
        const checksums = new Map<string, Uint8Array>();
        const changed: string[] = [];
        for (const name of names ?? Object.keys(ingredients)) {
          const ingredient = ingredients[name];
          if (ingredient === undefined) continue;
          const file = yield* Effect.result(fileSystem.readFile(joinPath(root, name)));
          if (Result.isFailure(file)) continue;
          checksums.set(name, file.success);
          const fresh = fingerprint(file.success);
          if (ingredient.checksum?.md5 !== fresh.md5 || ingredient.size !== fresh.size)
            changed.push(name);
        }
        if (changed.length === 0) return [];
        const edited = yield* Effect.try({
          try: () => edit(new Map([[METADATA_FILE, bytes.value]]), { checksums }),
          catch: (error) => new AdminError({ reason: "Invalid", description: String(error) }),
        });
        const next = edited.files.get(METADATA_FILE);
        if (next === undefined) return [];
        yield* Effect.mapError(writeFileAtomic(fileSystem, metadataPath(root), next), ioFailure);
        return changed;
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
