/**
 * A Translation Note, as everything above the reader sees it: the record the
 * plan names (§4, "A kind plus a reader: normalization"). WA's Markdown
 * chunks and unfoldingWord's TSV rows would both arrive as this; a pane, a
 * search and a link see one shape and cannot tell which repository it came
 * from.
 */

import type { BookId } from "../../../book/book";
import {
  chaptersAddress,
  introAddress,
  versesAddress,
  type Address,
} from "../../../location/address";
import type { PlaceContext } from "../handle";
import type { NoteRecord, Span } from "./rcHelpMarkdown";

export interface Note {
  /** `GEN 1:28-29` · `GEN 1` (its introduction) · `GEN intro`. */
  readonly address: Address;
  /**
   * The chunk runs to its chapter's end and no verse count was lent to say
   * where that is, so `address` names only its first verse.
   */
  readonly openEnded?: true;
  /** Position among the notes at that place: headings repeat, so this is the identity. */
  readonly ordinal: number;
  /** Markdown, exact. */
  readonly body: string;
  /** WA: the heading, the phrase explained; uW: the Quote column. */
  readonly quote?: string;
  /** The heading line exactly as written, so `heading + body` is the file's text. */
  readonly heading?: string;
}

/**
 * A record's Address. The layout's last chunk closes at the chapter's end,
 * which needs a verse count: `context.versesIn` lends one (today the open
 * project's table of contents), and without it the Address is the chunk's
 * first verse, marked `openEnded`.
 */
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

/**
 * Does the note at `span` answer a reader standing at `place`? A verse place
 * asks for the chunks covering that verse — no verse count needed, an open
 * chunk covers everything from its first verse on; a chapter's head asks for
 * the chapter's introduction; the book's introduction answers `intro` and the
 * whole book. Nothing answers more widely than it was asked: a chapter's
 * introduction is not repeated beside every verse of it.
 */
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
      // The chunk is [first, last] in one chapter; the place may cross chapters.
      const afterStart =
        span.chapter > from.chapter ||
        (span.chapter === from.chapter && (span.last ?? Infinity) >= from.verse);
      const beforeEnd =
        span.chapter < to.chapter || (span.chapter === to.chapter && span.first <= to.verse);
      return afterStart && beforeEnd;
    }
  }
};
