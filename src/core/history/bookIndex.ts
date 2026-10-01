/**
 * The book-change index: one walk of a repository's history, and for every
 * commit its parents, time, author and message, and — against EACH parent —
 * the top-level books whose blob differs.
 *
 * Kept per parent because git's default per-path simplification needs exactly
 * that: a merge "TREESAME to parent p" for a book is one where the book is not
 * in the list against p. From it, any book's history is an in-memory graph
 * walk (Genesis on en_ulb in ~3 ms, identical to native `git log --
 * 01-GEN.usfm`).
 *
 * Why it exists: on the Web, isomorphic-git's `log({ filepath })` parses every
 * tree it walks and throws `UnsafeFilepathError` on an entry name git itself
 * accepts (en_ulb's 2018 root tree has `00-About_the_ULB\ULB-Intro.md`), and
 * one throw discards the whole result; and it walks the whole log for every
 * book, with no bound. Here trees are read RAW, and only their top-level
 * `*.usfm` entries are looked at, so a name nobody asked about cannot refuse
 * the walk.
 *
 * The index is DERIVED: always rebuildable from Git, never the record. It
 * records the tip it was built from, so staleness is a comparison, and an
 * extension walks only what is new.
 *
 * Pure over an `ObjectReader`: the host supplies the four reads, so the walk,
 * the simplification and the format are one module on every host. Promises,
 * not Effects, because the Web builds it in a worker where the reader is
 * isomorphic-git and nothing else.
 */

/** A book name and its blob id after the change; `null` when the commit removed it. */
export type BookChange = readonly [book: string, blob: string | null];

export interface IndexedCommit {
  readonly id: string;
  /** Empty for a root commit — and for one at a shallow boundary (`shallow`). */
  readonly parents: readonly string[];
  /** Author time, ms since the epoch. */
  readonly at: number;
  /** As the commit records them — history metadata, never proof of who typed. */
  readonly author: string;
  readonly email: string;
  readonly message: string;
  /** One list per parent, in parent order; one list against nothing for a root. */
  readonly changes: readonly (readonly BookChange[])[];
  /** Read at a shallow boundary: its parents were not local, so it is re-read once they are. */
  readonly shallow?: true;
}

const INDEX_VERSION = 2;

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

/** What the index needs of a repository, and nothing more. */
export interface ObjectReader {
  /** The commit a ref names. */
  readonly resolve: (ref: string) => Promise<string>;
  readonly commit: (id: string) => Promise<{
    readonly tree: string;
    readonly parents: readonly string[];
    readonly author: { readonly name: string; readonly email: string; readonly timestamp: number };
    readonly message: string;
  }>;
  /** A tree's RAW content: `<mode> <name>\0<20-byte id>` entries. */
  readonly tree: (id: string) => Promise<Uint8Array>;
  /** The commits at a shallow boundary; empty for a full history. */
  readonly shallow: () => Promise<ReadonlySet<string>>;
}

const decoder = new TextDecoder();
const hex = (bytes: Uint8Array): string => {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
};

/** Every entry of a raw tree, in order, read without judging any name. */
const entriesOf = function* (
  tree: Uint8Array,
): Generator<{ readonly mode: string; readonly name: string; readonly id: string }> {
  let at = 0;
  while (at < tree.length) {
    const space = tree.indexOf(0x20, at);
    const nul = tree.indexOf(0, space);
    if (space < 0 || nul < 0) return;
    yield {
      mode: decoder.decode(tree.subarray(at, space)),
      name: decoder.decode(tree.subarray(space + 1, nul)),
      id: hex(tree.subarray(nul + 1, nul + 21)),
    };
    at = nul + 21;
  }
};

/** Top-level `*.usfm` blobs of a raw tree, by name. */
const booksIn = (tree: Uint8Array): Map<string, string> => {
  const books = new Map<string, string>();
  for (const entry of entriesOf(tree))
    if (entry.mode.startsWith("100") && entry.name.toLowerCase().endsWith(".usfm"))
      books.set(entry.name, entry.id);
  return books;
};

/** The id a raw tree gives `name`, and whether it is a tree; `undefined` when absent. */
export const entryIn = (
  tree: Uint8Array,
  name: string,
): { readonly id: string; readonly tree: boolean } | undefined => {
  for (const entry of entriesOf(tree))
    if (entry.name === name)
      return { id: entry.id, tree: entry.mode === "40000" || entry.mode === "040000" };
  return undefined;
};

/** Is this repository path one the index covers: a top-level book? */
export const isIndexedBook = (path: string): boolean =>
  !path.includes("/") && path.toLowerCase().endsWith(".usfm");

