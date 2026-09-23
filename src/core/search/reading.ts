// reading.ts
//
// The READING of a book — what a reader sees, with the markup taken out — and
// the map back to the text they can edit.
//
// Galley cuts that reading to search it and drops it again, which is why
// `findAll` rebuilds and re-folds the whole corpus on every call. It also hands
// over the MASK MAP: the source spans the reading is made of, in order. The reading is a pure concatenation of those spans, so a
// caller holding the book's text can rebuild it, and — the part that matters —
// can map an offset in the reading back to an offset in the text.
//
// That map is what makes a search over the reading actionable. Without it a
// hit is a position in a string nothing can edit.
//
// ## What is kept, and what is not
//
// The MAP is kept, keyed by the book's `SourceStamp`. It is ~0.6MB for a whole
// Bible (78,690 spans over 66 books at eight bytes each) and it is what turns
// a hit into somewhere to go.
//
// The READING is NOT kept. It is ~7.85MB for a Bible — another whole copy of a
// corpus the engine already holds one of, and Sefer already holds the source of.
// Rebuilding it costs ~9ms for the whole corpus (measured on en_ulb: 5.3ms to
// concatenate the spans, 3.4ms for the prefix sums), which is well under a
// frame, on a gesture a person made deliberately. Holding eight megabytes to
// save that is the wrong trade.
//
// Nothing is FOLDED either. A case-insensitive search runs the same `RegExp`
// with the `i` flag that the raw scan already uses, rather than searching a
// lowercased copy — which would be a second 7.85MB and, worse, would be wrong:
// `toLowerCase` changes the LENGTH of some strings (Turkish `İ` folds to two
// units), and every hit past such a character would map back to the wrong place
// in the source.
//
// The consequence is honest and worth stating: with nothing cached, a search
// over the reading is about as fast as the engine's own for a small result set
// and several times faster for a large one. The reason to prefer it is not
// speed — it is that a regex can finally run over the reading rather than over
// the markup, and that a literal search can deliberately run over the markup
// instead. Those two are unreachable through `findAll` at any price.

import type { BookId } from "../book/book";
import type { GalleyService } from "../galley/galley";
import type { SourceStamp } from "../source/source";

/** A half-open range, in UTF-16 units, into a book's canonical text. */
export interface SourceRange {
  readonly from: number;
  readonly to: number;
}

/**
 * What a reading is cut from: a registered id and the text Sefer holds for it.
 *
 * A project's Book and a bound REFERENCE are both this. That is the point —
 * the reference scope searches somebody else's book, and there is no reason it
 * should search it differently. What a reference lacks is a `stamp`: it is
 * bound once and does not move while a project is open, so there is no
 * revision to key a cache on and nothing to go stale against.
 */
export interface Subject {
  readonly id: BookId;
  readonly text: string;
  /** The revision `text` belongs to. Absent for a reference. */
  readonly stamp?: SourceStamp;
}

/**
 * One book's reading, and the two questions a hit in it needs answered.
 *
 * Built per call and thrown away with the call. Nothing here outlives the
 * search that asked for it.
 */
export interface Reading {
  readonly bookId: BookId;
  /**
   * The text's stamp when this was cut — a hit's freshness key. Absent for a
   * reference, which has none and needs none: nothing edits one.
   */
  readonly stamp: SourceStamp | undefined;
  /** What a reader sees: the source spans, concatenated, nothing between. */
  readonly text: string;
  /** Where an offset in the reading sits in the canonical text. */
  readonly toSource: (at: number) => number;
  /**
   * Every source piece a span of the reading covers, in order.
   *
   * More than one means the span crossed markup the reading dropped, and the
   * gaps between the pieces are exactly that markup — the same thing the
   * engine's find buffer says with its piece count, and the same reason
   * `Search.spansMarkup` refuses to replace such a hit.
   */
  readonly pieces: (from: number, to: number) => readonly SourceRange[];
}

/**
 * The masks, kept across searches; the readings, not.
 *
 * One of these belongs to whatever is doing the searching — the Find screen
 * makes one and drops it on unmount. It is deliberately NOT a service: a cache
 * keyed by a stamp has no lifetime of its own, and the thing that owns the
 * screen is the thing that should decide when the masks go.
 */
export interface Readings {
  /**
   * `subject`'s reading as its text stands NOW, or `undefined` when the engine
   * has no mask for it — a book it was never told about, a reference bound
   * WITHOUT its text (a lengths-only registration retains no projection to
   * cut), or a registration that is a scheduler pass behind this text.
   *
   * Re-masks when the stamp has moved and reuses the held map when it has not,
   * so typing in the editor costs nothing here until something searches — the
   * work happens on the gesture that needs it, not on the keystroke.
   */
  readonly of: (subject: Subject) => Reading | undefined;
  /** Drop one book's map, or all of them. */
  readonly forget: (id?: BookId) => void;
  /** How many maps are held. For evidence, not for logic. */
  readonly size: () => number;
}

/** A map plus the prefix sums that make `toSource` a binary search. */
interface Held {
  readonly stamp: SourceStamp | undefined;
  readonly rangeCount: number;
  /** `from[n]`, `to[n]` — the source span of range `n`. */
  readonly from: Uint32Array;
  readonly to: Uint32Array;
  /** Where range `n` begins in the reading: the prefix sum of the lengths. */
  readonly starts: Uint32Array;
  readonly readingLength: number;
  /**
   * The length of the text the ENGINE cut these ranges from, in UTF-16.
   *
   * The guard against slicing a string the map does not describe. A book's
   * registration is refreshed a scheduler pass behind its text
   * (`ProjectAnalysis.supply`), so between a keystroke and that pass the Book
   * holds new text while the engine still holds the old — and ranges cut from
   * the old text, applied to the new, produce a reading of plausible-looking
   * nonsense at offsets that point at the wrong characters. Comparing lengths
   * is the cheap half of that check and the one the reader itself recommends.
   */
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

/** The last range beginning at or before `at`. */
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
  // Preallocated by LENGTH: this runs 78,690 times for a Bible and growing the
  // array as it goes is the one thing that would make the rebuild expensive.
  const parts = Array.from<string>({ length: held.rangeCount });
  // SAFETY: the three arrays are `rangeCount` long, built together above.
  for (let n = 0; n < held.rangeCount; n += 1) parts[n] = text.slice(held.from[n]!, held.to[n]!);
  return parts.join("");
};

export const createReadings = (galley: GalleyService): Readings => {
  const held = new Map<BookId, Held>();

  const mapFor = (subject: Subject): Held | undefined => {
    const standing = held.get(subject.id);
    // A stampless subject — a reference — is cached on its id alone; the
    // `sourceLen` guard below is what catches a text that moved anyway.
    if (
      standing !== undefined &&
      (subject.stamp === undefined ? true : standing.stamp === subject.stamp)
    ) {
      return standing;
    }
    const map = galley.mask(subject.id);
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
      // The engine is a scheduler pass behind this text. Answering nothing for
      // this book is right: the next pass republishes, and the Find screen
      // re-runs on that (`createExcerptFeed`'s `edited`). Answering with the
      // stale map would put hits at offsets that are simply wrong.
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
