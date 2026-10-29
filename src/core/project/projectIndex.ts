import { Effect, FileSystem, PlatformError, Result, Schema } from "effect";

import { writeFileStringAtomic } from "../fileSystem/atomic";
import { joinPath } from "../fileSystem/path";
import { ProjectOrigin } from "./provenance";

const PROJECT_INDEX_FILE = ".sefer/projects.json";

const Row = Schema.Struct({
  root: Schema.String,
  name: Schema.String,
  language: Schema.String,
  languageTag: Schema.optionalKey(Schema.String),
  books: Schema.Number,
  lastOpened: Schema.optionalKey(Schema.String),
  from: Schema.optionalKey(ProjectOrigin),
  /** `sourceKey` of each remote the project tracks now (origin, and its own copy if any). */
  remotes: Schema.optionalKey(Schema.Array(Schema.String)),
});

export type ProjectRow = typeof Row.Type;

/**
 * 5 added `remotes`. An index of an older version reads as empty, and
 * `repairProjectIndex` then describes every project folder afresh, so each
 * row gains its remotes once, on the first listing after the update.
 */
const INDEX_VERSION = 5;

const Index = Schema.Struct({ v: Schema.Literal(INDEX_VERSION), rows: Schema.Array(Row) });

const decodeIndex = Schema.decodeUnknownResult(Index);

const projectIndexPath = (projectsRoot: string): string =>
  joinPath(projectsRoot, PROJECT_INDEX_FILE);

const readProjectIndex = (
  fileSystem: FileSystem.FileSystem,
  projectsRoot: string,
): Effect.Effect<readonly ProjectRow[]> =>
  Effect.gen(function* () {
    const text = yield* Effect.result(fileSystem.readFileString(projectIndexPath(projectsRoot)));
    if (Result.isFailure(text)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.success);
    } catch {
      return [];
    }
    const decoded = decodeIndex(parsed);
    return Result.isFailure(decoded) ? [] : decoded.success.rows;
  });

const writeProjectIndex = (
  fileSystem: FileSystem.FileSystem,
  projectsRoot: string,
  rows: readonly ProjectRow[],
): Effect.Effect<void, PlatformError.PlatformError> =>
  Effect.flatMap(
    fileSystem.makeDirectory(joinPath(projectsRoot, ".sefer"), { recursive: true }),
    () =>
      writeFileStringAtomic(
        fileSystem,
        projectIndexPath(projectsRoot),
        `${JSON.stringify({ v: INDEX_VERSION, rows }, null, 2)}\n`,
      ),
  );

const withoutRoot = (rows: readonly ProjectRow[], root: string): ProjectRow[] =>
  rows.filter((row) => row.root !== root);

export const recordProject = (
  fileSystem: FileSystem.FileSystem,
  projectsRoot: string,
  row: ProjectRow,
): Effect.Effect<void, PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const rows = yield* readProjectIndex(fileSystem, projectsRoot);
    const existing = rows.find((held) => held.root === row.root);
    const merged: ProjectRow =
      row.lastOpened === undefined && existing?.lastOpened !== undefined
        ? { ...row, lastOpened: existing.lastOpened }
        : row;
    yield* writeProjectIndex(fileSystem, projectsRoot, [...withoutRoot(rows, row.root), merged]);
  });

/** The project already tracking this repository, by any of its remotes. */
export const projectTracking = (
  fileSystem: FileSystem.FileSystem,
  projectsRoot: string,
  key: string,
): Effect.Effect<ProjectRow | undefined> =>
  Effect.map(readProjectIndex(fileSystem, projectsRoot), (rows) =>
    rows.find((row) => row.remotes?.includes(key) === true),
  );

/** Rewrites one row's remotes; nothing when the root has no row (a source text, say). */
export const noteRemotes = (
  fileSystem: FileSystem.FileSystem,
  projectsRoot: string,
  root: string,
  remotes: readonly string[],
): Effect.Effect<void, PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const rows = yield* readProjectIndex(fileSystem, projectsRoot);
    const existing = rows.find((row) => row.root === root);
    if (existing === undefined) return;
    if (
      existing.remotes?.length === remotes.length &&
      remotes.every((key) => existing.remotes?.includes(key) === true)
    )
      return;
    yield* writeProjectIndex(fileSystem, projectsRoot, [
      ...withoutRoot(rows, root),
      { ...existing, remotes },
    ]);
  });

export const forgetProject = (
  fileSystem: FileSystem.FileSystem,
  projectsRoot: string,
  root: string,
): Effect.Effect<void, PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const rows = yield* readProjectIndex(fileSystem, projectsRoot);
    if (!rows.some((row) => row.root === root)) return;
    yield* writeProjectIndex(fileSystem, projectsRoot, withoutRoot(rows, root));
  });

export const touchProject = (
  fileSystem: FileSystem.FileSystem,
  projectsRoot: string,
  root: string,
  at: string,
): Effect.Effect<void, PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const rows = yield* readProjectIndex(fileSystem, projectsRoot);
    const existing = rows.find((row) => row.root === root);
    if (existing === undefined) return;
    yield* writeProjectIndex(fileSystem, projectsRoot, [
      ...withoutRoot(rows, root),
      { ...existing, lastOpened: at },
    ]);
  });

const isProjectFolder = (name: string): boolean => name !== "" && !name.startsWith(".");

export const repairProjectIndex = <E, R>(
  fileSystem: FileSystem.FileSystem,
  projectsRoot: string,
  describe: (root: string) => Effect.Effect<ProjectRow, E, R>,
): Effect.Effect<readonly ProjectRow[], E, R | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const rows = yield* readProjectIndex(fileSystem, projectsRoot);
    const names = yield* Effect.orElseSucceed(
      fileSystem.readDirectory(projectsRoot),
      (): readonly string[] => [],
    );
    const present = new Set(
      names.filter(isProjectFolder).map((name) => joinPath(projectsRoot, name)),
    );

    const kept = rows.filter((row) => present.has(row.root));
    const known = new Set(kept.map((row) => row.root));
    const added: ProjectRow[] = [];
    for (const root of present) {
      if (known.has(root)) continue;
      added.push(yield* describe(root));
    }

    const repaired = [...kept, ...added];
    if (added.length > 0 || kept.length !== rows.length)
      yield* Effect.ignore(writeProjectIndex(fileSystem, projectsRoot, repaired));
    return repaired;
  });
