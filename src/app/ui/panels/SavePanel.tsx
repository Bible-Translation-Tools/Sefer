/**
 * Save & Review: what is about to be written, and the one button that writes it.
 *
 * Two modules write bytes in this application and they are not the same thing,
 * so this screen never lets them share a word. **Save** writes the project
 * file and then records it in git — `SaveCoordinator.saveAll` produces the
 * receipts and `Git.commit` stages exactly those paths, nothing else. The
 * crash journal (`core/recovery`) is the **working-state backup**: it is not
 * an autosave, it does not write your file, and the copy on this page says so
 * in one line rather than leaving people to guess which of the two kept their
 * work.
 *
 * The summary is `core/diff` against the Save baseline — the same hunks the
 * history panel shows — so "3 books, +12 −4" and the diff beside it can never
 * disagree.
 *
 * Git is allowed to be absent. A commit that fails is reported on its own,
 * after a save that succeeded is reported as a success: the bytes reached the
 * disk either way, and telling someone their save failed because a repository
 * does not exist would be a lie.
 */

import { useNavigate } from "@tanstack/solid-router";
import { Effect, Option, Result } from "effect";
import Check from "lucide-solid/icons/check";
import History from "lucide-solid/icons/history";
import LifeBuoy from "lucide-solid/icons/life-buoy";
import Save from "lucide-solid/icons/save";
import { For, Show, createEffect, createSignal } from "solid-js";

import type { BookId } from "../../../core/book/book";
import type { Restorable } from "../../../core/recovery/recovery";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Badge, Button, Card, EmptyState, Input, PanelHeader, toasts } from "../primitives";
import { unsavedChanges } from "./changes";
import { ago, exact } from "./format";

/** The author every Sefer commit carries until accounts reach this screen. */
const AUTHOR = { name: "Sefer", email: "sefer@localhost" } as const;

