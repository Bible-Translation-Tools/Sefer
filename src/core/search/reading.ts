import type { BookId } from "@sefer/text/book";
import type { SourceStamp } from "@sefer/text/source";

import type { GalleyService, MaskMap } from "../galley/galley";

/** A half-open range, in UTF-16 units, into a book's canonical text. */
export interface SourceRange {
  readonly from: number;
  readonly to: number;
}

export interface Subject {
  readonly id: BookId;
  readonly text: string;
  readonly stamp?: SourceStamp;
}

export interface Reading {
  readonly bookId: BookId;
  readonly stamp: SourceStamp | undefined;
  readonly text: string;
  readonly toSource: (at: number) => number;
  readonly pieces: (from: number, to: number) => readonly SourceRange[];
}

export interface Readings {
  readonly of: (subject: Subject) => Reading | undefined;
  readonly forget: (id?: BookId) => void;
  readonly size: () => number;
}

interface Held {
  readonly stamp: SourceStamp | undefined;
  readonly rangeCount: number;
  readonly from: Uint32Array;
  readonly to: Uint32Array;
  readonly starts: Uint32Array;
  readonly readingLength: number;
  readonly sourceLen: number;
}

const hold = (map: {
  readonly rangeCount: number;
  readonly sourceLen: number;
  range: (n: number) => { readonly sourceFrom: number; readonly sourceTo: number };
}): Omit<Held, "stamp"> => {
  const count = map.rangeCount;
  const from = new Uint32Array(count);
  const to = new Uint32Array(count);
  const starts = new Uint32Array(count);
  let at = 0;
  for (let n = 0; n < count; n += 1) {
    const range = map.range(n);
    from[n] = range.sourceFrom;
    to[n] = range.sourceTo;
    starts[n] = at;
    at += range.sourceTo - range.sourceFrom;
  }
  return { rangeCount: count, from, to, starts, readingLength: at, sourceLen: map.sourceLen };
};

const rangeAt = (held: Held, at: number): number => {
  let lo = 0;
  let hi = held.rangeCount - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    // SAFETY: `mid` is inside [0, rangeCount) by construction.
    if (held.starts[mid]! <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

const readingOf = (held: Held, text: string): string => {
  const parts = Array.from<string>({ length: held.rangeCount });
  // SAFETY: the three arrays are `rangeCount` long, built together above.
  for (let n = 0; n < held.rangeCount; n += 1) parts[n] = text.slice(held.from[n]!, held.to[n]!);
  return parts.join("");
};

export const createReadings = (galley: GalleyService): Readings =>
  readingsOver((subject) => galley.mask(subject.id));

export const createFreshReadings = (galley: GalleyService): Readings =>
  readingsOver((subject) => galley.readerMask(subject.text));

const readingsOver = (maskOf: (subject: Subject) => MaskMap | undefined): Readings => {
  const held = new Map<BookId, Held>();

  const mapFor = (subject: Subject): Held | undefined => {
    const standing = held.get(subject.id);
    if (
      standing !== undefined &&
      (subject.stamp === undefined ? true : standing.stamp === subject.stamp)
    ) {
      return standing;
    }
    const map = maskOf(subject);
    if (map === undefined) {
      held.delete(subject.id);
      return undefined;
    }
    const built: Held = { stamp: subject.stamp, ...hold(map) };
    held.set(subject.id, built);
    return built;
  };

  return {
    of: (subject) => {
      const map = mapFor(subject);
      if (map === undefined) return undefined;
      if (map.sourceLen !== subject.text.length) return undefined;
      return {
        bookId: subject.id,
        stamp: subject.stamp,
        text: readingOf(map, subject.text),
        toSource: (at) => {
          const n = rangeAt(map, at);
          // SAFETY: `rangeAt` returns an index into the arrays.
          return map.from[n]! + (at - map.starts[n]!);
        },
        pieces: (from, to) => {
          const out: SourceRange[] = [];
          let at = from;
          while (at < to) {
            const n = rangeAt(map, at);
            // SAFETY: `n` is in range; the last range ends at the reading's end.
            const ends = n + 1 < map.rangeCount ? map.starts[n + 1]! : map.readingLength;
            const take = Math.min(to, ends);
            const base = map.from[n]! + (at - map.starts[n]!);
            out.push({ from: base, to: base + (take - at) });
            at = take;
          }
          return out;
        },
      };
    },
    forget: (id) => {
      if (id === undefined) held.clear();
      else held.delete(id);
    },
    size: () => held.size,
  };
};
