import { IntlMessageFormat } from "intl-messageformat";

import {
  describeFinding,
  FINDING_MESSAGES_EN,
  type Finding,
  type FindingMessage,
  type FindingMessageContext,
  type FindingMessageId,
  type Pattern,
} from "../galley";

export type Tier = "headline" | "details";

/**
 * Every Sous message in one language, by kitchen's stable id: kitchen ships the
 * id and its params, the host owns the words. A partial catalog falls back to
 * kitchen's English for an id it lacks.
 */
export type SousCatalog = Readonly<
  Partial<Record<FindingMessageId, { readonly headline?: string; readonly details?: string }>>
>;

/** A catalog and the locale its plurals follow. */
export interface SousWords {
  readonly locale: string;
  readonly catalog: SousCatalog;
}

const ENGLISH: SousWords = { locale: "en", catalog: FINDING_MESSAGES_EN };

const formatters = new Map<string, IntlMessageFormat>();

const formatterOf = (message: FindingMessage, tier: Tier, words: SousWords): IntlMessageFormat => {
  // Per tier: a translation may carry the headline before anyone has translated the details.
  const own = words.catalog[message.id]?.[tier];
  const locale = own === undefined ? ENGLISH.locale : words.locale;
  const key = `${locale}:${message.id}:${tier}`;
  let formatter = formatters.get(key);
  if (formatter === undefined) {
    formatter = new IntlMessageFormat(own ?? FINDING_MESSAGES_EN[message.id][tier], locale);
    formatters.set(key, formatter);
  }
  return formatter;
};

export const render = (
  message: FindingMessage,
  tier: Tier = "headline",
  words: SousWords = ENGLISH,
): string => {
  const out = formatterOf(message, tier, words).format<string>({
    ...message.params,
    g: (chunks) => chunks.join(""),
  });
  return Array.isArray(out) ? out.join("") : String(out);
};

export const renderRich = <T>(
  message: FindingMessage,
  tier: Tier,
  glyph: (text: string) => T,
  words: SousWords = ENGLISH,
): readonly (string | T)[] => {
  const out = formatterOf(message, tier, words).format<T>({
    ...message.params,
    g: (chunks) => glyph(chunks.join("")),
  });
  return Array.isArray(out) ? out : [out];
};

export const describeSous = (
  finding: Finding,
  pattern: Pattern | undefined,
  context: FindingMessageContext,
): FindingMessage => describeFinding(finding, pattern, context);
