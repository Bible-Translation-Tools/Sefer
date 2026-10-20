import type { Address } from "@sefer/text/location/address";

import type { Location } from "../../location";

export const chapterOf = (address: Address | undefined): number | undefined => {
  if (address?.kind === "chapters") return address.from;
  if (address?.kind === "verses") return address.from.chapter;
  return undefined;
};

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
