/**
 * What a book search box means, shared by the sidebar's search and the
 * location bar's book picker — the same reading the command palette's "Go to"
 * makes (`shell.location`).
 *
 * Both boxes take a BOOK: the list narrows to the books the words could mean.
 * When the text also names a usable chapter ("mark 3", "Lucas 3:1"), taking
 * the book goes to that chapter rather than to wherever the book was left.
 */

import type { Address } from "#core/location/address";

import type { Location } from "../../location";

/** The chapter a typed place names, if it names one: "Luke 3" and "Luke 3:1" do, "Luke" does not. */
export const chapterOf = (address: Address | undefined): number | undefined => {
  if (address?.kind === "chapters") return address.from;
  if (address?.kind === "verses") return address.from.chapter;
  return undefined;
};

/** The place typed, when it names a chapter of `book`; otherwise `undefined`. */
export const typedChapter = (
  location: Location,
  text: string,
  book?: string,
): Address | undefined => {
  const citation = location.read(text.trim());
  const first = citation.ok ? citation.addresses[0] : undefined;
  if (first === undefined || chapterOf(first) === undefined) return undefined;
  return book === undefined || first.book === book ? first : undefined;
};
