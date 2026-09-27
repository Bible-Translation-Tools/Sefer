/**
 * The book-change index: plan primitive 3, with 5a and 6a over it.
 *
 * One walk of the repository's history, and for every commit — its parents,
 * time, author and subject, and for EACH parent the top-level books whose blob
 * differs from it. Kept per parent because git's default per-path
 * simplification needs exactly that: a merge "TREESAME to parent p" for a book
 * is one where the book is not in the list against p. From it, any book's
 * history is an in-memory graph walk (Genesis in ~3 ms on en_ulb, identical
 * to native `git log -- 01-GEN.usfm`), and so is the split point between two
 * tips.
 *
 * The index is DERIVED: always rebuildable from Git, never the record. It
 * records the tip it was built from, so staleness is a comparison, and an
 * extension walks only what is new — see `buildBookIndex`'s `previous`.
 *
 * Pure over an `IsomorphicFs`; the same module runs in the page and in the
 * worker that builds the index off the main thread (`indexWorker.ts`).
 */

import { Buffer } from "buffer";

import git from "isomorphic-git";

import type { IsomorphicFs } from "#core/fileSystem/nodeView";

// isomorphic-git expects Node's `Buffer`; a worker has no polyfill of its own.
Object.assign(globalThis, { Buffer });

/** A book name and its blob id after the change; `null` when the commit removed it. */
export type BookChange = readonly [book: string, blob: string | null];

export interface IndexedCommit {
  readonly id: string;
  /** Empty for a root commit — and for one at a shallow boundary (`shallow`). */
  readonly parents: readonly string[];
  /** Author time, ms since the epoch. */
  readonly at: number;
  /** The author's name as the commit records it — history metadata, never proof of who typed. */
  readonly author: string;
  readonly subject: string;
  /** One list per parent, in parent order; one list against nothing for a root. */
  readonly changes: readonly (readonly BookChange[])[];
  /** Read at a shallow boundary: its parents were not local, so it is re-read once they are. */
  readonly shallow?: true;
}

const INDEX_VERSION = 1;

export interface BookIndex {
  readonly version: typeof INDEX_VERSION;
  /** The commit the index was built from. Stale when the ref no longer points here. */
  readonly tip: string;
  /** Newest first, by author time with ties in walk order. */
  readonly commits: readonly IndexedCommit[];
  /** Older history exists but is not in this repository yet. */
  readonly shallowBoundary: boolean;
}

export interface BuildReport {
  readonly commits: number;
  /** Commits taken from `previous` without reading anything. */
  readonly reused: number;
  /** Commits whose objects were read. */
  readonly read: number;
}

const decoder = new TextDecoder();
const hex = (bytes: Uint8Array): string => {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
};

/**
 * Top-level `*.usfm` blob entries of a RAW tree, `<mode> <name>\0<20-byte id>`.
 * Raw rather than `readTree`, which parses every entry and throws on names git
 * accepts (`UnsafeFilepathError` on en_ulb's 2018 `00-About_the_ULB\...`).
 */
const booksIn = (tree: Uint8Array): Map<string, string> => {
  const books = new Map<string, string>();
  let at = 0;
  while (at < tree.length) {
    const space = tree.indexOf(0x20, at);
    const nul = tree.indexOf(0, space);
    if (space < 0 || nul < 0) break;
    const mode = decoder.decode(tree.subarray(at, space));
    const name = decoder.decode(tree.subarray(space + 1, nul));
    if (mode.startsWith("100") && name.toLowerCase().endsWith(".usfm"))
      books.set(name, hex(tree.subarray(nul + 1, nul + 21)));
    at = nul + 21;
  }
  return books;
};

const differences = (
  mine: ReadonlyMap<string, string>,
  theirs: ReadonlyMap<string, string>,
): BookChange[] => {
  const out: BookChange[] = [];
  for (const [book, blob] of mine) if (theirs.get(book) !== blob) out.push([book, blob]);
  for (const book of theirs.keys()) if (!mine.has(book)) out.push([book, null]);
  return out;
};

const shallowSet = async (fs: IsomorphicFs, dir: string): Promise<Set<string>> =>
  new Set(
    await fs
      .readFile(`${dir}/.git/shallow`, "utf8")
      .then((text) =>
        String(text)
          .split("\n")
          .filter((line) => line !== ""),
      )
      .catch((): string[] => []),
  );

