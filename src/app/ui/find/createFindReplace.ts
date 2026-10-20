import type { BookId } from "@sefer/text/book";
import { Result } from "effect";
import { createSignal } from "solid-js";

import { t } from "#app/i18n";
import type { useShell } from "#app/ProjectContext";
import { shellKeys } from "#app/settings";
import * as Search from "#core/search/search";

import type { FindBooks } from "./createFindBooks";
import type { FindQuery } from "./createFindQuery";
import type { FindResults } from "./createFindResults";
import type { Scope } from "./helpers";

export interface ReplaceInputs {
  readonly shell: ReturnType<typeof useShell>;
  readonly scope: () => Scope;
  readonly query: FindQuery;
  readonly results: FindResults;
  readonly books: FindBooks;
  readonly run: () => Promise<void>;
}

interface ReplaceState {
  readonly replaceEnabled: () => boolean;
  readonly replacement: () => string;
}

function previewReplace(inputs: ReplaceInputs, state: ReplaceState): void {
  const { shell, scope, results } = inputs;
  const { query } = inputs.query;
  const { signature } = inputs.books;
  const { hits, setProblem, searched, setPreview } = results;
  const { replaceEnabled, replacement } = state;
  if (!replaceEnabled() || scope() === "reference" || scope() === "helps" || hits().length === 0)
    return;
  const current = signature(query(), scope());
  if (current !== searched()) {
    setProblem(t("Run Find again before replacing."));
    return;
  }
  const project = shell.project();
  if (project === undefined) return;
  const selected = hits();
  for (const book of project.books) {
    const matches = selected.filter((hit) => hit.bookId === book.id);
    if (matches.length > 0 && Search.planReplace(book, matches, replacement()) === null) {
      setProblem(t("Results changed or cross markup. Run Find again before replacing."));
      return;
    }
  }
  setProblem("");
  setPreview({ signature: current, hits: selected, insert: replacement() });
}

function applyReplace(inputs: ReplaceInputs, state: ReplaceState): void {
  const { shell, scope, results, run } = inputs;
  const { query } = inputs.query;
  const { signature } = inputs.books;
  const { setProblem, searched, preview, setPreview } = results;
  const snapshot = preview();
  if (snapshot === undefined || !state.replaceEnabled()) return;
  setPreview(undefined);
  if (snapshot.signature !== searched() || snapshot.signature !== signature(query(), scope())) {
    setProblem(t("Search options changed. Preview replacements again."));
    return;
  }
  const project = shell.project();
  if (project === undefined) return;
  const batches = project.books.flatMap((book) => {
    const matches = snapshot.hits.filter((hit) => hit.bookId === book.id);
    return matches.length === 0 ? [] : [{ book, matches }];
  });
  if (
    batches.some(({ book, matches }) => Search.planReplace(book, matches, snapshot.insert) === null)
  ) {
    setProblem(t("Results changed or cross markup. Run Find again before replacing."));
    return;
  }
  let replaced = 0;
  const changed: BookId[] = [];
  for (const { book, matches } of batches) {
    const result = Search.replaceInBook(book, matches, snapshot.insert);
    if (Result.isFailure(result)) break;
    replaced += matches.length;
    changed.push(book.id);
  }
  if (changed.length > 0) shell.changed({ kind: "book.apply", books: changed });
  shell.report(
    t("Replaced {count} match(es) in {books} book(s).", {
      count: replaced,
      books: changed.length,
    }),
  );
  void run();
  if (replaced !== snapshot.hits.length)
    setProblem(t("Some replacements were refused. Review the changed books and run Find again."));
}

export function createFindReplace(inputs: ReplaceInputs) {
  const { shell } = inputs;

  const replaceKey = shellKeys(shell.services.settings).enableReplaceAll;
  const replaceEnabled = () => shell.services.settings.get(replaceKey);
  const [replacement, setReplacement] = createSignal("", { name: "replacement" });
  const state = { replaceEnabled, replacement };

  return {
    replaceEnabled,
    replacement,
    setReplacement,
    previewReplace: (): void => previewReplace(inputs, state),
    applyReplace: (): void => applyReplace(inputs, state),
  };
}

export type FindReplace = ReturnType<typeof createFindReplace>;
