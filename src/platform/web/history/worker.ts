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
