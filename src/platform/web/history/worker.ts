/**
 * The history index, built off the main thread.
 *
 * Building en_ulb's index is a few seconds of inflating and parsing, and a
 * page that does it cannot scroll. A dedicated worker has the same origin and
 * so the same OPFS: it opens the filesystem itself, reads the repository
 * through the pack view, and posts the index back.
 *
 * It takes NO lock. The page asks for it from inside the repository's shared
 * lane and holds that lane until the answer arrives, so no writer runs while
 * it reads; a lock of its own would queue behind a writer that is itself
 * waiting on the page.
 */
import { Effect, FileSystem } from "effect";

import { nodeFsView } from "#core/fileSystem/nodeView";
import { buildBookIndex, type BookIndex, type BuildReport } from "#core/history/bookIndex";

import { OpfsFileSystemLive } from "../fileSystem";
import { packView } from "./packView";
import { objectReader } from "./reader";

export interface BuildRequest {
  readonly root: string;
  readonly previous?: BookIndex | undefined;
}

export type WorkerMessage =
  | { readonly kind: "built"; readonly index: BookIndex; readonly report: BuildReport }
  | { readonly kind: "failed"; readonly error: string };

const build = async (request: BuildRequest): Promise<WorkerMessage> => {
  const fileSystem = await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        return yield* FileSystem.FileSystem;
      }),
      OpfsFileSystemLive,
    ),
  );
  const view = packView(nodeFsView(fileSystem, Effect.runPromise), request.root);
  const { index, report } = await buildBookIndex(objectReader(view.fs, request.root), {
    previous: request.previous,
  });
  return { kind: "built", index, report };
};

self.onmessage = (event: MessageEvent<BuildRequest>) => {
  build(event.data)
    .then((message) => self.postMessage(message))
    .catch((cause: unknown) =>
      self.postMessage({
        kind: "failed",
        error: cause instanceof Error ? cause.message : String(cause),
      } satisfies WorkerMessage),
    );
};
