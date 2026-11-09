import type { NameTable } from "@wycliffeassociates/scripture-kitchen/canon";
import spanish from "@wycliffeassociates/scripture-kitchen/names/es-419";

import type { Locale } from "./paraglide/runtime";

/**
 * canon's reviewed book names for one interface language, past English (which
 * canon always has). Spanish is canon's Latin American table; Persian has no
 * table yet, so it reads English. Each table is a static module, so the bundle
 * carries only the languages listed here.
 */
const TABLES: Readonly<Record<Locale, readonly NameTable[]>> = {
  en: [],
  es: [spanish],
  fa: [],
};

export const canonNames = (locale: Locale): readonly NameTable[] => TABLES[locale];
