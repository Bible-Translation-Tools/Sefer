/**
 * Writing a replayed history through a git library costs a measured 1–9 ms per
 * loose object on the Web, and isomorphic-git's own `packObjects` stores every
 * version whole (35 MB for one New Testament's Writer saves). Written directly,
 * the same history is one 2.7 MB pack and its index.
 */

const TYPE = { commit: 1, tree: 2, blob: 3, ofsDelta: 6 } as const;

export type ObjectType = "commit" | "tree" | "blob";

const MAX_DEPTH = 50;

const encoder = new TextEncoder();

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const toHex = (bytes: Uint8Array): string => {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
};

const fromHex = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

const sha1 = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-1", new Uint8Array(bytes)));

const deflate = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(
    await new Response(
      new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const entryHeader = (type: number, size: number): number[] => {
  const out: number[] = [];
  let byte = (type << 4) | (size & 0x0f);
  let rest = Math.floor(size / 16);
  while (rest > 0) {
    out.push(byte | 0x80);
    byte = rest & 0x7f;
    rest = Math.floor(rest / 128);
  }
  out.push(byte);
  return out;
};

const sizeVarint = (n: number): number[] => {
  const out: number[] = [];
  let rest = n;
  do {
    let byte = rest & 0x7f;
    rest = Math.floor(rest / 128);
    if (rest > 0) byte |= 0x80;
    out.push(byte);
  } while (rest > 0);
  return out;
};

const offsetVarint = (n: number): number[] => {
  const out = [n & 0x7f];
  let rest = Math.floor(n / 128);
  while (rest > 0) {
    rest -= 1;
    out.unshift(0x80 | (rest & 0x7f));
    rest = Math.floor(rest / 128);
  }
  return out;
};

const copyOps = (from: number, size: number, out: number[]): void => {
  let offset = from;
  let left = size;
  while (left > 0) {
    const take = Math.min(left, 0xffff);
    let op = 0x80;
    const args: number[] = [];
    for (let i = 0; i < 4; i++) {
      const byte = Math.floor(offset / 2 ** (8 * i)) & 0xff;
      if (byte !== 0) {
        op |= 1 << i;
        args.push(byte);
      }
    }
    for (let i = 0; i < 2; i++) {
      const byte = (take >>> (8 * i)) & 0xff;
      if (byte !== 0) {
        op |= 1 << (4 + i);
        args.push(byte);
      }
    }
    out.push(op, ...args);
    offset += take;
    left -= take;
  }
};

const insertOps = (bytes: Uint8Array, out: number[]): void => {
  for (let i = 0; i < bytes.length; i += 127) {
    const piece = bytes.subarray(i, Math.min(i + 127, bytes.length));
    out.push(piece.length);
    for (const byte of piece) out.push(byte);
  }
};

const deltaOf = (base: Uint8Array, target: Uint8Array): Uint8Array => {
  const most = Math.min(base.length, target.length);
  let head = 0;
  while (head < most && base[head] === target[head]) head++;
  let tail = 0;
  while (tail < most - head && base[base.length - 1 - tail] === target[target.length - 1 - tail])
    tail++;
  const out = [...sizeVarint(base.length), ...sizeVarint(target.length)];
  if (head > 0) copyOps(0, head, out);
  insertOps(target.subarray(head, target.length - tail), out);
  if (tail > 0) copyOps(base.length - tail, tail, out);
  return Uint8Array.from(out);
};

const objectId = async (type: ObjectType, body: Uint8Array): Promise<string> =>
  toHex(await sha1(concat([encoder.encode(`${type} ${String(body.length)}\0`), body])));

export interface PackStats {
  readonly objects: number;
  readonly deltas: number;
  readonly packBytes: number;
}

export interface FinishedPack {
  readonly pack: Uint8Array;
  readonly idx: Uint8Array;
  readonly name: string;
  readonly stats: PackStats;
}

export interface PackWriter {
  readonly add: (type: ObjectType, body: Uint8Array, lane?: string) => Promise<string>;
  readonly finish: () => Promise<FinishedPack>;
}

interface Held {
  readonly offset: number;
  readonly body: Uint8Array;
  readonly depth: number;
}

export const packWriter = (): PackWriter => {
  const entries: { readonly id: Uint8Array; readonly offset: number; readonly crc: number }[] = [];
  const chunks: Uint8Array[] = [];
  const seen = new Set<string>();
  const lanes = new Map<string, Held>();
  let length = 12;
  let deltas = 0;

  const add = async (type: ObjectType, body: Uint8Array, lane?: string): Promise<string> => {
    const id = await objectId(type, body);
    if (seen.has(id)) return id;
    seen.add(id);
    const offset = length;
    const base = lane === undefined ? undefined : lanes.get(lane);
    const delta =
      base === undefined || base.depth >= MAX_DEPTH ? undefined : deltaOf(base.body, body);
    let entry: Uint8Array;
    let depth = 0;
    if (base !== undefined && delta !== undefined && delta.length < body.length) {
      entry = concat([
        Uint8Array.from([
          ...entryHeader(TYPE.ofsDelta, delta.length),
          ...offsetVarint(offset - base.offset),
        ]),
        await deflate(delta),
      ]);
      depth = base.depth + 1;
      deltas += 1;
    } else
      entry = concat([Uint8Array.from(entryHeader(TYPE[type], body.length)), await deflate(body)]);
    chunks.push(entry);
    length += entry.length;
    entries.push({ id: fromHex(id), offset, crc: crc32(entry) });
    if (lane !== undefined) lanes.set(lane, { offset, body, depth });
    return id;
  };

  const finish = async (): Promise<FinishedPack> => {
    const header = new Uint8Array(12);
    const view = new DataView(header.buffer);
    header.set(encoder.encode("PACK"), 0);
    view.setUint32(4, 2);
    view.setUint32(8, entries.length);
    const body = concat([header, ...chunks]);
    const packSha = await sha1(body);
    const pack = concat([body, packSha]);

    const sorted = [...entries].sort((a, b) => {
      for (let i = 0; i < 20; i++) {
        const d = (a.id[i] ?? 0) - (b.id[i] ?? 0);
        if (d !== 0) return d;
      }
      return 0;
    });
    const table = new Uint8Array(8 + 256 * 4 + sorted.length * 28 + 20);
    const out = new DataView(table.buffer);
    table.set([0xff, 0x74, 0x4f, 0x63, 0, 0, 0, 2], 0);
    let at = 8;
    let i = 0;
    for (let first = 0; first < 256; first++) {
      while (i < sorted.length && (sorted[i]?.id[0] ?? 256) <= first) i++;
      out.setUint32(at, i);
      at += 4;
    }
    for (const entry of sorted) {
      table.set(entry.id, at);
      at += 20;
    }
    for (const entry of sorted) {
      out.setUint32(at, entry.crc);
      at += 4;
    }
    for (const entry of sorted) {
      out.setUint32(at, entry.offset);
      at += 4;
    }
    table.set(packSha, at);
    const idx = concat([table, await sha1(table)]);
    return {
      pack,
      idx,
      name: `pack-${toHex(packSha)}`,
      stats: { objects: entries.length, deltas, packBytes: pack.length },
    };
  };

  return { add, finish };
};

export const treeBody = (files: ReadonlyMap<string, string>): Uint8Array =>
  concat(
    [...files]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .flatMap(([name, id]) => [encoder.encode(`100644 ${name}\0`), fromHex(id)]),
  );

export interface CommitSignature {
  readonly name: string;
  readonly email: string;
  readonly at: number;
  readonly offset: number;
}

const zone = (minutes: number): string => {
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? "-" : "+"}${String(Math.floor(abs / 60)).padStart(2, "0")}${String(abs % 60).padStart(2, "0")}`;
};

const signed = (who: CommitSignature): string =>
  `${who.name} <${who.email}> ${String(who.at)} ${zone(who.offset)}`;

export const commitBody = (commit: {
  readonly tree: string;
  readonly parents: readonly string[];
  readonly author: CommitSignature;
  readonly committer: CommitSignature;
  readonly message: string;
}): Uint8Array =>
  encoder.encode(
    [
      `tree ${commit.tree}`,
      ...commit.parents.map((parent) => `parent ${parent}`),
      `author ${signed(commit.author)}`,
      `committer ${signed(commit.committer)}`,
      "",
      commit.message,
    ].join("\n"),
  );
