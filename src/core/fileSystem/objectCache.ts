import type { IsomorphicFs } from "./nodeView";

/**
 * isomorphic-git reads every object by trying it as a loose file first and
 * then listing `objects/pack` before reading the pack, with nothing kept
 * between reads. On a disk that is cheap; on OPFS each is a round trip, and a
 * walk over a migrated Bible's ~28,000 commits was ~57,000 of them (a one
 * commit push, ~44 s in the browser, 2026-11-18).
 *
 * This view answers both from memory: a loose object's existence from one
 * listing of its fan-out folder (`objects/ab`), and `objects/pack` from one
 * listing. Its own writes, renames and removals keep them true. Make one per
 * isomorphic-git command and drop it after (`cachedObjects(fs)` at the call):
 * anything written by another hand meanwhile is not seen, so a long-lived one
 * would go stale.
 *
 * The History index has its own, heavier view (`platform/web/history/
 * packView.ts`): it also holds the whole pack in memory for a long read of
 * every book's history. This one keeps listings only, so it is cheap enough
 * for every command.
 */

const LOOSE = /^(.*\/objects)\/([0-9a-f]{2})\/([0-9a-f]{38})$/u;
const PACKS = /\/objects\/pack$/u;

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

const cached = (path: string): boolean => PACKS.test(path) || /\/objects\/[0-9a-f]{2}$/u.test(path);

export const cachedObjects = (inner: IsomorphicFs): IsomorphicFs => {
  /** A folder's names, or `null` when it does not exist. */
  const listings = new Map<string, Promise<Set<string> | null>>();
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
  /** After a write or removal: the listing that holds `path`, if one is kept, says so. */
  const note = async (path: string, present: boolean): Promise<void> => {
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

  return {
    ...inner,
    readFile: async (path, options) => {
      if (await absent(path)) throw missing(path);
      return inner.readFile(path, options);
    },
    stat: async (path) => {
      if (await absent(path)) throw missing(path);
      return inner.stat(path);
    },
    lstat: async (path) => {
      if (await absent(path)) throw missing(path);
      return inner.lstat(path);
    },
    readdir: async (path) => {
      if (!cached(path)) return inner.readdir(path);
      const names = await list(path);
      if (names === null) throw missing(path);
      return [...names];
    },
    writeFile: async (path, data, options) => {
      await inner.writeFile(path, data, options);
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
};