/** Reads what one commit needs, with the root trees' book lists cached. */
const reader = (fs: IsomorphicFs, dir: string) => {
  const cache = {};
  const trees = new Map<string, Map<string, string>>();
  const books = async (tree: string): Promise<Map<string, string>> => {
    const held = trees.get(tree);
    if (held !== undefined) return held;
    const { object } = await git.readObject({ fs, dir, oid: tree, format: "content", cache });
    const found = object instanceof Uint8Array ? booksIn(object) : new Map<string, string>();
    // Bounded: a walk revisits a tree only between a commit and its parents.
    if (trees.size > 512) trees.clear();
    trees.set(tree, found);
    return found;
  };
  const commit = async (id: string) => (await git.readCommit({ fs, dir, oid: id, cache })).commit;
  return { books, commit };
};

/**
 * The index for `ref`, reusing `previous` wherever it still describes the
 * repository.
 *
 * The walk goes newest first from the tip. A commit already in `previous` is
 * taken as it is — no object read — and its parents are followed from
 * `previous` too, so an extension after a fetch reads only the new commits,
 * and after a force-push or rebase the commits no longer reachable simply
 * never come up: the same walk covers "extend" and "rebuild" without deciding
 * which it is doing. A commit that was read at a shallow boundary is read
 * again once the repository has its parents.
 */
export const buildBookIndex = async (
  fs: IsomorphicFs,
  dir: string,
  options: {
    readonly ref?: string;
    readonly previous?: BookIndex | undefined;
    readonly onProgress?: (seen: number) => void;
  } = {},
): Promise<{ readonly index: BookIndex; readonly report: BuildReport }> => {
  const read = reader(fs, dir);
  const shallow = await shallowSet(fs, dir);
  const known = new Map<string, IndexedCommit>();
  for (const held of options.previous?.commits ?? [])
    if (held.shallow !== true || shallow.has(held.id)) known.set(held.id, held);

  const tip = await git.resolveRef({ fs, dir, ref: options.ref ?? "HEAD" });
  const out: IndexedCommit[] = [];
  const seen = new Set<string>([tip]);
  // Each queued commit carries what ordering needs; the object is read only
  // when it is taken, and only when `known` does not already have it.
  const queue: { id: string; at: number; order: number }[] = [];
  let order = 0;
  let reused = 0;
  let readCount = 0;
  let boundary = false;
  const timeOf = async (id: string): Promise<number> =>
    known.get(id)?.at ?? (await read.commit(id)).author.timestamp * 1000;
  queue.push({ id: tip, at: await timeOf(tip), order: order++ });

  while (queue.length > 0) {
    // Newest author time last, so pop() takes it; ties in the order queued.
    queue.sort((a, b) => a.at - b.at || b.order - a.order);
    const next = queue.pop();
    if (next === undefined) break;
    let entry = known.get(next.id);
    if (entry !== undefined) reused += 1;
    else {
      readCount += 1;
      const commit = await read.commit(next.id);
      const mine = await read.books(commit.tree);
      const atBoundary = shallow.has(next.id);
      const parents = atBoundary ? [] : commit.parent;
      const changes: BookChange[][] = [];
      if (parents.length === 0) changes.push(differences(mine, new Map()));
      for (const parent of parents) {
        const parentCommit = await read.commit(parent);
        changes.push(differences(mine, await read.books(parentCommit.tree)));
      }
      entry = {
        id: next.id,
        parents,
        at: commit.author.timestamp * 1000,
        author: commit.author.name,
        subject: commit.message.split("\n", 1)[0] ?? "",
        changes,
        ...(atBoundary ? { shallow: true as const } : {}),
      };
    }
    if (entry.shallow === true) boundary = true;
    out.push(entry);
    if (out.length % 256 === 0) options.onProgress?.(out.length);
    for (const parent of entry.parents) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      queue.push({ id: parent, at: await timeOf(parent), order: order++ });
    }
  }
  options.onProgress?.(out.length);
  return {
    index: { version: INDEX_VERSION, tip, commits: out, shallowBoundary: boundary },
    report: { commits: out.length, reused, read: readCount },
  };
};

/** The index's commits by id, built once per index. */
const byIdOf = new WeakMap<BookIndex, ReadonlyMap<string, IndexedCommit>>();
export const commitsById = (index: BookIndex): ReadonlyMap<string, IndexedCommit> => {
  const held = byIdOf.get(index);
  if (held !== undefined) return held;
  const made = new Map(index.commits.map((commit) => [commit.id, commit] as const));
  byIdOf.set(index, made);
  return made;
};

