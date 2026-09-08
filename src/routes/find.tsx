import { createFileRoute } from "@tanstack/solid-router";
import { Result } from "effect";
import { For, Show, createSignal } from "solid-js";

import { t } from "../app/i18n";
import { useShell } from "../app/ProjectContext";
import { ResultCard } from "../app/ui/ResultCard";
import { ShellGate } from "../app/ui/ShellGate";
import * as Search from "../core/search/search";

/**
 * Find across the project, and replace one match.
 *
 * The core module does the whole of the work: `find` scans the open Books,
 * `resolveHit` decides whether a hit can still be trusted, and `replace` goes
 * through the book's one write path so the editing rules judge the
 * replacement. Nothing here re-derives an offset — a hit whose book has moved
 * on is shown as stale and refuses.
 *
 * Only single-hit replace is offered. Replace-all across a project is a
 * MultiBook operation with one Undo per book, and offering the button before
 * that flow is wired would be offering something we cannot take back.
 */

function Find() {
  const shell = useShell();
  const [text, setText] = createSignal("");
  const [insert, setInsert] = createSignal("");
  const [hits, setHits] = createSignal<readonly Search.Hit[]>([], { name: "hits" });
  const [problem, setProblem] = createSignal("");
  const [opened, setOpened] = createSignal<Search.Hit | undefined>(undefined, {
    name: "openedHit",
  });

  const run = (): void => {
    const project = shell.project();
    if (project === undefined) return;
    const found = Search.find(project.books, { text: text() }, { limit: 200 });
    if (Result.isFailure(found)) {
      setProblem(found.failure.description);
      setHits([]);
      return;
    }
    setProblem("");
    setOpened(undefined);
    setHits(found.success);
  };

  const stale = (hit: Search.Hit): boolean => {
    shell.tick();
    const project = shell.project();
    return project === undefined || Search.resolveHit(hit, project.books) === null;
  };

  const replaceOne = (hit: Search.Hit): void => {
    const project = shell.project();
    if (project === undefined) return;
    const result = Search.replace(hit, insert(), project.books);
    shell.report(
      Result.isSuccess(result)
        ? t("replaced 1 match in {book}", { book: hit.bookId })
        : t("refused by {rule}", { rule: result.failure.rule }),
    );
    shell.bump();
    run();
  };

  const bookFor = (hit: Search.Hit) => shell.services.seated(hit.bookId);

  // One memo for the result card, not one per render: the window analyses the
  // chapter it shows, and a fresh memo each render would re-parse it.
  const analyze = shell.services.galley.memoize();

  return (
    <main>
      <header>
        <h2>{t("Find")}</h2>
      </header>

      <Show when={shell.project()} fallback={<p class="muted">{t("Open a project first.")}</p>}>
        <div class="row">
          <input
            type="search"
            placeholder={t("Find in project")}
            value={text()}
            onInput={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") run();
            }}
          />
          <input
            type="text"
            placeholder={t("Replace with")}
            value={insert()}
            onInput={(event) => setInsert(event.currentTarget.value)}
          />
          <button type="button" data-variant="primary" onClick={run}>
            {t("Find")}
          </button>
          <span class="muted spacer">{t("{count} hits", { count: hits().length })}</span>
        </div>

        <Show when={problem() !== ""}>
          <p class="problem">{problem()}</p>
        </Show>

        <ul class="list" data-hits={hits().length}>
          <For each={hits()}>
            {(hit) => (
              <li data-book={hit.bookId}>
                <strong>
                  {hit.ref.book} {hit.ref.chapter}
                  {hit.ref.verse === undefined ? "" : `:${hit.ref.verse}`}
                </strong>
                <code>{hit.preview}</code>
                <Show
                  when={!stale(hit)}
                  fallback={
                    <span class="badge spacer" data-stale="true">
                      {t("stale")}
                    </span>
                  }
                >
                  <button type="button" class="spacer" onClick={() => setOpened(hit)}>
                    {t("Show")}
                  </button>
                  <button type="button" onClick={() => replaceOne(hit)}>
                    {t("Replace")}
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ul>

        <Show when={opened()}>
          {(hit) => (
            <Show when={bookFor(hit())} keyed>
              {(book) => (
                <section class="card">
                  <p class="muted">
                    {t("{book} — the chapter this hit lives in", { book: book.id })}
                  </p>
                  <ResultCard book={book} at={hit().from} analyze={analyze} />
                </section>
              )}
            </Show>
          )}
        </Show>
      </Show>
    </main>
  );
}

export const Route = createFileRoute("/find")({
  head: () => ({ meta: [{ title: "Sefer — find" }] }),
  component: () => <ShellGate>{() => <Find />}</ShellGate>,
});
