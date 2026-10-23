/**
 * On the Web, isomorphic-git's `log({ filepath })` throws `UnsafeFilepathError` on
 * an entry name git itself accepts (en_ulb), so history is walked from raw
 * trees. Genesis on en_ulb is ~3 ms from this index.
 */

export type BookChange = readonly [book: string, blob: string | null];

export interface IndexedCommit {
  readonly id: string;
  readonly parents: readonly string[];
  readonly at: number;
  readonly author: string;
  readonly email: string;
  readonly message: string;
  readonly changes: readonly (readonly BookChange[])[];
  readonly shallow?: true;
}

const INDEX_VERSION = 3;

export interface BookIndex {
  readonly version: typeof INDEX_VERSION;
  readonly tip: string;
  readonly commits: readonly IndexedCommit[];
  readonly shallowBoundary: boolean;
  readonly boundary: readonly string[];
}

export const isCurrent = (index: BookIndex, tip: string, shallow: ReadonlySet<string>): boolean =>
  index.tip === tip &&
  index.boundary.length === shallow.size &&
  index.boundary.every((id) => shallow.has(id));

export interface BuildReport {
  readonly commits: number;
  readonly reused: number;
  readonly read: number;
}

export interface ObjectReader {
  readonly resolve: (ref: string) => Promise<string>;
  readonly commit: (id: string) => Promise<{
    readonly tree: string;
    readonly parents: readonly string[];
    readonly author: { readonly name: string; readonly email: string; readonly timestamp: number };
    readonly message: string;
  }>;
  readonly tree: (id: string) => Promise<Uint8Array>;
  readonly shallow: () => Promise<ReadonlySet<string>>;
}

const decoder = new TextDecoder();
const hex = (bytes: Uint8Array): string => {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
};

export const entriesOf = function* (
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

const booksIn = (tree: Uint8Array): Map<string, string> => {
  const books = new Map<string, string>();
  for (const entry of entriesOf(tree))
    if (entry.mode.startsWith("100") && entry.name.toLowerCase().endsWith(".usfm"))
      books.set(entry.name, entry.id);
  return books;
};

export const entryIn = (
  tree: Uint8Array,
  name: string,
): { readonly id: string; readonly tree: boolean } | undefined => {
  for (const entry of entriesOf(tree))
    if (entry.name === name)
      return { id: entry.id, tree: entry.mode === "40000" || entry.mode === "040000" };
  return undefined;
};

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

const cached = (reader: ObjectReader) => {
  const trees = new Map<string, Map<string, string>>();
  const books = async (tree: string): Promise<Map<string, string>> => {
    const held = trees.get(tree);
    if (held !== undefined) return held;
    const found = booksIn(await reader.tree(tree));
    if (trees.size > 512) trees.clear();
    trees.set(tree, found);
    return found;
  };
  return { books, commit: reader.commit };
};

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
  const queue: { id: string; at: number; order: number }[] = [];
  let order = 0;
  let reused = 0;
  let readCount = 0;
  let boundary = false;
  const timeOf = async (id: string): Promise<number> =>
    known.get(id)?.at ?? (await read.commit(id)).author.timestamp * 1000;
  queue.push({ id: tip, at: await timeOf(tip), order: order++ });

  while (queue.length > 0) {
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
    index: {
      version: INDEX_VERSION,
      tip,
      commits: out,
      shallowBoundary: boundary,
      boundary: out
        .filter((commit) => commit.shallow === true)
        .map((commit) => commit.id)
        .sort(),
    },
    report: { commits: out.length, reused, read: readCount },
  };
};

const byIdOf = new WeakMap<BookIndex, ReadonlyMap<string, IndexedCommit>>();
const commitsById = (index: BookIndex): ReadonlyMap<string, IndexedCommit> => {
  const held = byIdOf.get(index);
  if (held !== undefined) return held;
  const made = new Map(index.commits.map((commit) => [commit.id, commit] as const));
  byIdOf.set(index, made);
  return made;
};

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

export interface BookVersion {
  readonly commit: IndexedCommit;
  readonly blob: string | null;
}

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

export const reachableFrom = (index: BookIndex, tip: string): ReadonlySet<string> | undefined => {
  const byId = commitsById(index);
  const first = byId.get(tip);
  if (first === undefined) return undefined;
  const seen = new Set([tip]);
  const queue = [first];
  while (queue.length > 0) {
    const commit = queue.pop();
    if (commit === undefined) break;
    enqueue(commit.parents, seen, byId, queue);
  }
  return seen;
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
    // SAFETY: the version is this build's and the writer is `encodeIndex`; the index is derived and rebuildable, so a malformed one costs a rebuild.
    return value as BookIndex;
  } catch {
    return undefined;
  }
};
