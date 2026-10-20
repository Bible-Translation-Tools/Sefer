import type { Address } from "@sefer/text/location/address";

import type { BookScopeKind } from "#app/ui/primitives";
import type { Documents } from "#core/resources/kinds/handle";
import type { Resource } from "#core/resources/library";
import type * as Search from "#core/search/search";

export type Scope = BookScopeKind | "reference" | "helps";

export interface HelpHit {
  readonly title: string;
  readonly text: string;
  readonly hit: Search.DocumentHit;
}

export interface Searchable {
  readonly resource: Resource;
  readonly documents: Documents;
}

export type Expected = "without" | "with" | "all";

export interface FindSearch {
  readonly q?: string;
  readonly scope?: Scope;
  readonly expect?: string;
  readonly show?: Expected;
}

export interface Over {
  readonly scope?: Scope;
  readonly text?: string;
}

export interface ReplacePreview {
  readonly signature: string;
  readonly hits: readonly Search.Hit[];
  readonly insert: string;
}

export const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export const verseKeys = (address: Address): readonly string[] => {
  if (address.kind !== "verses") return [];
  const { book, from, to } = address;
  if (from.chapter !== to.chapter)
    return [`${book} ${from.chapter}:${from.verse}`, `${book} ${to.chapter}:${to.verse}`];
  const keys: string[] = [];
  for (let verse = from.verse; verse <= to.verse; verse += 1)
    keys.push(`${book} ${from.chapter}:${verse}`);
  return keys;
};
