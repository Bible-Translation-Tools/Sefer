import type { BookId } from "@sefer/text/book";
import {
  chaptersAddress,
  introAddress,
  versesAddress,
  type Address,
} from "@sefer/text/location/address";

import type { PlaceContext } from "../handle";
import type { NoteRecord, Span } from "./rcHelpMarkdown";

export interface Note {
  readonly address: Address;
  readonly openEnded?: true;
  readonly ordinal: number;
  readonly body: string;
  readonly quote?: string;
  readonly heading?: string;
}

export const noteOf = (book: BookId, record: NoteRecord, context?: PlaceContext): Note => {
  const { span } = record;
  const base = {
    ordinal: record.ordinal,
    body: record.body,
    ...(record.quote === undefined ? {} : { quote: record.quote }),
    ...(record.heading === undefined ? {} : { heading: record.heading }),
  };
  switch (span.kind) {
    case "book":
      return { ...base, address: introAddress(book) };
    case "chapter":
      return { ...base, address: chaptersAddress(book, span.chapter) };
    case "chunk": {
      const last = span.last ?? context?.versesIn?.(book, span.chapter);
      const from = { chapter: span.chapter, verse: span.first };
      if (last === undefined)
        return { ...base, address: versesAddress(book, from), openEnded: true };
      return {
        ...base,
        address: versesAddress(book, from, {
          chapter: span.chapter,
          verse: Math.max(last, span.first),
        }),
      };
    }
  }
};

export const answersPlace = (span: Span, place: Address): boolean => {
  switch (place.kind) {
    case "book":
    case "intro":
      return span.kind === "book";
    case "chapters":
      return span.kind === "chapter" && span.chapter >= place.from && span.chapter <= place.to;
    case "verses": {
      if (span.kind !== "chunk") return false;
      const { from, to } = place;
      const afterStart =
        span.chapter > from.chapter ||
        (span.chapter === from.chapter && (span.last ?? Infinity) >= from.verse);
      const beforeEnd =
        span.chapter < to.chapter || (span.chapter === to.chapter && span.first <= to.verse);
      return afterStart && beforeEnd;
    }
  }
};
