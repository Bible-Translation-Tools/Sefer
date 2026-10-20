import { createEffect, untrack } from "solid-js";

import type { FindBooks } from "./createFindBooks";
import type { FindQuery } from "./createFindQuery";
import type { createFindSources } from "./createFindSources";
import type { FindSearch, Over, Scope } from "./helpers";

export interface TriggersInputs {
  readonly asked: () => string;
  readonly scope: () => Scope;
  readonly query: FindQuery;
  readonly books: FindBooks;
  readonly sources: ReturnType<typeof createFindSources>;
  readonly run: (over?: Over) => Promise<void>;
  readonly ask: (next: FindSearch) => void;
}

export function createFindTriggers(inputs: TriggersInputs) {
  const { asked, scope, run, ask } = inputs;
  const { text, setText, matchCase, wholeWord, regex, markup } = inputs.query;
  const { custom } = inputs.books;
  const { bound } = inputs.sources;

  const commit = (): void => {
    if (asked() === text()) void run({ text: text() });
    else ask({ q: text() });
  };

  let lastAsked: { readonly q: string; readonly scope: string } | undefined;
  createEffect(
    () => ({
      q: asked(),
      scope: scope(),
      references: scope() === "reference" ? bound().ids.join("\n") : "",
    }),
    (now) => {
      if (lastAsked?.q !== now.q || lastAsked.scope !== now.scope) setText(now.q);
      lastAsked = { q: now.q, scope: now.scope };
      untrack(() => {
        void run({ scope: now.scope, text: now.q });
      });
    },
  );

  let toggled = false;
  createEffect(
    () => [matchCase(), wholeWord(), regex(), markup(), scope() === "custom" ? custom() : 0],
    () => {
      if (!toggled) {
        toggled = true;
        return;
      }
      untrack(commit);
    },
  );

  return { commit };
}
