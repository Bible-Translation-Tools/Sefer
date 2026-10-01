/**
 * The history index's object reader, over isomorphic-git.
 *
 * Objects are read by id and trees as RAW content, so no entry name can
 * refuse a read: isomorphic-git's own tree parse throws on names git accepts.
 */
import { Buffer } from "buffer";

import git from "isomorphic-git";

import type { IsomorphicFs } from "#core/fileSystem/nodeView";
import type { ObjectReader } from "#core/history/bookIndex";

// isomorphic-git expects Node's `Buffer`; a worker has no polyfill of its own.
Object.assign(globalThis, { Buffer });

export const objectReader = (fs: IsomorphicFs, dir: string): ObjectReader => {
  const cache = {};
  return {
    resolve: (ref) => git.resolveRef({ fs, dir, ref }),
    commit: async (id) => {
      const { commit } = await git.readCommit({ fs, dir, oid: id, cache });
      return {
        tree: commit.tree,
        parents: commit.parent,
        author: commit.author,
        message: commit.message,
      };
    },
    tree: async (id) => {
      const { object } = await git.readObject({ fs, dir, oid: id, format: "content", cache });
      return object instanceof Uint8Array ? object : new Uint8Array();
    },
    shallow: async () =>
      new Set(
        await fs
          .readFile(`${dir}/.git/shallow`, "utf8")
          .then((text) =>
            String(text)
              .split("\n")
              .filter((line) => line !== ""),
          )
          .catch((): string[] => []),
      ),
  };
};
