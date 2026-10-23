import type { IsomorphicFs } from "#core/fileSystem/nodeView";

export interface PackView {
  readonly fs: IsomorphicFs;
  readonly invalidate: () => void;
  readonly stats: () => {
    readonly packBytes: number;
    readonly loads: number;
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
