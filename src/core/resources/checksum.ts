// checksum.ts
//
// Scripture Burrito ingredients carry `checksum.md5` and `size`, and a burrito
// whose checksums disagree with its files is a burrito other tools will refuse.
// So whenever Sefer writes a book, the ingredient that names it has to be
// refreshed — which means Sefer needs an md5 of its own.
//
// Why a hand-written md5 and not a dependency, and not the platform:
//
//   * `crypto.subtle.digest` does NOT implement md5. The Web Crypto algorithm
//     list is SHA-1 and the SHA-2 family, deliberately — md5 is broken as a
//     security primitive and the browsers will not grow it. Burrito uses it as
//     a content FINGERPRINT, not as a signature, so the weakness is not ours
//     to fix; we just have to produce the same digits every other Burrito
//     reader produces.
//   * Node's `node:crypto` has it, and core may not import `node:*`
//     (documentation/architecture/boundaries.md) — the same code runs in a
//     browser.
//   * A package for sixty lines of arithmetic is a supply-chain surface for
//     nothing. What is below is the reference algorithm from RFC 1321,
//     transcribed: the per-round shift table, the sine-derived constants, and
//     the four-round loop over 64-byte blocks.
//
// Nothing here does I/O. `refreshIngredientChecksums` takes a reader as a
// function, so the same policy serves the save hook, an import, and a test
// over bytes held in memory.

import { Effect, Option } from "effect";

import type { BurritoIngredient, BurritoMetadata } from "./burrito";

/** Per-round left-rotation amounts (RFC 1321 §3.4). */
const SHIFTS: readonly number[] = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/**
 * `K[i] = floor(abs(sin(i + 1)) * 2^32)`, the table RFC 1321 builds the same
 * way. Computed rather than pasted: the formula is the spec, and sixty-four
 * transcribed hex literals are sixty-four chances to fat-finger one.
 */
const K = new Uint32Array(64);
for (let index = 0; index < 64; index += 1)
  K[index] = Math.floor(Math.abs(Math.sin(index + 1)) * 0x1_0000_0000);

const rotateLeft = (value: number, by: number): number => (value << by) | (value >>> (32 - by));

/**
 * The md5 of `bytes`, as 32 lowercase hex digits — the spelling Scripture
 * Burrito's `checksum.md5` uses.
 */
export const md5 = (bytes: Uint8Array): string => {
  const length = bytes.length;
  // The message, 0x80, zeroes, then the bit length as 8 little-endian bytes,
  // rounded up to a whole number of 64-byte blocks.
  const padded = new Uint8Array((((length + 8) >>> 6) << 6) + 64);
  padded.set(bytes);
  padded[length] = 0x80;
  // Only the low 53 bits of a JS number are exact, which is far past any file
  // Sefer will hash; the high word is written from a float divide for the same
  // reason the spec writes 64 bits at all.
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
    // Little-endian by hand rather than through a typed-array view: a
    // Uint32Array over the buffer would read the host's byte order.
    for (let word = 0; word < 16; word += 1) {
      const at = block + word * 4;
      words[word] =
        // SAFETY: `at + 3` is inside `padded` — the loop steps whole blocks and
        // the buffer length is a multiple of 64.
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

/** One state word as 8 hex digits, least significant byte first. */
const hexWordLittleEndian = (word: number): string => {
  let text = "";
  for (let byte = 0; byte < 4; byte += 1)
    text += ((word >>> (byte * 8)) & 0xff).toString(16).padStart(2, "0");
  return text;
};

/** What an ingredient records about its bytes. */
export interface IngredientFingerprint {
  readonly md5: string;
  readonly size: number;
}

export const fingerprint = (bytes: Uint8Array): IngredientFingerprint => ({
  md5: md5(bytes),
  size: bytes.length,
});

export interface ChecksumRefresh {
  /** The whole ingredients table, with the refreshed entries replaced. */
  readonly ingredients: Readonly<Record<string, BurritoIngredient>>;
  /** The ingredient names whose md5 or size moved. Empty means: do not write. */
  readonly changed: readonly string[];
}

/**
 * Recomputes `checksum.md5` and `size` for the named ingredients (every one,
 * when `names` is omitted) from the bytes `readBytes` hands back.
 *
 * Two rules:
 *
 *   * An ingredient whose bytes the reader cannot produce is left exactly as
 *     it is. A missing file is a fact about the project, not a reason to
 *     invent a checksum or to drop the row — the burrito still declares it.
 *   * `changed` is what makes the caller's write conditional. Rewriting
 *     `metadata.json` on every save of an unchanged book would churn a file
 *     Git watches, for nothing.
 */
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
