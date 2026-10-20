import type { BookId } from "@sefer/text/book";
import type { SourceStamp } from "@sefer/text/source";
import { Effect } from "effect";

import { sourceRef, type CompareSource, type CompareError, type SourceRef } from "./source";

export type Presence = "both" | "left" | "right";

export interface BookComparison {
  readonly bookId: BookId;
  readonly presence: Presence;
  readonly leftText: string | undefined;
  readonly rightText: string | undefined;
  readonly leftStamp: SourceStamp | undefined;
  readonly rightStamp: SourceStamp | undefined;
  readonly identical: boolean;
}

export interface CompareResult {
  readonly left: SourceRef;
  readonly right: SourceRef;
  readonly books: readonly BookComparison[];
  readonly changedBooks: number;
  readonly leftOnly: number;
  readonly rightOnly: number;
}

const unionOrder = (left: readonly BookId[], right: readonly BookId[]): readonly BookId[] => {
  const seen = new Set(left);
  return [...left, ...right.filter((bookId) => !seen.has(bookId))];
};

export const compareBooks = (
  left: CompareSource,
  right: CompareSource,
): Effect.Effect<CompareResult, CompareError> =>
  Effect.gen(function* () {
    const leftBooks = yield* left.books();
    const rightBooks = yield* right.books();
    const inRight = new Set(rightBooks);
    const inLeft = new Set(leftBooks);

    const books: BookComparison[] = [];
    for (const bookId of unionOrder(leftBooks, rightBooks)) {
      const onLeft = inLeft.has(bookId);
      const onRight = inRight.has(bookId);
      const leftText = onLeft ? yield* left.read(bookId) : undefined;
      const rightText = onRight ? yield* right.read(bookId) : undefined;

      if (leftText !== undefined && rightText !== undefined) {
        books.push({
          bookId,
          presence: "both",
          leftText: leftText.text,
          rightText: rightText.text,
          leftStamp: leftText.stamp,
          rightStamp: rightText.stamp,
          identical: leftText.text === rightText.text,
        });
        continue;
      }

      books.push({
        bookId,
        presence: onLeft ? "left" : "right",
        leftText: leftText?.text,
        rightText: rightText?.text,
        leftStamp: leftText?.stamp,
        rightStamp: rightText?.stamp,
        identical: false,
      });
    }

    return {
      left: sourceRef(left),
      right: sourceRef(right),
      books,
      changedBooks: books.filter((book) => !book.identical).length,
      leftOnly: books.filter((book) => book.presence === "left").length,
      rightOnly: books.filter((book) => book.presence === "right").length,
    } satisfies CompareResult;
  });

export const bookComparison = (result: CompareResult, bookId: BookId): BookComparison | undefined =>
  result.books.find((book) => book.bookId === bookId);
