/**
 * Read-only path history for the history prototype, streamed newest first.
 *
 * Not `git.log({ filepath })`: isomorphic-git parses every tree it walks and
 * throws `UnsafeFilepathError` on an entry name git itself accepts — en_ulb's
 * 2018 root tree has `00-About_the_ULB\ULB-Intro.md` — and that one throw
 * discards the whole result. Here trees are read as raw object content and
 * only the entries on the path are looked at, so a name we never touch cannot
 * refuse the walk.
 */
import { Buffer } from "buffer";

import git from "isomorphic-git";

import type { IsomorphicFs } from "#core/fileSystem/nodeView";

Object.assign(globalThis, { Buffer });

export interface PathCommit {
  readonly id: string;
  /** The path's blob id in this commit; null when the commit deleted it. */
  readonly blob: string | null;
  readonly message: string;
  readonly at: number;
}

export interface PathHistoryEnd {
  /** Commits read from the ref, including those that did not touch the path. */
  readonly walked: number;
  /** True when the walk stopped at a shallow boundary: older history is not local. */
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

/** The object id a raw tree gives `name`, or undefined. Format: `<mode> <name>\0<20-byte id>`. */
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

/**
 * Commits that changed `filepath`, newest first, with git's default history
 * simplification: a merge whose path matches one parent follows only that
 * parent and is not itself reported. Yields as it goes; returns how far it got.
 */
export async function* pathHistory(
  fs: IsomorphicFs,
  dir: string,
  filepath: string,
  ref = "HEAD",
  /** Told the running count of commits walked, every few hundred. */
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
  // Path blob id per tree id; neighbouring commits share root trees often.
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
  // A parent is read to compare, then again when it is walked; hold it between.
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
    // Newest committer time first, as `git log` orders a walk.
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

/** One blob's bytes by object id — no tree is read, so no entry name can refuse it. */
export const readBlobById = async (
  fs: IsomorphicFs,
  dir: string,
  id: string,
): Promise<Uint8Array> => (await git.readBlob({ fs, dir, oid: id })).blob;
