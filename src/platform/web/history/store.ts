/**
 * Where the history index lives, and how the Web Git layer gets a current one.
 *
 * Stored in the app's own storage, `/sefer/history/<root>.json` — beside the
 * project, never inside it: a file in the project folder is a file Git sees,
 * and inside `.git` it would be ours in a directory that is not. It is derived
 * data, so a missing, old-format or unreadable file costs a rebuild, never a
 * wrong answer. The last one per root is also held in memory, so opening book
 * after book reads the file once.
 *
 * A current index is one whose tip is HEAD's and whose shallow boundary is the
 * repository's. Otherwise it is extended — the build walks only what is new,
 * forwards after a fetch and backwards after a deepen — in a worker where
 * there is one, and in the page where there is not.
 */
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
  /** What getting it took — the answer to "why did that history take so long". */
  readonly how: "held" | "stored" | "extended" | "built";
  readonly report?: BuildReport;
}

const held = new Map<string, BookIndex>();

/**
 * The index for the repository at `root`, current with HEAD. Call it inside
 * the repository's shared lane: the build reads `.git/objects` and must not
 * race a writer.
 */
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
  // The worker is where the build belongs; where a worker cannot start or
  // cannot reach the storage, the page builds it rather than go without.
  const built =
    typeof Worker === "function"
      ? await inWorker(request).catch(() => inPage(fs, request))
      : await inPage(fs, request);
  held.set(root, built.index);
  // A failed save costs a rebuild next session, never a wrong answer now.
  await fs.mkdir(INDEX_DIR).catch(() => undefined);
  await fs.writeFile(pathOf(root), encoder.encode(encodeIndex(built.index))).catch(() => undefined);
  return {
    index: built.index,
    how: request.previous === undefined ? "built" : "extended",
    report: built.report,
  };
};
