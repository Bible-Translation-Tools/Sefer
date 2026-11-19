import type { IsomorphicFs, ReadFileOptions } from "./nodeView";

/**
 * The one view isomorphic-git reads a repository's objects through.
 *
 * isomorphic-git reads every object by trying it as a loose file first and
 * then listing `objects/pack` before reading the pack, and it looks the
 * repository up (`stat .git`, and a `readFile()` of no path to see that it
 * returns a promise) at the start of every command; nothing is kept
 * between reads. On a disk that is cheap; on OPFS each is a round trip, and a
 * walk over a migrated Bible's ~28,000 commits was ~57,000 of them (a one
 * commit push, ~44 s in the browser, 2026-11-18).
 *
 * This view answers those from memory: a loose object's existence from one
 * listing of its fan-out folder (`objects/ab`), `objects/pack` from one
 * listing, and `.git`'s stat once. Its own writes, renames and removals keep
 * them true; anything written by another hand meanwhile is not seen.
 *
 * Two lifetimes, one view:
 * - **One command** (`cachedObjects(fs)` at the call, dropped after): push,
 *   fetch, log, merge base. Cheap; listings only.
 * - **A long read** (`objectCache(fs, { holdPack: true })`): the History
 *   index reads every commit and tree, often one isomorphic-git command per
 *   object, and each command without a shared `cache` would read the pack
 *   again. Holding the pack files' bytes makes that one read. Call
 *   `invalidate()` when another hand may have written the repository.
 */

export interface ObjectCacheOptions {
  /** Keep each pack file's bytes after its first read (a long read of many objects). */
  readonly holdPack?: boolean;
}

export interface ObjectCache {
  readonly fs: IsomorphicFs;
  /** Forget everything held: the next read asks the filesystem again. */
  readonly invalidate: () => void;
  /** What reached the filesystem underneath, for measuring. */
  readonly stats: () => {
    readonly packBytes: number;
    readonly calls: Readonly<Record<string, number>>;
  };
}

const LOOSE = /^(.*\/objects)\/([0-9a-f]{2})\/([0-9a-f]{38})$/u;
const PACK_FILE = /\/objects\/pack\/[^/]+$/u;
const LISTED = /\/objects\/(?:pack|[0-9a-f]{2})$/u;
const GIT_DIR = /\/\.git$/u;

/** A read that returns bytes, not text (isomorphic-git passes `{}`). */
const asBytes = (options: ReadFileOptions): boolean =>
  options === undefined ||
  (typeof options === "object" && (options.encoding === undefined || options.encoding === null));

const missing = (path: string): Error =>
  Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), {
    code: "ENOENT",
    path,
    errno: -2,
  });

const codeOf = (error: unknown): unknown =>
  typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;

const split = (path: string): readonly [string, string] => {
  const at = path.lastIndexOf("/");
  return [path.slice(0, at), path.slice(at + 1)];
};

/** `fs` with every call counted into `calls`. */
const counting = (fs: IsomorphicFs, calls: Record<string, number>): IsomorphicFs => {
  const count =
    <A extends unknown[], R>(name: string, method: (...args: A) => R) =>
    (...args: A): R => {
      calls[name] = (calls[name] ?? 0) + 1;
      return method(...args);
    };
  return {
    ...fs,
    readFile: count("readFile", fs.readFile),
    writeFile: count("writeFile", fs.writeFile),
    unlink: count("unlink", fs.unlink),
    readdir: count("readdir", fs.readdir),
    mkdir: count("mkdir", fs.mkdir),
    rmdir: count("rmdir", fs.rmdir),
    stat: count("stat", fs.stat),
    lstat: count("lstat", fs.lstat),
    rename: count("rename", fs.rename),
  };
};

