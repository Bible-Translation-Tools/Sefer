import { Effect, FileSystem, Option, Schema, type PlatformError } from "effect";

import { writeFileStringAtomic } from "../fileSystem/atomic";
import { joinPath, lastSegment, parentPath } from "../fileSystem/path";

const PROVENANCE_PATH = ".sefer/provenance.json";

export interface LocalArrival {
  readonly via: "zip" | "folder";
  readonly stageId: string;
  readonly sources: readonly string[];
  readonly classification: string;
  readonly books: readonly string[];
}

export interface RemoteArrival {
  readonly via: "remote";
  readonly url: string;
  readonly catalogueId?: string;
}

export type Arrival = LocalArrival | RemoteArrival;

export const ProjectOrigin = Schema.Struct({
  via: Schema.Literals(["zip", "folder", "remote"]),
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

const viaFromName = (name: string): "zip" | "folder" =>
  name.toLowerCase().endsWith(".zip") ? "zip" : "folder";

const originOf = (record: unknown): Option.Option<ProjectOrigin> => {
  if (!isRecord(record)) return Option.none();
  if (record.via === "remote" && typeof record.url === "string") {
    const id = typeof record.catalogueId === "string" ? record.catalogueId : repoOf(record.url);
    return Option.some({ via: "remote", label: id });
  }
  const first = strings(record.sources).at(0);
  if (first === undefined) return Option.none();
  const via = record.via === "zip" || record.via === "folder" ? record.via : viaFromName(first);
  return Option.some({ via, label: lastSegment(first) || first });
};

export const firstArrival = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<Option.Option<ProjectOrigin>> =>
  Effect.map(readList(fileSystem, joinPath(root, PROVENANCE_PATH)), (list) =>
    list.length === 0 ? Option.none() : originOf(list[0]),
  );
