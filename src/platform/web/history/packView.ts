/**
 * The pack-cached filesystem view, for reading history fast on OPFS.
 *
 * isomorphic-git probes the filesystem about five times for every object it
 * reads — lists `objects/pack`, stats, reads `alternates`, tries a loose path
 * that is not there — and on OPFS each probe is an async round trip that walks
 * the path a segment at a time. A full Genesis walk was 88k calls and 37 s of
 * mostly idle time; through this view, en_ulb's whole index builds in about
 * 4 s. It answers those probes from memory:
 *
 *  - the pack directory's files are read once and served from memory
 *    (isomorphic-git holds the whole pack in memory anyway once it reads one
 *    packed object, so this costs nothing it was not already spending);
 *  - a loose-object probe is answered from one listing of `objects/` — a
 *    fan-out directory that does not exist means the object is not loose;
 *  - every other call goes straight through.
 *
 * It is only right while `.git/objects` does not change under it, so one is
 * made per build and used inside the repository's shared lane, where no
 * writer can run. Writes made THROUGH the view invalidate it.
 */

import type { IsomorphicFs } from "#core/fileSystem/nodeView";

export interface PackView {
  readonly fs: IsomorphicFs;
  /** Forget everything held; the next read reloads from the filesystem. */
  readonly invalidate: () => void;
  /** What loading cost, for the caller's span. */
  readonly stats: () => {
    readonly packBytes: number;
    readonly loads: number;
    /** Reads under `objects/` that still reached the filesystem: loose objects and first probes. */
    readonly passedThrough: number;
    readonly calls: Readonly<Record<string, number>>;
  };
}

const missing = (path: string): Error =>
  Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: "ENOENT" });

const LOOSE = /\/objects\/([0-9a-f]{2})\/[0-9a-f]{38}$/u;

export const packView = (fs: IsomorphicFs, dir: string): PackView => {
  const gitDir = `${dir}/.git`;
  const objects = `${gitDir}/objects`;
  let held:
    | Promise<{
        readonly fanout: ReadonlySet<string>;
        readonly pack: ReadonlyMap<string, Uint8Array>;
      }>
    | undefined;
  let packBytes = 0;
  let loads = 0;
  let passedThrough = 0;

  const load = () => {
    held ??= (async () => {
      loads += 1;
      const fanout = new Set(
        (await fs.readdir(objects).catch((): string[] => [])).filter((name) =>
          /^[0-9a-f]{2}$/u.test(name),
        ),
      );
      const pack = new Map<string, Uint8Array>();
      packBytes = 0;
      for (const name of await fs.readdir(`${objects}/pack`).catch((): string[] => [])) {
        const bytes = await fs.readFile(`${objects}/pack/${name}`);
        if (bytes instanceof Uint8Array) {
          pack.set(`${objects}/pack/${name}`, bytes);
          packBytes += bytes.byteLength;
        }
      }
      return { fanout, pack };
    })();
    return held;
  };

  /**
   * Every other probe under `objects/` — `info/alternates` above all, which
   * isomorphic-git reads for EVERY object — answered once, errors included.
   * Leaving it out cost a 30 s index build that was 4 s with it.
   */
  const probes = new Map<string, Promise<Uint8Array | string>>();
  const probe = (path: string, read: () => Promise<Uint8Array | string>) => {
    let found = probes.get(path);
    if (found === undefined) {
      found = read();
      probes.set(path, found);
    }
    return found;
  };

  const stats = new Map<string, ReturnType<IsomorphicFs["stat"]>>();

  const invalidate = (): void => {
    held = undefined;
    probes.clear();
    stats.clear();
  };
  const touches = (path: string): boolean => path.startsWith(objects);

  /** Every call that reached the filesystem, by method — what a span reports. */
  const calls: Record<string, number> = {};
  const counted = Object.fromEntries(
    Object.entries(fs).map(([name, method]) => [
      name,
      (...args: unknown[]) => {
        calls[name] = (calls[name] ?? 0) + 1;

        // SAFETY: each entry is one of `fs`'s own methods, forwarded unchanged.
        return (method as (...a: unknown[]) => unknown)(...args);
      },
    ]),
  );
  // SAFETY: `counted` has exactly `fs`'s keys, each forwarding to the same method.
  fs = counted as unknown as IsomorphicFs;

  const view: IsomorphicFs = {
    ...fs,
    readFile: async (path, options) => {
      if (!touches(path)) return fs.readFile(path, options);
      const { fanout, pack } = await load();
      const inPack = pack.get(path);
      if (inPack !== undefined) return inPack;
      const loose = LOOSE.exec(path);
      if (loose !== null) {
        if (!fanout.has(loose[1] ?? "")) throw missing(path);
        passedThrough += 1;
        return fs.readFile(path, options);
      }
      return probe(`${path}\0${JSON.stringify(options ?? null)}`, () => {
        passedThrough += 1;
        return fs.readFile(path, options);
      });
    },
    // isomorphic-git stats `.git` itself on EVERY command, to learn whether it
    // is a directory or a gitfile — 47,959 calls in one en_ulb index build,
    // 30 s of OPFS round trips out of 31. That, and any stat under `objects/`,
    // is answered once and remembered until `invalidate`.
    stat: async (path) => {
      if (path !== gitDir && !touches(path)) return fs.stat(path);
      let found = stats.get(path);
      if (found === undefined) {
        found = fs.stat(path);
        stats.set(path, found);
      }
      return found;
    },
    readdir: async (path) => {
      if (path === `${objects}/pack`) {
        const { pack } = await load();
        return [...pack.keys()].map((key) => key.slice(key.lastIndexOf("/") + 1));
      }
      return fs.readdir(path);
    },
    writeFile: async (path, data, options) => {
      if (touches(path)) invalidate();
      return fs.writeFile(path, data, options);
    },
    unlink: async (path) => {
      if (touches(path)) invalidate();
      return fs.unlink(path);
    },
    rename: async (from, to) => {
      if (touches(from) || touches(to)) invalidate();
      return fs.rename(from, to);
    },
  };

  return {
    fs: view,
    invalidate,
    stats: () => ({ packBytes, loads, passedThrough, calls: { ...calls } }),
  };
};
