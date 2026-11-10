/**
 * bttwriter, the kitchen's BTT Writer history reader and replayer, reached
 * through a service so it loads only when the migration needs it (163 KB of
 * wasm nobody else pays for). The walk, the template, the clock fix and the
 * pack writer are its own; Sefer hands it git objects and writes what it
 * returns.
 */
import type * as Bttwriter from "@wycliffeassociates/scripture-kitchen/bttwriter";
import { Context, Effect, type FileSystem, Option } from "effect";

import { joinPath } from "../fileSystem/path";
import { EngineLoadError } from "../galley/galley";
import type { GitService, Repo } from "../git/git";

export type BttWriter = typeof Bttwriter;
export type {
  Replayed,
  Signature,
  WriterHistory,
} from "@wycliffeassociates/scripture-kitchen/bttwriter";

export interface WriterEngineService {
  /** The started module; the first call imports and starts it, later calls share that. */
  readonly load: Effect.Effect<BttWriter, EngineLoadError>;
}

export class WriterEngine extends Context.Service<WriterEngine, WriterEngineService>()(
  "WriterEngine",
) {}

/** A `WriterEngineService` over a host's `start`, which imports the module and starts its wasm. */
export const writerEngine = (start: () => Promise<BttWriter>): WriterEngineService => {
  let started: Promise<BttWriter> | undefined;
  const once = (): Promise<BttWriter> => {
    started ??= start().catch((cause: unknown) => {
      started = undefined;
      throw cause;
    });
    return started;
  };
  return {
    load: Effect.tryPromise({
      try: once,
      catch: (cause) => new EngineLoadError({ reason: "cannot start bttwriter", cause }),
    }),
  };
};

/**
 * One Writer book's files as USFM with no history and no git: bttwriter's
 * `stitch`, the template its replay renders each save with. `title` stands in
 * when `front/title.txt` says nothing (bttwriter's default is canon's English
 * name).
 */
export const stitchBook = (
  files: ReadonlyMap<string, string>,
  book: string,
  title?: string,
): Effect.Effect<string, EngineLoadError, WriterEngine> =>
  Effect.gen(function* () {
    const bttwriter = yield* (yield* WriterEngine).load;
    return bttwriter.stitch(files, book, title === undefined ? {} : { title });
  });

/**
 * bttwriter's `ObjectSource` over the Git port: HEAD, the shallow list (read
 * off `.git/shallow`, as isomorphic-git and libgit2 both keep it) and objects
 * by id, one reader for the whole walk.
 */
export const objectSource = (
  git: GitService,
  fileSystem: FileSystem.FileSystem,
  repo: Repo,
): Bttwriter.ObjectSource => {
  const reader = git.objectReader(repo);
  return {
    head: () =>
      Effect.runPromise(
        Effect.map(
          Effect.orElseSucceed(git.resolve(repo, "HEAD"), () => Option.none<string>()),
          Option.getOrUndefined,
        ),
      ),
    shallow: () =>
      Effect.runPromise(
        Effect.orElseSucceed(
          Effect.map(fileSystem.readFileString(joinPath(repo.root, ".git/shallow")), (text) =>
            text
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line !== ""),
          ),
          (): string[] => [],
        ),
      ),
    read: (ids) =>
      Effect.runPromise(reader(ids)).then(
        (objects) =>
          new Map(
            [...objects].map(([id, object]) => [id, { type: object.type, bytes: object.bytes }]),
          ),
      ),
  };
};