export const objectCache = (fs: IsomorphicFs, options: ObjectCacheOptions = {}): ObjectCache => {
  const calls: Record<string, number> = {};
  const inner = counting(fs, calls);

  /** A folder's names, or `null` when it does not exist. */
  const listings = new Map<string, Promise<Set<string> | null>>();
  /** Pack files' bytes, when `holdPack`. */
  const packs = new Map<string, Promise<Uint8Array | string>>();
  /** `stat` of the `.git` folder. */
  const gitDirs = new Map<string, ReturnType<IsomorphicFs["stat"]>>();
  let packBytes = 0;

  const list = (folder: string): Promise<Set<string> | null> => {
    const held = listings.get(folder);
    if (held !== undefined) return held;
    const read = inner.readdir(folder).then(
      (names) => new Set(names),
      (error: unknown) => {
        const code = codeOf(error);
        if (code === "ENOENT" || code === "ENOTDIR") return null;
        listings.delete(folder);
        throw error;
      },
    );
    listings.set(folder, read);
    return read;
  };
  /** After a write or removal: what is held about `path` says so. */
  const note = async (path: string, present: boolean): Promise<void> => {
    packs.delete(path);
    gitDirs.delete(path);
    const [folder, name] = split(path);
    const held = listings.get(folder);
    if (held === undefined) return;
    const names = await held;
    if (names === null) {
      if (present) listings.set(folder, Promise.resolve(new Set([name])));
      return;
    }
    if (present) names.add(name);
    else names.delete(name);
  };
  const absent = async (path: string): Promise<boolean> => {
    const loose = LOOSE.exec(path);
    if (loose === null) return false;
    const names = await list(`${loose[1] ?? ""}/${loose[2] ?? ""}`);
    return names === null || !names.has(loose[3] ?? "");
  };
  const heldPack = (path: string, read: () => Promise<Uint8Array | string>) => {
    let found = packs.get(path);
    if (found === undefined) {
      found = read().then((bytes) => {
        if (bytes instanceof Uint8Array) packBytes += bytes.byteLength;
        return bytes;
      });
      found.catch(() => packs.delete(path));
      packs.set(path, found);
    }
    return found;
  };

  const view: IsomorphicFs = {
    ...inner,
    readFile: async (path, readOptions) => {
      // isomorphic-git calls `readFile()` with no path at the start of every
      // command, only to see that it returns a promise; on OPFS that was one
      // round trip per object read.
      if (typeof path !== "string") throw missing(String(path));
      if (await absent(path)) throw missing(path);
      if (options.holdPack === true && asBytes(readOptions) && PACK_FILE.test(path))
        return heldPack(path, () => inner.readFile(path, readOptions));
      return inner.readFile(path, readOptions);
    },
    stat: async (path) => {
      if (await absent(path)) throw missing(path);
      if (!GIT_DIR.test(path)) return inner.stat(path);
      let found = gitDirs.get(path);
      if (found === undefined) {
        found = inner.stat(path);
        found.catch(() => gitDirs.delete(path));
        gitDirs.set(path, found);
      }
      return found;
    },
    lstat: async (path) => {
      if (await absent(path)) throw missing(path);
      return inner.lstat(path);
    },
    readdir: async (path) => {
      if (!LISTED.test(path)) return inner.readdir(path);
      const names = await list(path);
      if (names === null) throw missing(path);
      return [...names];
    },
    writeFile: async (path, data, writeOptions) => {
      await inner.writeFile(path, data, writeOptions);
      await note(path, true);
    },
    unlink: async (path) => {
      await inner.unlink(path);
      await note(path, false);
    },
    rename: async (from, to) => {
      await inner.rename(from, to);
      await note(from, false);
      await note(to, true);
    },
    mkdir: async (path) => {
      await inner.mkdir(path);
      if (listings.has(path) && (await listings.get(path)) === null)
        listings.set(path, Promise.resolve(new Set()));
    },
    rmdir: async (path) => {
      await inner.rmdir(path);
      listings.delete(path);
    },
  };

  return {
    fs: view,
    invalidate: () => {
      listings.clear();
      packs.clear();
      gitDirs.clear();
      packBytes = 0;
    },
    stats: () => ({ packBytes, calls: { ...calls } }),
  };
};

/** The view for one isomorphic-git command: make it at the call, drop it after. */
export const cachedObjects = (fs: IsomorphicFs): IsomorphicFs => objectCache(fs).fs;
