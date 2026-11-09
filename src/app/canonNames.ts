import { localeFor, type NameTable } from "@wycliffeassociates/scripture-kitchen/canon";
import spanish from "@wycliffeassociates/scripture-kitchen/names/es-419";

import type { Locale } from "./paraglide/runtime";

/**
 * canon's reviewed name tables this build carries, by canon's locale code.
 * Which table an interface language means is canon's answer (`localeFor`:
 * `es` is `es-419`); this list only says which tables are bundled, one static
 * module each, because a name lookup is synchronous. English is always in
 * canon; a language with no table here (Persian has none in canon) reads
 * English.
 */
const BUNDLED: ReadonlyMap<string, NameTable> = new Map([["es-419", spanish]]);

export const canonNames = (locale: Locale): readonly NameTable[] => {
  const code = localeFor(locale);
  const table = code === undefined ? undefined : BUNDLED.get(code);
  return table === undefined ? [] : [table];
};
