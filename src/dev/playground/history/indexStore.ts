import git from "isomorphic-git";

import type { IsomorphicFs } from "#core/fileSystem/nodeView";
import type { ObservabilityService } from "#core/observability";

import { decodeIndex, encodeIndex, type BookIndex } from "./bookIndex";
import type { BuildRequest, WorkerMessage } from "./indexWorker";

const INDEX_DIR = "/sefer/history-playground";

const pathOf = (root: string): string => `${INDEX_DIR}/${encodeURIComponent(root)}.json`;

const encoder = new TextEncoder();

const buildInWorker = (
  request: BuildRequest,
  onProgress: (seen: number) => void,
): Promise<Extract<WorkerMessage, { kind: "built" }>> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./indexWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.kind === "progress") onProgress(message.seen);
      else {
        worker.terminate();
        if (message.kind === "built") resolve(message);
        else reject(new Error(message.error));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage(request);
  });

export interface EnsuredIndex {
  readonly index: BookIndex;
  readonly how: "stored" | "extended" | "built";
}

export const ensureIndex = async (options: {
  readonly fs: IsomorphicFs;
  readonly root: string;
  readonly observability: ObservabilityService;
  readonly onProgress?: (seen: number) => void;
}): Promise<EnsuredIndex> => {
  const { fs, root } = options;
  const op = options.observability.operation("history.index.ensure", { "history.root": root });
  try {
    const loading = op.span("history.index.load");
    const text = await fs
      .readFile(pathOf(root), "utf8")
      .then((held) => String(held))
      .catch(() => undefined);
    const stored = text === undefined ? undefined : decodeIndex(text);
    loading({ "index.bytes": text?.length ?? 0, "index.found": stored !== undefined });

    const resolving = op.span("history.index.tip");
    const tip = await git.resolveRef({ fs, dir: root, ref: "HEAD" });
    resolving();

    if (stored !== undefined && stored.tip === tip && !stored.shallowBoundary) {
      op.end("passed", { "index.how": "stored", "index.commits": stored.commits.length });
      return { index: stored, how: "stored" };
    }

    const building = op.span("history.index.build");
    const built = await buildInWorker({ kind: "build", root, previous: stored }, (seen) =>
      options.onProgress?.(seen),
    );
    building({
      "index.commits": built.report.commits,
      "index.reused": built.report.reused,
      "index.read": built.report.read,
      "worker.lock_wait_ms": Math.round(built.timings.lockWaitMs),
      "worker.pack_load_ms": Math.round(built.timings.packLoadMs),
      "worker.pack_bytes": built.timings.packBytes,
      "worker.fs_passed_through": built.timings.passedThrough,
      "worker.fs_calls": JSON.stringify(built.timings.calls),
      "worker.walk_ms": Math.round(built.timings.walkMs),
    });

    const saving = op.span("history.index.save");
    const encoded = encodeIndex(built.index);
    await fs.mkdir(INDEX_DIR).catch(() => undefined);
    await fs.writeFile(pathOf(root), encoder.encode(encoded));
    saving({ "index.bytes": encoded.length });

    const how = stored === undefined ? "built" : "extended";
    op.end("passed", { "index.how": how, "index.commits": built.index.commits.length });
    return { index: built.index, how };
  } catch (cause) {
    op.end("failed", { "history.error": cause instanceof Error ? cause.message : String(cause) });
    throw cause;
  }
};
