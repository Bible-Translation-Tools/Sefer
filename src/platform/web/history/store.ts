import git from "isomorphic-git";

import type { IsomorphicFs } from "#core/fileSystem/nodeView";
import {
  buildBookIndex,
  decodeIndex,
  encodeIndex,
  isCurrent,
  type BookIndex,
  type BuildReport,
} from "#core/history/bookIndex";

import { packView } from "./packView";
import { objectReader } from "./reader";
import type { BuildRequest, WorkerMessage } from "./worker";

const INDEX_DIR = "/sefer/history";

const pathOf = (root: string): string => `${INDEX_DIR}/${encodeURIComponent(root)}.json`;

const encoder = new TextEncoder();

const inWorker = (request: BuildRequest): Promise<{ index: BookIndex; report: BuildReport }> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      worker.terminate();
      const message = event.data;
      if (message.kind === "built") resolve(message);
      else reject(new Error(message.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage(request);
  });

const inPage = (fs: IsomorphicFs, request: BuildRequest) =>
  buildBookIndex(objectReader(packView(fs, request.root).fs, request.root), {
    previous: request.previous,
  });

export interface EnsuredIndex {
  readonly index: BookIndex;
  readonly how: "held" | "stored" | "extended" | "built";
  readonly report?: BuildReport;
}

const held = new Map<string, BookIndex>();

export const ensureBookIndex = async (fs: IsomorphicFs, root: string): Promise<EnsuredIndex> => {
  const tip = await git.resolveRef({ fs, dir: root, ref: "HEAD" });
  const shallow = await objectReader(fs, root).shallow();
  const inMemory = held.get(root);
  if (inMemory !== undefined && isCurrent(inMemory, tip, shallow))
    return { index: inMemory, how: "held" };

  const text = await fs
    .readFile(pathOf(root), "utf8")
    .then((found) => String(found))
    .catch(() => undefined);
  const stored = text === undefined ? undefined : decodeIndex(text);
  if (stored !== undefined && isCurrent(stored, tip, shallow)) {
    held.set(root, stored);
    return { index: stored, how: "stored" };
  }

  const request: BuildRequest = { root, previous: stored ?? inMemory };
  const built =
    typeof Worker === "function"
      ? await inWorker(request).catch(() => inPage(fs, request))
      : await inPage(fs, request);
  held.set(root, built.index);
  await fs.mkdir(INDEX_DIR).catch(() => undefined);
  await fs.writeFile(pathOf(root), encoder.encode(encodeIndex(built.index))).catch(() => undefined);
  return {
    index: built.index,
    how: request.previous === undefined ? "built" : "extended",
    report: built.report,
  };
};
