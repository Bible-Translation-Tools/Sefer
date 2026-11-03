import type { SousCatalog, SousWords } from "#core/findings/messages";

import { uiLocale } from "./locale";
import en from "./messages/sous/en.json";
import es from "./messages/sous/es.json";

/**
 * Sous's sentences, Sefer's words: kitchen ships each finding as a stable id and
 * its params, and these catalogs say it. `en.json` started as kitchen's English
 * (0.1.19); a language missing an id falls back to it.
 */
const CATALOGS: Readonly<Record<string, SousCatalog>> = { en, es };

export const sousWords = (): SousWords => {
  const locale = uiLocale();
  return { locale, catalog: CATALOGS[locale] ?? CATALOGS["en"] ?? {} };
};
