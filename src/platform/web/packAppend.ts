/**
 * Adding whole objects to the end of an existing git pack, so one
 * receive-pack request can carry a migration's pack AND the commits made on
 * top of it (intake's "Where each book came from", later edits). Git takes
 * one pack per request; two packs cannot be sent side by side, and the
 * second push isomorphic-git made for those few commits took ~44 s in the
 * browser (Bemba New Testament, 2026-11-18).
 *
 * The pack keeps its own entries byte for byte: its deltas point backwards
 * by offset, so entries appended after them change nothing. The header's
 * object count grows and the trailing SHA-1 is computed again.
 */

import git, { type FsClient } from "isomorphic-git";

const TYPE_CODE = { commit: 1, tree: 2, blob: 3, tag: 4 } as const;

export interface WholeObject {
  readonly type: keyof typeof TYPE_CODE;
  /** The object's content, without git's `type size\0` header. */
  readonly content: Uint8Array;
}

/** An entry's header: type and size, the size in 7-bit groups after its low four bits. */
const entryHeader = (type: WholeObject["type"], size: number): Uint8Array => {
  const bytes: number[] = [];
  let byte = (TYPE_CODE[type] << 4) | (size & 0x0f);
  let rest = Math.floor(size / 16);
  while (rest > 0) {
    bytes.push(byte | 0x80);
    byte = rest & 0x7f;
    rest = Math.floor(rest / 128);
  }
  bytes.push(byte);
  return Uint8Array.from(bytes);
};

/** zlib, as a pack entry wants it (`CompressionStream`'s "deflate" is the zlib format). */
const deflate = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(
    await new Response(
      new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );

const concat = (parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
};

/** `pack` with `objects` added at its end: a new count, the entries, a new checksum. */
export const appendToPack = async (
  pack: Uint8Array,
  objects: readonly WholeObject[],
): Promise<Uint8Array> => {
  if (objects.length === 0) return pack;
  const body = pack.slice(0, pack.byteLength - 20);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  view.setUint32(8, view.getUint32(8) + objects.length);
  const entries: Uint8Array[] = [];
  for (const object of objects)
    entries.push(
      entryHeader(object.type, object.content.byteLength),
      await deflate(object.content),
    );
  const whole = concat([body, ...entries]);
  const checksum = new Uint8Array(await crypto.subtle.digest("SHA-1", whole));
  return concat([whole, checksum]);
};

/**
 * The objects of the commits made on a replayed history (intake's "Where
 * each book came from", later edits): every commit from `tip` back to the
 * replay's `head`, with the trees and blobs `held` (the replay's pack) does
 * not already have. They are loose, so reading them never opens the pack.
 * `undefined` when the line is not a plain run of commits on top of `head`;
 * the ordinary push then sends them.
 */
export const objectsSince = async (
  repo: { readonly fs: FsClient; readonly dir: string },
  tip: string,
  head: string,
  held: (oid: string) => boolean,
): Promise<readonly WholeObject[] | undefined> => {
  const objects: WholeObject[] = [];
  const seen = new Set<string>();
  const visit = async (oid: string): Promise<void> => {
    if (seen.has(oid) || held(oid)) return;
    seen.add(oid);
    const read = await git.readObject({ ...repo, oid, format: "content" });
    if (!(read.object instanceof Uint8Array)) throw new Error(`${oid} did not read as bytes`);
    if (read.type !== "commit" && read.type !== "tree" && read.type !== "blob") return;
    objects.push({ type: read.type, content: read.object });
    if (read.type !== "tree") return;
    const { tree } = await git.readTree({ ...repo, oid });
    for (const entry of tree) if (entry.type !== "commit") await visit(entry.oid);
  };
  let at = tip;
  for (let steps = 0; at !== head; steps += 1) {
    if (steps > 1000) return undefined;
    const { commit } = await git.readCommit({ ...repo, oid: at });
    const [parent, ...more] = commit.parent;
    if (parent === undefined || more.length > 0) return undefined;
    await visit(at);
    await visit(commit.tree);
    at = parent;
  }
  return objects;
};
