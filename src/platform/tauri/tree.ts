/**
 * The desktop host's `FolderTree`: a folder's listing, and many files' bytes,
 * in one IPC call each (`src-tauri/src/tree.rs`), where the `FileSystem` port
 * would cross IPC once per file. What makes Translation Notes' freshness check
 * and first read proportionate on desktop; see `src/core/resources/kinds/tree.ts`.
 */
import { invoke } from "@tauri-apps/api/core";
import { Effect, Layer } from "effect";

import { Unavailable } from "#core/resources/kinds/handle";
import { FolderTree, type ListedFile } from "#core/resources/kinds/tree";

const unreadable = (cause: unknown): Unavailable =>
  new Unavailable({
    reason: "Unreadable",
    description: cause instanceof Error ? cause.message : String(cause),
  });

/**
 * `tree_read`'s answer: for each asked path, in order, a little-endian `u32`
 * length and that many bytes.
 */
const unpack = (
  buffer: ArrayBuffer,
  paths: readonly string[],
): Effect.Effect<ReadonlyMap<string, Uint8Array>, Unavailable> =>
  Effect.suspend(() => {
    const view = new DataView(buffer);
    const out = new Map<string, Uint8Array>();
    let at = 0;
    for (const path of paths) {
      if (at + 4 > buffer.byteLength) return Effect.fail(unreadable(`${path}: not in the answer`));
      const length = view.getUint32(at, true);
      at += 4;
      if (at + length > buffer.byteLength) return Effect.fail(unreadable(`${path}: cut short`));
      out.set(path, new Uint8Array(buffer, at, length));
      at += length;
    }
    return Effect.succeed(out);
  });

export const TauriFolderTreeLive: Layer.Layer<FolderTree> = Layer.succeed(FolderTree, {
  filesBelow: (directory) =>
    Effect.tryPromise({
      try: () => invoke<readonly ListedFile[]>("tree_listing", { directory }),
      catch: unreadable,
    }),
  read: (directory, paths) =>
    Effect.flatMap(
      Effect.tryPromise({
        try: () => invoke<ArrayBuffer>("tree_read", { directory, paths: [...paths] }),
        catch: unreadable,
      }),
      (buffer) => unpack(buffer, paths),
    ),
});
