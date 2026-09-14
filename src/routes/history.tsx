import { createFileRoute } from "@tanstack/solid-router";
import { Effect, Result } from "effect";
import { For, Show, createSignal } from "solid-js";

import { t } from "../app/i18n";
import { useShell } from "../app/ProjectContext";
import { Button, Card, PanelHeader } from "../app/ui/primitives";
import { ShellGate } from "../app/ui/ShellGate";
import type { Commit } from "../core/git/git";
import { Git, repositoryPath } from "../core/git/git";
import { decode } from "../core/source/source";

/**
 * The project's history, and one previous version read-only.
 *
 * Read-only is the point: a previous version is bytes from Git, decoded
 * through `source.decode` like any other file, and shown. It is deliberately
 * NOT loaded into a Book — restoring a version is an edit to the working text,
 * and that flow (a diff, a confirmation, one undoable operation) is not built
 * yet, so the screen shows and stops.
 */

interface Shown {
  readonly commit: Commit;
  readonly path: string;
  readonly text: string;
}

function History() {
  const shell = useShell();
  const [log, setLog] = createSignal<readonly Commit[] | undefined>(undefined, { name: "gitLog" });
  const [problem, setProblem] = createSignal("");
  const [shown, setShown] = createSignal<Shown | undefined>(undefined, { name: "shownVersion" });

  const load = (): void => {
    const project = shell.project();
    if (project === undefined) return;
    void shell.services
      .run(
        Effect.gen(function* () {
          const git = yield* Git;
          const repo = yield* git.open(project.root);
          return yield* git.log(repo);
        }).pipe(Effect.result),
      )
      .then((result) => {
        if (Result.isFailure(result)) {
          setProblem(t("no history: {reason}", { reason: result.failure.reason }));
          setLog([]);
          return;
        }
        setProblem("");
        setLog(result.success);
      });
  };
  load();

  const show = (commit: Commit): void => {
    const project = shell.project();
    const book = shell.focused() ?? project?.books[0];
    if (project === undefined || book === undefined) return;
    // Git addresses paths relative to the repository root; `repositoryPath`
    // is the one place that conversion lives, and it refuses a path outside.
    const inside = repositoryPath(project.root, book.path);
    if (inside._tag === "None") {
      setProblem(t("{path} is outside the repository", { path: book.path }));
      return;
    }
    const relative = inside.value;
    void shell.services
      .run(
        Effect.gen(function* () {
          const git = yield* Git;
          const repo = yield* git.open(project.root);
          return yield* git.show(repo, commit.id, relative);
        }).pipe(Effect.result),
      )
      .then((result) => {
        if (Result.isFailure(result)) {
          setProblem(t("could not read that version: {reason}", { reason: result.failure.reason }));
          return;
        }
        const decoded = decode(result.success);
        if (Result.isFailure(decoded)) {
          setProblem(t("that version is not valid UTF-8"));
          return;
        }
        setShown({ commit, path: relative, text: decoded.success.text });
      });
  };

  return (
    <main class="min-w-0 space-y-4 p-6">
      <PanelHeader title={t("History")} actions={<Button onClick={load}>{t("Reload")}</Button>} />

      <Show
        when={shell.project()}
        fallback={<p class="text-small text-on-surface-tertiary">{t("Open a project first.")}</p>}
      >
        <Show when={problem() !== ""}>
          <p class="rounded-md bg-surface-error px-4 py-3 text-small text-on-surface-error">
            {problem()}
          </p>
        </Show>

        <Show
          when={log()}
          fallback={<p class="text-small text-on-surface-tertiary">{t("Reading…")}</p>}
        >
          {(commits) => (
            <ul class="flex flex-col gap-2" data-commits={commits().length}>
              <For each={commits()}>
                {(commit) => (
                  <li data-commit={commit.id}>
                    <Card class="flex flex-wrap items-center gap-3">
                      <code class="font-mono text-small text-on-surface-tertiary">
                        {commit.id.slice(0, 8)}
                      </code>
                      <span class="text-small">{commit.message}</span>
                      <span class="text-small text-on-surface-tertiary">{commit.author.name}</span>
                      <Button size="sm" class="ms-auto" onClick={() => show(commit)}>
                        {t("Show")}
                      </Button>
                    </Card>
                  </li>
                )}
              </For>
            </ul>
          )}
        </Show>

        <Show when={shown()}>
          {(version) => (
            <Card class="space-y-3">
              <div class="flex flex-wrap items-center gap-3">
                <strong class="text-small">{version().path}</strong>
                <code class="font-mono text-small text-on-surface-tertiary">
                  {version().commit.id.slice(0, 8)}
                </code>
                <Button size="sm" class="ms-auto" onClick={() => setShown(undefined)}>
                  {t("Close")}
                </Button>
              </div>
              <pre class="max-h-[60vh] overflow-auto rounded-md bg-surface-secondary p-3 font-mono text-smallest">
                <code>{version().text}</code>
              </pre>
            </Card>
          )}
        </Show>
      </Show>
    </main>
  );
}

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "Sefer — history" }] }),
  component: () => <ShellGate>{() => <History />}</ShellGate>,
});
