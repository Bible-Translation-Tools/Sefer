import { Effect, Option } from "effect";

import type { BurritoIngredient, BurritoMetadata } from "./burrito";

const SHIFTS: readonly number[] = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K = new Uint32Array(64);
for (let index = 0; index < 64; index += 1)
  K[index] = Math.floor(Math.abs(Math.sin(index + 1)) * 0x1_0000_0000);

const rotateLeft = (value: number, by: number): number => (value << by) | (value >>> (32 - by));

const md5 = (bytes: Uint8Array): string => {
  const length = bytes.length;
  const padded = new Uint8Array((((length + 8) >>> 6) << 6) + 64);
  padded.set(bytes);
  padded[length] = 0x80;
  const bits = length * 8;
  const low = bits >>> 0;
  const high = Math.floor(bits / 0x1_0000_0000);
  const tail = padded.length - 8;
  padded[tail] = low & 0xff;
  padded[tail + 1] = (low >>> 8) & 0xff;
  padded[tail + 2] = (low >>> 16) & 0xff;
  padded[tail + 3] = (low >>> 24) & 0xff;
  padded[tail + 4] = high & 0xff;
  padded[tail + 5] = (high >>> 8) & 0xff;
  padded[tail + 6] = (high >>> 16) & 0xff;
  padded[tail + 7] = (high >>> 24) & 0xff;

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const words = new Uint32Array(16);
  for (let block = 0; block < padded.length; block += 64) {
    for (let word = 0; word < 16; word += 1) {
      const at = block + word * 4;
      words[word] =
        // SAFETY: `at + 3` is inside `padded` — the loop steps whole blocks and the buffer length is a multiple of 64.
        ((padded[at] ?? 0) |
          ((padded[at + 1] ?? 0) << 8) |
          ((padded[at + 2] ?? 0) << 16) |
          ((padded[at + 3] ?? 0) << 24)) >>>
        0;
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let step = 0; step < 64; step += 1) {
      let mixed: number;
      let index: number;
      if (step < 16) {
        mixed = (b & c) | (~b & d);
        index = step;
      } else if (step < 32) {
        mixed = (d & b) | (~d & c);
        index = (5 * step + 1) % 16;
      } else if (step < 48) {
        mixed = b ^ c ^ d;
        index = (3 * step + 5) % 16;
      } else {
        mixed = c ^ (b | ~d);
        index = (7 * step) % 16;
      }
      const sum = (a + mixed + (K[step] ?? 0) + (words[index] ?? 0)) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotateLeft(sum, SHIFTS[step] ?? 0)) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0].map(hexWordLittleEndian).join("");
};

const hexWordLittleEndian = (word: number): string => {
  let text = "";
  for (let byte = 0; byte < 4; byte += 1)
    text += ((word >>> (byte * 8)) & 0xff).toString(16).padStart(2, "0");
  return text;
};

interface IngredientFingerprint {
  readonly md5: string;
  readonly size: number;
}

export const fingerprint = (bytes: Uint8Array): IngredientFingerprint => ({
  md5: md5(bytes),
  size: bytes.length,
});

export interface ChecksumRefresh {
  readonly ingredients: Readonly<Record<string, BurritoIngredient>>;
  readonly changed: readonly string[];
}

export const refreshIngredientChecksums = <E, R>(
  metadata: BurritoMetadata,
  readBytes: (name: string) => Effect.Effect<Option.Option<Uint8Array>, E, R>,
  names?: readonly string[],
): Effect.Effect<ChecksumRefresh, E, R> =>
  Effect.gen(function* () {
    const ingredients: Record<string, BurritoIngredient> = { ...metadata.ingredients };
    const changed: string[] = [];
    for (const name of names ?? Object.keys(metadata.ingredients)) {
      const ingredient = ingredients[name];
      if (ingredient === undefined) continue;
      const bytes = yield* readBytes(name);
      if (Option.isNone(bytes)) continue;
      const fresh = fingerprint(bytes.value);
      if (ingredient.checksum.md5 === fresh.md5 && ingredient.size === fresh.size) continue;
      ingredients[name] = { ...ingredient, checksum: { md5: fresh.md5 }, size: fresh.size };
      changed.push(name);
    }
    return { ingredients, changed };
  });
