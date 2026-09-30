// messages.ts
//
// A Sous finding's panel sentence, in English.
//
//   describeFinding(finding, pattern, { siteText: "Moses, Moses", bookCount: 66 })
//     → { id: "convention.doubled.separated", params: { word: "Moses", count: 1, total: 895, … } }
//   sousMessage(…)
//     → “Moses” is written twice with only punctuation between here (“Moses, Moses”).
//       The project does this nowhere else; “Moses” appears 895 times.
//
// Kitchen decides WHY a squiggle fired and names it as an id with parameters;
// its English catalog (`sous-messages.en.json`, ICU MessageFormat) is the
// wording. Sefer only formats. A second language is a second catalog keyed by
// the same ids; nothing here assembles a sentence.

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

/** One compiled formatter per id, built the first time the id is shown. */
const formatters = new Map<FindingMessageId, IntlMessageFormat>();

const render = (message: FindingMessage): string => {
  let formatter = formatters.get(message.id);
  if (formatter === undefined) {
    formatter = new IntlMessageFormat(FINDING_MESSAGES_EN[message.id], LOCALE);
    formatters.set(message.id, formatter);
  }
  // No rich-text tags in the catalog, so the result is always one string.
  return String(formatter.format(message.params));
};

/**
 * The sentence for one finding. `pattern` is its own headline row and nothing
 * else, so one squiggle reads as one sentence.
 */
export const sousMessage = (
  finding: Finding,
  pattern: Pattern | undefined,
  context: FindingMessageContext,
): string => render(describeFinding(finding, pattern, context));
