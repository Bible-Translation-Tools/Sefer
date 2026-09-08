import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { Option, Result } from "effect";
import { For, Show, createSignal } from "solid-js";

import { t } from "../app/i18n";
import { useShell } from "../app/ProjectContext";
import { ShellGate } from "../app/ui/ShellGate";
import type { Finding } from "../core/findings/finding";
import * as Findings from "../core/findings/findings";
import * as Fixes from "../core/fixes/fixes";

/**
 * The findings panel: every finding in the project, in one shape.
 *
 * `findings.list` does the ordering (severity, then position, within the
 * project's canonical book order) and `findings.stale` decides the badge. The
 * fix preview is computed on DEMAND — a panel showing four hundred findings
 * pays for none of them until someone asks — and `fixes.preview` refuses one
 * computed from text the book has since moved past, which is the mistake a
 * panel like this invites.
 */

function FindingsPage() {
  const shell = useShell();
  const navigate = useNavigate();
  const [preview, setPreview] = createSignal<Fixes.FixPreview | undefined>(undefined, {
    name: "fixPreview",
  });
  const [note, setNote] = createSignal("");

  const list = (): readonly Finding[] => {
    shell.tick();
    return shell.project() === undefined ? [] : Findings.list(shell.services.projectAnalysis);
  };

  const isStale = (finding: Finding): boolean => {
    shell.tick();
    const book = shell.project()?.book(finding.bookId);
    return book === undefined || Findings.stale(finding, book);
  };

  const analysisFor = (finding: Finding) =>
    Option.getOrUndefined(shell.services.projectAnalysis.analysis(finding.bookId));

  const open = (finding: Finding): void => {
    const project = shell.project();
    if (project === undefined) return;
    const target = Findings.navigateTarget(finding, analysisFor(finding)?.analysis);
    // Leave the aim before navigating: the book route reads it to decide the
    // opening clip (chapter preference) and the editor scrolls to it.
    shell.aim(target.bookId, target.from);
    void navigate({
      to: "/project/$id/book/$book",
      params: {
        id: encodeURIComponent(project.root),
        book: encodeURIComponent(target.bookId),
      },
    });
  };

  const offer = (finding: Finding): void => {
    const book = shell.services.seated(finding.bookId);
    const analysis = analysisFor(finding);
    if (book === undefined || analysis === undefined) {
      setNote(t("open {book} first", { book: finding.bookId }));
      return;
    }
    const previewed = Fixes.preview(finding, book, analysis.analysis);
    if (Result.isFailure(previewed)) {
      setPreview(undefined);
      setNote(t("no fix: {reason}", { reason: previewed.failure.reason }));
      return;
    }
    setNote("");
    setPreview(previewed.success);
  };

  const apply = (fix: Fixes.FixPreview): void => {
    const book = shell.services.seated(fix.finding.bookId);
    if (book === undefined) return;
    const applied = Fixes.apply(fix, book);
    setNote(
      Result.isSuccess(applied)
        ? t("applied {label}", { label: fix.label })
        : t("refused by {rule}", { rule: applied.failure.rule }),
    );
    setPreview(undefined);
    shell.bump();
  };

  return (
    <main>
      <header>
        <h2>{t("Findings")}</h2>
        <span class="muted spacer">{t("{count} in this project", { count: list().length })}</span>
      </header>

      <Show when={note() !== ""}>
        <p class="muted">{note()}</p>
      </Show>

      <Show when={preview()}>
        {(fix) => (
          <section class="card">
            <div class="row">
              <strong>{fix().label}</strong>
              <button
                type="button"
                data-variant="primary"
                class="spacer"
                onClick={() => apply(fix())}
              >
                {t("Apply")}
              </button>
              <button type="button" onClick={() => setPreview(undefined)}>
                {t("Dismiss")}
              </button>
            </div>
            <ul class="list">
              <For each={fix().changes}>
                {(change) => (
                  <li>
                    <code>
                      {change.from}–{change.to}
                    </code>
                    <code>{change.insert === "" ? t("(delete)") : change.insert}</code>
                  </li>
                )}
              </For>
            </ul>
          </section>
        )}
      </Show>

      <ul class="list" data-findings={list().length}>
        <For each={list()}>
          {(finding) => (
            <li data-code={finding.code}>
              <span class="badge" data-severity={finding.severity}>
                {finding.severity}
              </span>
              <strong>{finding.bookId}</strong>
              <code>{finding.code}</code>
              <span>{finding.message}</span>
              <Show when={isStale(finding)}>
                <span class="badge" data-stale="true">
                  {t("stale")}
                </span>
              </Show>
              <button type="button" class="spacer" onClick={() => open(finding)}>
                {t("Go")}
              </button>
              <Show when={finding.fix !== undefined}>
                <button type="button" onClick={() => offer(finding)}>
                  {t("Fix…")}
                </button>
              </Show>
            </li>
          )}
        </For>
      </ul>

      <Show when={list().length === 0}>
        <p class="muted">{t("Nothing to report — or no project is open.")}</p>
      </Show>
    </main>
  );
}

export const Route = createFileRoute("/findings")({
  head: () => ({ meta: [{ title: "Sefer — findings" }] }),
  component: () => <ShellGate>{() => <FindingsPage />}</ShellGate>,
});
