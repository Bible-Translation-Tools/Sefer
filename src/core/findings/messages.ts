// messages.ts
//
// A Sous finding's two sentences, in English: the headline a squiggle shows,
// and the details behind "Why?".
//
//   describeSous(finding, pattern, { siteText: ";\"", bookCount: 66, … })
//     → { id: "convention.runShape", params: { cluster: ";\"", … }, queries: [ … ] }
//   render(…, "headline")  → ;" appears only 2 times.
//   render(…, "details")   → ; stands alone 4,878 of 4,904 times. …
//   renderRich(…, "headline", (glyph) => <Kbd>{glyph}</Kbd>)
//     → [<Kbd>;"</Kbd>, " appears only 2 times."]
//
// Kitchen decides WHY a squiggle fired and names it as an id with parameters;
// its English catalog (`sous-messages.en.json`, ICU MessageFormat) is the
// wording. Sefer only formats. A second language is a second catalog keyed by
// the same ids; nothing here assembles a sentence.
//
// The catalog wraps every mark it quotes in a `<g>` tag, since a mark in
// quotation marks cannot be read when the mark is one. `render` is the plain
// string, the tag dropped and the mark kept; `renderRich` hands each mark to
// the caller, which draws it. A screen renders rich from the descriptor, never
// by parsing the plain string back.

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

/** Sefer's numbers are English until the shell has a locale to hand in. */
const LOCALE = "en";

/** The squiggle's sentence, or the supporting numbers behind it. */
export type Tier = "headline" | "details";

/** One compiled formatter per id and tier, built the first time it is shown. */
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

/** A described finding's sentence as plain text, each mark bare. */
export const render = (message: FindingMessage, tier: Tier = "headline"): string => {
  const out = formatterOf(message, tier).format<string>({
    ...message.params,
    g: (chunks) => chunks.join(""),
  });
  return Array.isArray(out) ? out.join("") : String(out);
};

/**
 * A described finding's sentence with each mark handed to `glyph`, which draws
 * it: the sentence's text and the caller's marks, in order.
 */
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

/**
 * What kitchen says about one finding: an id with parameters, and the literal
 * searches behind it. `pattern` is its own headline row and nothing else, so
 * one squiggle reads as one sentence.
 */
export const describeSous = (
  finding: Finding,
  pattern: Pattern | undefined,
  context: FindingMessageContext,
): FindingMessage => describeFinding(finding, pattern, context);
