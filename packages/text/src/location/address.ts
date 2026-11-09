import type { BookId } from "../book";

export interface Point {
  readonly chapter: number;
  readonly verse: number;
  /** `a` in `3a`. Absent for the whole verse. */
  readonly segment?: string;
}

export type Address =
  | { readonly kind: "book"; readonly book: BookId }
  | { readonly kind: "intro"; readonly book: BookId }
  | {
      readonly kind: "chapters";
      readonly book: BookId;
      readonly from: number;
      readonly to: number;
    }
  | {
      readonly kind: "verses";
      readonly book: BookId;
      readonly from: Point;
      readonly to: Point;
    };

export const bookAddress = (book: BookId): Address => ({ kind: "book", book });

export const introAddress = (book: BookId): Address => ({ kind: "intro", book });

export const chaptersAddress = (book: BookId, from: number, to: number = from): Address => ({
  kind: "chapters",
  book,
  from,
  to,
});

export const versesAddress = (book: BookId, from: Point, to: Point = from): Address => ({
  kind: "verses",
  book,
  from,
  to,
});

export interface Span {
  readonly from: number;
  readonly to: number;
}

/**
 * Where an Address is in one text, galley's answer (`resolve`) in UTF-16:
 * found, missing (with the enclosing place that IS there), or ambiguous when
 * malformed text offers two answers. Never a silent nearest: an action that
 * attaches or edits must not guess.
 *
 * `from..to` is the place's tile: a verse ends where the next verse's heading
 * or paragraph marker begins, and `opening` is where its own begins, so
 * `opening..to` is the verse with the heading that introduces it.
 */
export type Resolution =
  | {
      readonly kind: "found";
      readonly from: number;
      readonly to: number;
      readonly opening: number;
      /** What the span actually is: `LUK 1:1-2` when `LUK 1:2` landed in a bridge. */
      readonly covers: Address;
      /** A segment (`3a`) found as its whole verse, because the text does not divide it. */
      readonly coarser: boolean;
    }
  | {
      readonly kind: "missing";
      readonly missing: "intro" | "chapter" | "verse";
      /** The nearest enclosing place that is there: the chapter, for a verse. */
      readonly within?: Span;
    }
  | {
      /** Malformed text: two `\c 3`s, or two anchors for one verse. */
      readonly kind: "ambiguous";
      readonly spans: readonly Span[];
    };
