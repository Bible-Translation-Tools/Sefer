// projectIndex.ts
//
// What is on this device, without reading it.
//
// The landing screen needs four things per project — a name, a language, a
// book count, when it was last opened — and every one of them except the last
// costs a directory listing and a `metadata.json` parse. Doing that once per
// row on every visit is a rescan of the whole projects folder to draw a table,
// and it gets slower exactly as someone's work grows.
//
// So the answers are written down, once, at the four moments they change:
// import, create, rename and delete — plus `lastOpened` on open. The index is
// ASSUMED CORRECT; it is not a cache with an invalidation story, and nothing
// re-derives a row behind the reader's back.
//
// What keeps it honest is a repair that costs one names-only `readDirectory`
// of the projects root:
//
//   * a folder with no row is described once and added (something put it there
//     — a sync client, a copy, a previous build);
//   * a row with no folder is dropped (something took it away).
//
// A row whose folder exists is believed. Re-reading it to check would be the
// rescan this module exists to avoid, and the cost of being wrong is a stale
// name in a list until the next rename.
//
// Why here and not in `core/admin`: the index describes projects as a SET,
// which is the project module's subject. ProjectAdmin acts on one project.
//
// Why not Dexie, or IndexedDB at all: this is four fields per project in a
// folder Sefer already owns, on a port both hosts implement. A database would
// add a second storage system, a migration story and a host difference, for a
// file that is smaller than the metadata of one book.

import { Effect, FileSystem, PlatformError, Result, Schema } from "effect";

import { writeFileStringAtomic } from "../fileSystem/atomic";
import { joinPath } from "../fileSystem/path";
import { ProjectOrigin } from "./provenance";

/**
 * Sefer's own corner of the projects folder, alongside `.sefer/` inside a
 * project. A leading dot so the folder scan below can skip it by one rule
 * rather than by name, and so no project scan mistakes it for content.
 */
const PROJECT_INDEX_FILE = ".sefer/projects.json";

const Row = Schema.Struct({
  /** The project's root path — its identity in the index. */
  root: Schema.String,
  name: Schema.String,
  /** The language's NAME ("English"), or empty when the metadata declares none. */
  language: Schema.String,
  /** Its BCP-47 tag ("en"), beside the name rather than folded into it. */
  languageTag: Schema.optionalKey(Schema.String),
  books: Schema.Number,
  /** ISO-8601; absent until this device opens the project. */
  lastOpened: Schema.optionalKey(Schema.String),
  /** How it first arrived, cached from `.sefer/provenance.json`; absent for one made here. */
  from: Schema.optionalKey(ProjectOrigin),
});

export type ProjectRow = typeof Row.Type;

/**
 * Versioned from the first write. The day a field is added, a reader that
 * finds `v: 1` knows what it is looking at — and a reader that finds a version
 * it does not know treats the file as absent and repairs, which is exactly
 * what the unreadable case already does.
 *
 * `v: 2` was that day. Version 1 stored the language as the single string
 * "English (en)" and let a project with no declared language fall back to its
 * FOLDER NAME, so the table's Language column could read `small-nt`. The name
 * and the tag are two fields now, and there is no folder fallback — so every
 * v1 row is a row whose language may be wrong. Refusing the old file is how a
 * wrong value is corrected without a migration nobody can test: the repair
 * below re-describes each project from disk exactly once.
 *
 * `v: 3` is the same move for the same reason. Until now a row was described
 * by reading `metadata.json` alone, so every Resource Container — which is
 * most of what the catalogue serves, `en_ulb` included — was written down with
 * an empty name and an empty language and KEPT that way: `repairProjectIndex`
 * only describes a root it has no row for, so a project already in the index
 * would never be looked at again. Teaching the reader about `manifest.yaml`
 * fixes new rows; bumping the version is what fixes the ones already written.
 *
 * `v: 4` adds `from`, the project's first arrival (a zip, a folder, or which
 * remote). Rows written before it cannot say, so every one is described again.
 */
const INDEX_VERSION = 4;

const Index = Schema.Struct({ v: Schema.Literal(INDEX_VERSION), rows: Schema.Array(Row) });

const decodeIndex = Schema.decodeUnknownResult(Index);

const projectIndexPath = (projectsRoot: string): string =>
  joinPath(projectsRoot, PROJECT_INDEX_FILE);

/**
 * The rows on disk. Never fails: a projects folder with no index yet, an index
 * that will not parse and an index a newer build wrote all mean the same thing
 * to a reader — nothing is known — and the repair below is what fixes it. A
 * landing screen must not refuse to draw because a JSON file went bad.
 */
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

/** Rewrites the whole index, atomically. Small enough that a patch would be theatre. */
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

/**
 * Adds or replaces one row — the write every lifecycle event ends in. An
 * existing row's `lastOpened` is carried over unless the caller names one, so
 * a rename does not forget when the project was last visited.
 */
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

/** Drops a row. The folder is the caller's business — usually `ProjectAdmin.delete`. */
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

/**
 * Stamps `lastOpened`. A root with no row is ignored rather than invented: the
 * index learns about projects from the events that create them, and an open of
 * something it has never heard of is the repair's job, not this one's.
 */
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

/** `.sefer` and anything else dotted is Sefer's or the OS's, never a project. */
const isProjectFolder = (name: string): boolean => name !== "" && !name.startsWith(".");

/**
 * The index, reconciled with the folder names actually present.
 *
 * `describe` is how a folder nobody told us about becomes a row — the caller
 * supplies it because reading a project's name and language is the landing
 * screen's `summarize`, which knows about `ProjectAdmin`, and core's index
 * must not. It is called ONLY for folders with no row.
 *
 * Returns the rows to render, and writes the file only when something moved.
 */
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
