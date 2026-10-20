import { Buffer } from "buffer";

import git from "isomorphic-git";

import type { IsomorphicFs } from "#core/fileSystem/nodeView";

Object.assign(globalThis, { Buffer });

export interface PathCommit {
  readonly id: string;
  readonly blob: string | null;
  readonly message: string;
  readonly at: number;
}

export interface PathHistoryEnd {
  readonly walked: number;
  readonly shallowBoundary: boolean;
}

interface Walked {
  readonly id: string;
  readonly tree: string;
  readonly parents: readonly string[];
  readonly message: string;
  readonly at: number;
  readonly committed: number;
}

const decoder = new TextDecoder();
const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const entryIn = (
  tree: Uint8Array,
  name: string,
): { readonly id: string; readonly tree: boolean } | undefined => {
  let at = 0;
  while (at < tree.length) {
    const space = tree.indexOf(0x20, at);
    const nul = tree.indexOf(0, space);
    if (space < 0 || nul < 0) return undefined;
    if (decoder.decode(tree.subarray(space + 1, nul)) === name) {
      const mode = decoder.decode(tree.subarray(at, space));
      return {
        id: hex(tree.subarray(nul + 1, nul + 21)),
        tree: mode === "40000" || mode === "040000",
      };
    }
    at = nul + 21;
  }
  return undefined;
};

export async function* pathHistory(
  fs: IsomorphicFs,
  dir: string,
  filepath: string,
  ref = "HEAD",
  onWalked?: (walked: number) => void,
): AsyncGenerator<PathCommit, PathHistoryEnd> {
  const cache = {};
  const parts = filepath.split("/").filter((part) => part !== "");
  const shallow = new Set(
    await fs
      .readFile(`${dir}/.git/shallow`, "utf8")
      .then((text) =>
        String(text)
          .split("\n")
          .filter((line) => line !== ""),
      )
      .catch((): string[] => []),
  );
  const blobOf = new Map<string, string | null>();
  const pathIn = async (tree: string): Promise<string | null> => {
    const held = blobOf.get(tree);
    if (held !== undefined) return held;
    let at = tree;
    let found: string | null = null;
    for (const [index, part] of parts.entries()) {
      const { object } = await git.readObject({ fs, dir, oid: at, format: "content", cache });
      if (!(object instanceof Uint8Array)) break;
      const entry = entryIn(object, part);
      if (entry === undefined || entry.tree !== index < parts.length - 1) break;
      if (index === parts.length - 1) found = entry.id;
      at = entry.id;
    }
    if (blobOf.size > 4096) blobOf.clear();
    blobOf.set(tree, found);
    return found;
  };
  const pending = new Map<string, Walked>();
  const read = async (id: string): Promise<Walked> => {
    const held = pending.get(id);
    if (held !== undefined) return held;
    const { commit } = await git.readCommit({ fs, dir, oid: id, cache });
    const walked: Walked = {
      id,
      tree: commit.tree,
      parents: commit.parent,
      message: commit.message.trimEnd(),
      at: commit.author.timestamp * 1000,
      committed: commit.committer.timestamp,
    };
    if (pending.size > 256) pending.clear();
    pending.set(id, walked);
    return walked;
  };

  const start = await git.resolveRef({ fs, dir, ref });
  const queue: Walked[] = [await read(start)];
  const seen = new Set([start]);
  let walked = 0;
  let shallowBoundary = false;
  while (queue.length > 0) {
    queue.sort((a, b) => a.committed - b.committed);
    const commit = queue.pop()!;
    pending.delete(commit.id);
    walked += 1;
    if (walked % 250 === 0) onWalked?.(walked);
    const mine = await pathIn(commit.tree);
    let follow: readonly string[] = commit.parents;
    let changed = mine !== null;
    if (shallow.has(commit.id)) {
      shallowBoundary = true;
      follow = [];
    } else if (commit.parents.length > 0) {
      changed = true;
      for (const parent of commit.parents) {
        const theirs = await pathIn((await read(parent)).tree);
        if (theirs === mine) {
          changed = false;
          follow = [parent];
          break;
        }
      }
    }
    if (changed) yield { id: commit.id, blob: mine, message: commit.message, at: commit.at };
    for (const parent of follow) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      queue.push(await read(parent));
    }
  }
  return { walked, shallowBoundary };
}

export const readBlobById = async (
  fs: IsomorphicFs,
  dir: string,
  id: string,
): Promise<Uint8Array> => (await git.readBlob({ fs, dir, oid: id })).blob;