/**
 * One book's history, newest first, with git's default simplification: a
 * merge in which the book is unchanged against some parent follows only that
 * parent, and is not itself a change. Matches `git log -- <book>`.
 */
export const bookHistoryFrom = (index: BookIndex, book: string): readonly IndexedCommit[] => {
  const byId = commitsById(index);
  const touches = (list: readonly BookChange[]) => list.some(([name]) => name === book);
  const out: IndexedCommit[] = [];
  const first = byId.get(index.tip);
  if (first === undefined) return out;
  const queue = [first];
  const seen = new Set([index.tip]);
  while (queue.length > 0) {
    queue.sort((a, b) => a.at - b.at);
    const commit = queue.pop();
    if (commit === undefined) break;
    let follow = commit.parents;
    let changed: boolean;
    if (commit.parents.length === 0) changed = touches(commit.changes[0] ?? []);
    else {
      const same = commit.parents.findIndex((_, at) => !touches(commit.changes[at] ?? []));
      changed = same < 0;
      if (same >= 0) follow = [commit.parents[same] ?? ""];
    }
    if (changed) out.push(commit);
    for (const parent of follow) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      const next = byId.get(parent);
      if (next !== undefined) queue.push(next);
    }
  }
  return out;
};

/** Every book a commit changed against its FIRST parent — what "this commit touched" means. */
export const booksOf = (commit: IndexedCommit): readonly BookChange[] => commit.changes[0] ?? [];

/**
 * The common ancestor of two commits (primitive 6a): the newest commit both
 * reach. Two walks over the index's parent links — milliseconds, no object
 * read. `undefined` when they share no history the index holds (a shallow
 * index can say that about two commits that do share history).
 */
export const mergeBase = (index: BookIndex, a: string, b: string): IndexedCommit | undefined => {
  const byId = commitsById(index);
  const reach = new Set<string>();
  const stack = [a];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || reach.has(id)) continue;
    reach.add(id);
    for (const parent of byId.get(id)?.parents ?? []) stack.push(parent);
  }
  const start = byId.get(b);
  if (start === undefined) return undefined;
  const queue = [start];
  const seen = new Set([b]);
  while (queue.length > 0) {
    queue.sort((x, y) => x.at - y.at);
    const commit = queue.pop();
    if (commit === undefined) break;
    if (reach.has(commit.id)) return commit;
    for (const parent of commit.parents) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      const next = byId.get(parent);
      if (next !== undefined) queue.push(next);
    }
  }
  return undefined;
};

/**
 * The books that differ between two commits (primitive 5a): two root trees
 * compared, no walk and no index. Measured 42 ms on en_ulb for "since
 * 2023-01-05". The blobs are the `to` side's.
 */
export const booksChangedBetween = async (
  fs: IsomorphicFs,
  dir: string,
  from: string,
  to: string,
): Promise<readonly BookChange[]> => {
  const read = reader(fs, dir);
  const rootBooks = async (id: string) => read.books((await read.commit(id)).tree);
  const [older, newer] = await Promise.all([rootBooks(from), rootBooks(to)]);
  return differences(newer, older);
};

/** A book's blob id at a commit, or `undefined` when the commit does not have the book. */
export const blobAt = async (
  fs: IsomorphicFs,
  dir: string,
  commit: string,
  book: string,
): Promise<string | undefined> => {
  const read = reader(fs, dir);
  return (await read.books((await read.commit(commit)).tree)).get(book);
};

/**
 * The stored form: the index as JSON, with a version to refuse a file from a
 * different build rather than misread it. 2.5 MB for en_ulb, 0.7 MB gzipped.
 */
export const encodeIndex = (index: BookIndex): string => JSON.stringify(index);

export const decodeIndex = (text: string): BookIndex | undefined => {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return undefined;
    if (!("version" in value) || value.version !== INDEX_VERSION) return undefined;
    if (!("tip" in value) || typeof value.tip !== "string") return undefined;
    if (!("commits" in value) || !Array.isArray(value.commits)) return undefined;
    // SAFETY: the version is this build's and the writer is `encodeIndex`; the
    // index is derived and rebuildable, so a malformed one costs a rebuild.
    return value as BookIndex;
  } catch {
    return undefined;
  }
};
