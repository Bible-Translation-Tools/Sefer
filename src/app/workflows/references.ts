import { decode } from "@sefer/text/source";
import { Effect, FileSystem, Result } from "effect";

import { ProjectAnalysis, type ReferenceText } from "#core/analysis/projectAnalysis";
import { joinPath } from "#core/fileSystem/path";
import { Library, ROLES, type Resource } from "#core/resources/library";

import { holdsEngineBooks } from "../kinds/table";

export interface BoundReferences {
  readonly resources: readonly Resource[];
  readonly ids: readonly string[];
}

export const EMPTY: BoundReferences = { resources: [], ids: [] };

const isUsfm = (path: string): boolean => path.toLowerCase().endsWith(".usfm");

const booksOf = (
  fileSystem: FileSystem.FileSystem,
  resource: Resource,
): Effect.Effect<readonly ReferenceText[]> =>
  Effect.gen(function* () {
    const entries = yield* Effect.orElseSucceed(
      fileSystem.readDirectory(resource.root, { recursive: true }),
      (): readonly string[] => [],
    );
    const out: ReferenceText[] = [];
    for (const entry of entries.filter(isUsfm).sort()) {
      const path = joinPath(resource.root, entry);
      const read = yield* Effect.result(fileSystem.readFile(path));
      if (Result.isFailure(read)) continue;
      const source = decode(read.success);
      if (Result.isFailure(source)) continue;
      out.push({ id: path, text: source.success.text });
    }
    return out;
  });

export const bindReferences = (
  projectRoot: string,
  options?: {
    readonly fresh?: boolean;
  },
): Effect.Effect<BoundReferences, never, Library | ProjectAnalysis | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const library = yield* Library;
    const analysis = yield* ProjectAnalysis;
    const fileSystem = yield* FileSystem.FileSystem;

    const sources = yield* library.resolve(projectRoot, ROLES.source);
    const references = yield* library.resolve(projectRoot, ROLES.reference);
    const seen = new Set<string>();
    const resources: Resource[] = [];
    for (const resource of [...sources, ...references]) {
      if (seen.has(resource.id) || !holdsEngineBooks(resource)) continue;
      seen.add(resource.id);
      resources.push(resource);
    }
    if (resources.length === 0) {
      yield* analysis.attachReferences([]);
      return EMPTY;
    }

    const books: ReferenceText[] = [];
    for (const resource of resources) books.push(...(yield* booksOf(fileSystem, resource)));
    if (options?.fresh === true) yield* analysis.attachReferences([]);
    const ids = yield* analysis.attachReferences(books);
    return { resources, ids };
  });
