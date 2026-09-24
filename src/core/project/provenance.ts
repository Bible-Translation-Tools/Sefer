// provenance.ts
//
// Where a project came from: one record per arrival, appended to
// `<root>/.sefer/provenance.json`. A zip, a folder, or a remote repository.
//
// `.sefer/` is this device's history with the project, not the project, so
// the file is never committed and never shared (`projectAdmin.ts`,
// `isPrivatePath`). It is the source of truth for "where did this come from";
// the projects index only caches the first record's answer, which is why a
// rebuilt index loses nothing.
//
// The list is append-only. The FIRST record is the project's origin; later
// ones are books brought into it afterwards.

import { Effect, FileSystem, Option, Schema, type PlatformError } from "effect";

import { writeFileStringAtomic } from "../fileSystem/atomic";
import { joinPath, lastSegment, parentPath } from "../fileSystem/path";

const PROVENANCE_PATH = ".sefer/provenance.json";

/** A zip or a folder, through the staged import in `src/core/resources/import.ts`. */
export interface LocalArrival {
  readonly via: "zip" | "folder";
  readonly stageId: string;
  /** The paths the user picked: a folder path, or the zip or folder's name on the web. */
  readonly sources: readonly string[];
  readonly classification: string;
  /** Book paths relative to the project root, as committed. */
  readonly books: readonly string[];
}

/** A clone. */
export interface RemoteArrival {
  readonly via: "remote";
  /** The URL as the person saw it — the catalogue's `repo_url`, or what they typed — not the proxy's. */
  readonly url: string;
  /** The catalogue row's id (`owner/repo`) when the clone started from Find. */
  readonly catalogueId?: string;
}

export type Arrival = LocalArrival | RemoteArrival;

/** What the index keeps of the first arrival: enough to say "From …" on a row. */
export const ProjectOrigin = Schema.Struct({
  via: Schema.Literals(["zip", "folder", "remote"]),
  /** The zip's or folder's name, or `owner/repo` for a remote. */
  label: Schema.String,
});

export type ProjectOrigin = typeof ProjectOrigin.Type;

const readList = (
  fileSystem: FileSystem.FileSystem,
  path: string,
): Effect.Effect<readonly unknown[]> =>
  Effect.orElseSucceed(
    Effect.map(fileSystem.readFileString(path), (text): readonly unknown[] => {
      try {
        const parsed: unknown = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }),
    (): readonly unknown[] => [],
  );

/**
 * Appends one arrival, stamped with the host clock. Past records are carried
 * as `unknown`: this only ever appends, so nothing needs to trust their shape.
 */
export const appendArrival = (
  fileSystem: FileSystem.FileSystem,
  root: string,
  arrival: Arrival,
): Effect.Effect<void, PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const path = joinPath(root, PROVENANCE_PATH);
    const existing = yield* readList(fileSystem, path);
    const record = { ...arrival, at: new Date(Date.now()).toISOString() };
    yield* fileSystem.makeDirectory(parentPath(path), { recursive: true });
    yield* writeFileStringAtomic(
      fileSystem,
      path,
      `${JSON.stringify([...existing, record], undefined, 2)}\n`,
    );
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

/** `owner/repo` from a clone URL, or the URL itself when it has no such path. */
const repoOf = (url: string): string => {
  try {
    const parts = new URL(url).pathname
      .replace(/\.git$/u, "")
      .split("/")
      .filter(Boolean);
    return parts.length >= 2 ? parts.slice(-2).join("/") : url;
  } catch {
    return url;
  }
};

/**
 * One record as the index keeps it. A record written before `via` existed is
 * a staged import, and its source names say which kind: a `.zip` suffix is a
 * zip, anything else a folder.
 */
const originOf = (record: unknown): Option.Option<ProjectOrigin> => {
  if (!isRecord(record)) return Option.none();
  if (record.via === "remote" && typeof record.url === "string") {
    const id = typeof record.catalogueId === "string" ? record.catalogueId : repoOf(record.url);
    return Option.some({ via: "remote", label: id });
  }
  const first = strings(record.sources).at(0);
  if (first === undefined) return Option.none();
  const via =
    record.via === "zip" || record.via === "folder"
      ? record.via
      : first.toLowerCase().endsWith(".zip")
        ? "zip"
        : "folder";
  return Option.some({ via, label: lastSegment(first) || first });
};

/** How the project first arrived, or `None` for one Sefer made or never recorded. */
export const firstArrival = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<Option.Option<ProjectOrigin>> =>
  Effect.map(readList(fileSystem, joinPath(root, PROVENANCE_PATH)), (list) =>
    list.length === 0 ? Option.none() : originOf(list[0]),
  );