export function SavePanel() {
  const shell = useShell();
  const navigate = useNavigate();
  const [message, setMessage] = createSignal("");
  const [busy, setBusy] = createSignal(false, { name: "saving" });
  const [journals, setJournals] = createSignal<readonly Restorable[]>([], { name: "journals" });

  const changed = () => unsavedChanges(shell);

  const totals = () => {
    let added = 0;
    let removed = 0;
    for (const book of changed()) {
      added += book.added;
      removed += book.removed;
    }
    return { added, removed };
  };

  /**
   * The journals that hold work Save never wrote.
   *
   * `pending` asks about baselines, so a book whose text is already on disk
   * reports nothing. Reloaded on every `tick` because a save compacts the
   * journal and this line has to stop claiming a backup that is gone.
   */
  const reload = (): void => {
    const project = shell.project();
    if (project === undefined) return;
    void shell.services
      .run(
        shell.services.recovery.pending((bookId: BookId) => {
          const book = project.book(bookId);
          return book === undefined ? Option.none() : shell.services.save.baseline(book);
        }),
      )
      .then((found) => {
        setJournals(found.filter((entry) => entry.projectId === project.id));
      });
  };

  createEffect(
    () => shell.tick(),
    () => {
      reload();
    },
  );

  /** When the working-state backup last wrote something, over every journal. */
  const lastBackup = (): number | undefined => {
    let latest: number | undefined;
    for (const journal of journals())
      for (const entry of journal.entries)
        if (latest === undefined || entry.at > latest) latest = entry.at;
    return latest;
  };

  /**
   * The journals worth OFFERING back.
   *
   * A journal for a book this session already has open is the live backup of
   * what is on screen — restoring it would replay edits the editor is already
   * showing. What earns the banner is a journal for a book nobody reopened:
   * work from a session that ended before Save ran.
   */
  const recovered = (): readonly Restorable[] =>
    journals().filter((journal) => shell.services.seated(journal.bookId) === undefined);

  const restore = (journal: Restorable): void => {
    const project = shell.project();
    if (project === undefined) return;
    void shell.services
      .run(
        Effect.result(
          Effect.gen(function* () {
            // The replay needs a Book to apply onto, and a book nobody opened
            // has none — so it is instantiated first, through the Project that
            // owns its lifetime.
            yield* project.instantiate(journal.bookId);
            return yield* shell.services.recovery.restore(journal.id, (bookId) =>
              shell.services.seated(bookId),
            );
          }),
        ),
      )
      .then((done) => {
        if (Result.isFailure(done)) {
          toasts.error({
            title: t("Could not restore {book}", { book: journal.bookId }),
            message: done.failure.description,
          });
          return;
        }
        toasts.success({
          title: t("Restored {book}", { book: journal.bookId }),
          message: t("The work is in the editor and still unsaved — Save writes the file."),
        });
        shell.bump();
      });
  };

  const discard = (journal: Restorable): void => {
    void shell.services
      .run(Effect.result(shell.services.recovery.discard(journal.id)))
      .then((done) => {
        if (Result.isFailure(done)) {
          toasts.error({ title: t("Could not discard"), message: done.failure.description });
          return;
        }
        toasts.info({ title: t("Discarded the backup for {book}", { book: journal.bookId }) });
        shell.bump();
      });
  };

  const defaultMessage = (): string =>
    t("Edit {count} book(s)", { count: Math.max(changed().length, 1) });

  const commit = async (): Promise<void> => {
    const project = shell.project();
    if (project === undefined || busy()) return;
    setBusy(true);
    const notice = toasts.progress({ title: t("Saving…") });

    const saved = await shell.services.run(
      Effect.result(shell.services.save.saveAll(project.books)),
    );
    if (Result.isFailure(saved)) {
      toasts.update(notice, {
        tone: "error",
        title: t("Save failed"),
        message: saved.failure.description,
        autoClose: false,
      });
      setBusy(false);
      return;
    }
    const receipts = saved.success;
    shell.bump();
    if (receipts.length === 0) {
      toasts.update(notice, { title: t("Nothing to save"), tone: "info" });
      setBusy(false);
      return;
    }
    toasts.update(notice, {
      tone: "success",
      title: t("Saved {count} book(s)", { count: receipts.length }),
    });

    // A one-time read, deliberately: the commit records the message as it
    // stood when Save was pressed, not whatever the field says when the write
    // finishes.
    const staticMessage = message().trim() === "" ? defaultMessage() : message().trim();
    const recorded = await shell.services.run(
      Effect.result(
        Effect.gen(function* () {
          const repo = yield* shell.services.git.init(project.root);
          return yield* shell.services.git.commit(repo, receipts, staticMessage, AUTHOR);
        }),
      ),
    );
    if (Result.isFailure(recorded)) {
      toasts.error({
        title: t("Saved, but not recorded in git"),
        message: t("{reason}: {description}", {
          reason: recorded.failure.reason,
          description: recorded.failure.description ?? t("no detail"),
        }),
      });
    } else {
      toasts.success({
        title: t("Committed {hash}", { hash: recorded.success.slice(0, 7) }),
        message: staticMessage,
      });
      setMessage("");
    }
    setBusy(false);
  };

  return (
    <main class="min-w-0 space-y-4 p-6">
      <PanelHeader
        title={t("Save")}
        subtitle={t("What will be written to disk, and recorded in the project's history.")}
        actions={
          <Button
            icon={<History size={14} />}
            onClick={() => void navigate({ to: "/history", search: {} })}
          >
            {t("History")}
          </Button>
        }
      />

      <Show
        when={shell.project()}
        fallback={<EmptyState icon={<Save size={22} />} title={t("Open a project first.")} />}
      >
        <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div class="min-w-0 space-y-4">
            <Show when={recovered().length > 0}>
              <Card class="space-y-3 border-brand/40" aria-label={t("Recovered work")}>
                <PanelHeader
                  level={3}
                  title={
                    <span class="flex items-center gap-2">
                      <LifeBuoy size={16} class="text-brand" aria-hidden="true" />
                      {t("Recovered work")}
                    </span>
                  }
                  subtitle={t(
                    "Sefer found a working-state backup from an earlier session that was never saved. Restoring puts it back in the editor; it is still unsaved until you Save.",
                  )}
                />
                <ul class="divide-y divide-surface-border">
                  <For each={recovered()}>
                    {(journal) => (
                      <li class="flex flex-wrap items-center gap-2 py-2">
                        <strong class="text-small font-semibold">{journal.bookId}</strong>
                        <code class="min-w-0 truncate font-mono text-smallest text-on-surface-tertiary">
                          {journal.path}
                        </code>
                        <Badge>{t("{count} edit(s)", { count: journal.entries.length })}</Badge>
                        <Button
                          size="sm"
                          variant="tertiary"
                          class="ms-auto"
                          onClick={() => discard(journal)}
                        >
                          {t("Discard")}
                        </Button>
                        <Button size="sm" variant="primary" onClick={() => restore(journal)}>
                          {t("Restore")}
                        </Button>
                      </li>
                    )}
                  </For>
                </ul>
              </Card>
            </Show>

            <Card class="space-y-3" aria-label={t("What will be committed")}>
              <PanelHeader
                level={3}
                title={t("What will be committed")}
                actions={
                  <Show when={changed().length > 0}>
                    <Badge tone="success">+{totals().added}</Badge>
                    <Badge tone="error">−{totals().removed}</Badge>
                  </Show>
                }
              />
              <Show
                when={changed().length > 0}
                fallback={
                  <EmptyState
                    icon={<Check size={20} />}
                    title={t("Nothing has changed since the last save.")}
                    description={t("Saving now would write no bytes and record no commit.")}
                  />
                }
              >
                <ul class="divide-y divide-surface-border" data-changed={changed().length}>
                  <For each={changed()}>
                    {(book) => (
                      <li class="flex flex-wrap items-center gap-2 py-2" data-book={book.bookId}>
                        <strong class="text-small font-semibold text-on-surface-primary">
                          {book.bookId}
                        </strong>
                        <code class="min-w-0 flex-1 truncate font-mono text-smallest text-on-surface-tertiary">
                          {book.path}
                        </code>
                        <Badge>{t("{count} hunk(s)", { count: book.hunks.length })}</Badge>
                        <Badge tone="success">+{book.added}</Badge>
                        <Badge tone="error">−{book.removed}</Badge>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Card>
          </div>

          <Card class="space-y-3 lg:sticky lg:top-6" aria-label={t("Commit")}>
            <label
              class="block text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase"
              for="commit-message"
            >
              {t("Message")}
            </label>
            <Input
              id="commit-message"
              wrapperClass="w-full"
              placeholder={defaultMessage()}
              value={message()}
              onInput={(event) => setMessage(event.currentTarget.value)}
            />
            <Button
              variant="primary"
              class="w-full"
              icon={<Save size={14} />}
              loading={busy()}
              disabled={changed().length === 0}
              onClick={() => void commit()}
            >
              {t("Save and record")}
            </Button>
            <p class="text-smallest text-on-surface-tertiary">
              {t(
                "Sefer keeps a working-state backup while you type; Save writes the file. Only the files Save wrote are recorded.",
              )}
            </p>
            <p class="text-smallest text-on-surface-tertiary" data-backup="last">
              <Show
                when={lastBackup()}
                fallback={t("No working-state backup is waiting to be recovered.")}
              >
                {(at) => (
                  <span title={exact(at())}>
                    {t("Working-state backup: {when}", { when: ago(at()) })}
                  </span>
                )}
              </Show>
            </p>
          </Card>
        </div>
      </Show>
    </main>
  );
}
