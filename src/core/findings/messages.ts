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

const LOCALE = "en";

export type Tier = "headline" | "details";

const formatters = new Map<`${FindingMessageId}:${Tier}`, IntlMessageFormat>();

const formatterOf = (message: FindingMessage, tier: Tier): IntlMessageFormat => {
  const key = `${message.id}:${tier}` as const;
  let formatter = formatters.get(key);
  if (formatter === undefined) {
    formatter = new IntlMessageFormat(FINDING_MESSAGES_EN[message.id][tier], LOCALE);
    formatters.set(key, formatter);
  }
  return formatter;
};

export const render = (message: FindingMessage, tier: Tier = "headline"): string => {
  const out = formatterOf(message, tier).format<string>({
    ...message.params,
    g: (chunks) => chunks.join(""),
  });
  return Array.isArray(out) ? out.join("") : String(out);
};

export const renderRich = <T>(
  message: FindingMessage,
  tier: Tier,
  glyph: (text: string) => T,
): readonly (string | T)[] => {
  const out = formatterOf(message, tier).format<T>({
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
