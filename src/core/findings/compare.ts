// compare.ts
//
// What a Sous sentence is comparing, as two searches.
//
//   “'” comes right before “,” here (“',”). This project writes them the
//   other way round, “,'”, 171 times; “',” appears 4 times.
//     → { here: text "',", usual: text ",'" }
//
// A convention finding says "this form, where the project usually writes that
// one". Both forms are already PARAMETERS of kitchen's descriptor — the words
// the sentence quotes — so the comparison is read off the same descriptor the
// message is rendered from, never parsed back out of the English. A lane whose
// forms are literal text gives literal searches; Placement names a KIND of
// neighbour ("a letter"), so its searches are a regex for the glyph beside
// that kind. A lane with nothing to compare (hygiene, presence, lengths) has
// no comparison at all.
//
// What is searched is the text as the reader sees it (or its USFM), not the
// stream Sous measured, so the counts are close to the sentence's and not
// promised equal.

import type { FindingMessage } from "../galley";

/** What touches a glyph, in the descriptor's own words. */
export type Touch = "letter" | "space" | "digit" | "punctuation";

/**
 * One side of a comparison: a query, and what to call it.
 *
 * `shown` is the form as a reader recognises it — the literal text, or the
 * glyph beside a kind of neighbour — for the screen to word. `text`/`regex`/
 * `wholeWord` are a search query (`core/search`'s `Query`, case-sensitive
 * always: case is often the very thing being compared).
 */
export interface Probe {
  readonly text: string;
  /** A regex in Unicode mode: the classes below are `\p{…}`. */
  readonly regex?: boolean;
  readonly wholeWord?: boolean;
  readonly shown:
    | { readonly kind: "text"; readonly text: string }
    | {
        readonly kind: "touch";
        readonly glyph: string;
        readonly side: "before" | "after";
        readonly touch: Touch;
      };
}

export interface Comparison {
  /** The form the finding is about. */
  readonly here: Probe;
  /** What the project usually writes instead, when the sentence names one. */
  readonly usual?: Probe;
}

const literal = (text: string, wholeWord = false): Probe => ({
  text,
  ...(wholeWord ? { wholeWord: true } : {}),
  shown: { kind: "text", text },
});

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const TOUCH: Record<Touch, string> = {
  letter: "[\\p{L}\\p{M}]",
  space: "\\s",
  digit: "\\p{N}",
  punctuation: "[^\\p{L}\\p{M}\\p{N}\\s]",
};

/**
 * The glyph with a kind of neighbour on one side, as a regex: `,` followed by
 * a letter is `,(?=[\p{L}\p{M}])`. The neighbour is a lookaround, so the hit
 * is the glyph alone and that is what the list marks. `digit` is the pooled
 * digit glyph, which is any digit.
 */
const touching = (glyph: string, digit: boolean, side: "before" | "after", touch: Touch): Probe => {
  const self = digit ? "\\p{N}" : escape(glyph);
  const text = side === "before" ? `${self}(?=${TOUCH[touch]})` : `(?<=${TOUCH[touch]})${self}`;
  return { text, regex: true, shown: { kind: "touch", glyph, side, touch } };
};

export const comparisonOf = (message: FindingMessage): Comparison | undefined => {
  switch (message.id) {
    case "convention.exactNeighbor": {
      const { pair, glyph, usual } = message.params;
      return usual === ""
        ? { here: literal(pair) }
        : { here: literal(pair), usual: literal(glyph + usual) };
    }
    case "convention.exactNeighbor.swapped": {
      const { pair, reversedPair } = message.params;
      return { here: literal(pair), usual: literal(reversedPair) };
    }
    case "convention.placement.precedes":
    case "convention.placement.follows": {
      const { glyph, digit, neighbor, usual } = message.params;
      const side = message.id === "convention.placement.precedes" ? "before" : "after";
      return {
        here: touching(glyph, digit, side, neighbor),
        ...(usual === neighbor ? {} : { usual: touching(glyph, digit, side, usual) }),
      };
    }
    case "convention.bookRate.precedes":
    case "convention.bookRate.follows": {
      const { glyph, digit, neighbor } = message.params;
      const side = message.id === "convention.bookRate.precedes" ? "before" : "after";
      return { here: touching(glyph, digit, side, neighbor) };
    }
    case "convention.runShape": {
      const { cluster, hasUsualCluster, usualCluster } = message.params;
      if (cluster === "") return undefined;
      return hasUsualCluster
        ? { here: literal(cluster), usual: literal(usualCluster) }
        : { here: literal(cluster) };
    }
    case "convention.rarity": {
      const { glyph, hasUsual, usual } = message.params;
      return hasUsual ? { here: literal(glyph), usual: literal(usual) } : { here: literal(glyph) };
    }
    case "convention.casing": {
      const { word, usualForm, usualWord } = message.params;
      return usualForm === "mixed" || usualWord === ""
        ? { here: literal(word, true) }
        : { here: literal(word, true), usual: literal(usualWord, true) };
    }
    case "convention.doubled.bare":
    case "convention.doubled.separated": {
      const { text, word } = message.params;
      return { here: literal(text), usual: literal(word, true) };
    }
    case "convention.letterRun":
      return { here: literal(message.params.run) };
    case "convention.wordLength":
      return { here: literal(message.params.word, true) };
    default:
      return undefined;
  }
};
