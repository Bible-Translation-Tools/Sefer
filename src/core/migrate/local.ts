import { Effect, FileSystem } from "effect";

import { joinPath, lastSegment } from "../fileSystem/path";
import type { BookCandidate } from "./candidate";
import { recognizeWriter } from "./writerBook";

const DEPTH = 2;

const childFolders = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<readonly string[]> =>
  Effect.gen(function* () {
    const names = yield* Effect.orElseSucceed(
      fileSystem.readDirectory(root),
      (): readonly string[] => [],
    );
    const out: string[] = [];
    for (const name of names) {
      if (name.startsWith(".") || /^\d{2,3}$/.test(name) || name === "front") continue;
      const path = joinPath(root, name);
      const info = yield* Effect.option(fileSystem.stat(path));
      if (info._tag === "Some" && info.value.type === "Directory") out.push(path);
    }
    return out;
  });

export const localCandidates = (
  fileSystem: FileSystem.FileSystem,
  root: string,
  kind: "folder" | "zip",
  name: string,
): Effect.Effect<readonly BookCandidate[]> =>
  Effect.gen(function* () {
    const found: BookCandidate[] = [];
    let level: readonly string[] = [root];
    for (let depth = 0; depth <= DEPTH && level.length > 0; depth += 1) {
      const next: string[] = [];
      for (const folder of level) {
        const project = yield* recognizeWriter(fileSystem, folder);
        if (project === undefined) {
          next.push(...(yield* childFolders(fileSystem, folder)));
          continue;
        }
        found.push({
          id: `${kind}:${folder}`,
          book: project.book,
          language: project.language.id,
          resource: project.resource,
          origin: { kind, name: folder === root ? name : lastSegment(folder), root: folder },
          hints: {},
        });
      }
      level = next;
    }
    return found;
  });
