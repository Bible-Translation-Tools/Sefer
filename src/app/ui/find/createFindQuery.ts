import { createEffect, createSignal, untrack } from "solid-js";

import type * as Search from "#core/search/search";

import type { Over } from "./helpers";

export function createFindQuery(asked: () => string) {
  // The signal's initial value from the URL, not a derivation of it.
  const [text, setText] = createSignal(untrack(asked), { name: "query" });
  const [regex, setRegex] = createSignal(false, { name: "regex" });
  const [markup, setMarkup] = createSignal(false, { name: "markup" });
  const [matchCase, setMatchCase] = createSignal(false, { name: "matchCase" });
  const [wholeWord, setWholeWord] = createSignal(false, { name: "wholeWord" });
  const [box, setBox] = createSignal<HTMLInputElement | undefined>(undefined, { name: "box" });

  createEffect(
    () => box(),
    (input) => {
      if (input === undefined) return;
      input.focus();
      input.select();
    },
  );

  const query = (over?: Over): Search.Query => ({
    text: over?.text ?? text(),
    caseSensitive: matchCase(),
    wholeWord: wholeWord(),
    regex: regex(),
  });

  return {
    text,
    setText,
    regex,
    setRegex,
    markup,
    setMarkup,
    matchCase,
    setMatchCase,
    wholeWord,
    setWholeWord,
    setBox,
    query,
  };
}

export type FindQuery = ReturnType<typeof createFindQuery>;
