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

/**
 * Point order: chapter, then verse, then segment. A whole verse sorts before
 * its segments, so `3 <= 3a`; that is what lets `3-3a` be a valid range and
 * `3a-3` not.
 */
export const comparePoints = (a: Point, b: Point): number =>
  a.chapter - b.chapter ||
  a.verse - b.verse ||
  (a.segment ?? "").localeCompare(b.segment ?? "", "en");

const pointText = (point: Point): string => `${point.verse}${point.segment ?? ""}`;

const coordinates = (address: Address, intro: string): string => {
  switch (address.kind) {
    case "book":
      return "";
    case "intro":
      return intro;
    case "chapters":
      return address.from === address.to ? String(address.from) : `${address.from}-${address.to}`;
    case "verses": {
      const { from, to } = address;
      const head = `${from.chapter}:${pointText(from)}`;
      if (comparePoints(from, to) === 0) return head;
      if (from.chapter === to.chapter) return `${head}-${pointText(to)}`;
      return `${head}-${to.chapter}:${pointText(to)}`;
    }
  }
};

/**
 * U23003's basic reference: `LUK 1:1-2`, `MAT 2-4`, `LUK 0` for the
 * introduction. The machine spelling of an Address — for a link, a log line,
 * an interchange file — so Sefer invents no format of its own.
 */
export const addressCode = (address: Address): string => {
  const rest = coordinates(address, "0");
  return rest === "" ? address.book : `${address.book} ${rest}`;
};

/**
 * What a person reads: `Luke 1:1-2`, `Lucas 1:1-2`. The caller supplies the
 * book's name (the project's own when it has one — `displayName` in the
 * application's location service) and the word for an introduction, because
 * both are the project's language and not this module's.
 */
export const addressLabel = (address: Address, bookName: string, intro: string): string => {
  const rest = coordinates(address, intro);
  return rest === "" ? bookName : `${bookName} ${rest}`;
};