const differences = (
  mine: ReadonlyMap<string, string>,
  theirs: ReadonlyMap<string, string>,
): BookChange[] => {
  const out: BookChange[] = [];
  for (const [book, blob] of mine) if (theirs.get(book) !== blob) out.push([book, blob]);
  for (const book of theirs.keys()) if (!mine.has(book)) out.push([book, null]);
  return out;
};

/** The reader, with root trees' book lists cached across one build. */
const cached = (reader: ObjectReader) => {
  const trees = new Map<string, Map<string, string>>();
  const books = async (tree: string): Promise<Map<string, string>> => {
    const held = trees.get(tree);
    if (held !== undefined) return held;
    const found = booksIn(await reader.tree(tree));
    // Bounded: a walk revisits a tree only between a commit and its parents.
    if (trees.size > 512) trees.clear();
    trees.set(tree, found);
    return found;
  };
  return { books, commit: reader.commit };
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
 * which it is doing. A commit read at a shallow boundary is read again once
 * the repository has its parents.
 */
export const buildBookIndex = async (
  reader: ObjectReader,
  options: {
    readonly ref?: string;
    readonly previous?: BookIndex | undefined;
    readonly onProgress?: (seen: number) => void;
  } = {},
): Promise<{ readonly index: BookIndex; readonly report: BuildReport }> => {
  const read = cached(reader);
  const shallow = await reader.shallow();
  const known = new Map<string, IndexedCommit>();
  for (const held of options.previous?.commits ?? [])
    if (held.shallow !== true || shallow.has(held.id)) known.set(held.id, held);

  const tip = await reader.resolve(options.ref ?? "HEAD");
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
      const parents = atBoundary ? [] : commit.parents;
      const changes: BookChange[][] = [];
      if (parents.length === 0) changes.push(differences(mine, new Map()));
      for (const parent of parents)
        changes.push(differences(mine, await read.books((await read.commit(parent)).tree)));
      entry = {
        id: next.id,
        parents,
        at: commit.author.timestamp * 1000,
        author: commit.author.name,
        email: commit.author.email,
        message: commit.message.trimEnd(),
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
const commitsById = (index: BookIndex): ReadonlyMap<string, IndexedCommit> => {
  const held = byIdOf.get(index);
  if (held !== undefined) return held;
  const made = new Map(index.commits.map((commit) => [commit.id, commit] as const));
  byIdOf.set(index, made);
  return made;
};

/** Each parent not yet seen, queued once: the step both history walks share. */
const enqueue = (
  parents: readonly string[],
  seen: Set<string>,
  byId: ReadonlyMap<string, IndexedCommit>,
  queue: IndexedCommit[],
): void => {
  for (const parent of parents) {
    if (seen.has(parent)) continue;
    seen.add(parent);
    const next = byId.get(parent);
    if (next !== undefined) queue.push(next);
  }
};

/** A commit's change to `book`, against the parent the walk followed. */
export interface BookVersion {
  readonly commit: IndexedCommit;
  /** The book's blob in this commit; `null` when the commit removed it. */
  readonly blob: string | null;
}

/**
 * One book's history, newest first, with git's default simplification: a
 * merge in which the book is unchanged against some parent follows only that
 * parent, and is not itself a change. Matches `git log -- <book>`.
 */
export const bookHistoryFrom = (index: BookIndex, book: string): readonly BookVersion[] => {
  const byId = commitsById(index);
  const changeIn = (list: readonly BookChange[]) => list.find(([name]) => name === book);
  const out: BookVersion[] = [];
  const first = byId.get(index.tip);
  if (first === undefined) return out;
  const queue = [first];
  const seen = new Set([index.tip]);
  while (queue.length > 0) {
    queue.sort((a, b) => a.at - b.at);
    const commit = queue.pop();
    if (commit === undefined) break;
    let follow = commit.parents;
    let change: BookChange | undefined;
    if (commit.parents.length === 0) change = changeIn(commit.changes[0] ?? []);
    else {
      const same = commit.parents.findIndex(
        (_, at) => changeIn(commit.changes[at] ?? []) === undefined,
      );
      if (same >= 0) follow = [commit.parents[same] ?? ""];
      else change = changeIn(commit.changes[0] ?? []);
    }
    if (change !== undefined) out.push({ commit, blob: change[1] });
    enqueue(follow, seen, byId, queue);
  }
  return out;
};

/**
 * The stored form: the index as JSON, with a version to refuse a file from a
 * different build rather than misread it. About 2.5 MB for en_ulb.
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
