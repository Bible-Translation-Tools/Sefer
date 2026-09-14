/**
 * Save & Review: what has changed, and the one button that records it.
 *
 * Three things keep your work, they are not the same thing, and this screen
 * never lets them share a word.
 *
 *   * The FILE is written on its own. `SaveCoordinator.autosave`, armed per
 *     book by the shell with `DEFAULT_AUTOSAVE_POLICY`, writes the book to
 *     disk shortly after typing pauses (and at most 15 s into a long burst).
 *     Nobody presses anything for that, so this page must never claim the
 *     work is unwritten until someone does.
 *   * The WORKING-STATE BACKUP is the crash journal (`core/recovery`), kept
 *     while you type. It is not the file and it is not a version: it exists
 *     so a session that ended badly can be replayed into the editor.
 *   * A VERSION is what this screen adds, and only on a deliberate press:
 *     `SaveCoordinator.saveAll` writes anything still pending and `Git.commit`
 *     records exactly those paths under the message you wrote.
 *
 * The summary is `core/diff` against the last RECORDED version — the blob at
 * HEAD, read by `recorded.ts` — and NOT against the Save baseline. The disk
 * baseline moves on its own about a second after typing stops, so a review
 * built on it shows an empty diff for a session full of work. The Save
 * baseline is kept for exactly one thing on this screen: the muted line that
 * says whether anything is still to be written.
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
import Undo2 from "lucide-solid/icons/undo-2";
import { For, Show, createEffect, createSignal } from "solid-js";

import type { BookId } from "../../../core/book/book";
import * as Diff from "../../../core/diff/diff";
import type { Restorable } from "../../../core/recovery/recovery";
import type { SourceStamp } from "../../../core/source/source";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Badge, Button, Card, Dialog, EmptyState, Input, PanelHeader, toasts } from "../primitives";
import { bookName } from "../workspace/books";
import { metadataOf } from "../workspace/project";
import { recordedChanges, unsavedChanges, type BookChanges } from "./changes";
import { DiffView } from "./DiffView";
import { ago, exact } from "./format";
import { createRecordedVersion } from "./recorded";

/** A row in the book list; the look is shared with the history timeline. */
const ROW = [
  "flex w-full cursor-pointer flex-col gap-1 px-3.5 py-2.5 text-start transition-colors",
  "hover:bg-surface-secondary",
  "aria-[current=true]:bg-brand-light",
  "aria-[current=true]:shadow-[inset_0.1875rem_0_0_0_var(--brand-base)]",
].join(" ");

interface Confirmation {
  readonly title: string;
  readonly description: string;
  readonly label: string;
  readonly run: () => void;
}

/** The author every Sefer commit carries until accounts reach this screen. */
const AUTHOR = { name: "Sefer", email: "sefer@localhost" } as const;

export function SavePanel() {
  const shell = useShell();
  const navigate = useNavigate();
  const [message, setMessage] = createSignal("");
  const [busy, setBusy] = createSignal(false, { name: "saving" });
  const [journals, setJournals] = createSignal<readonly Restorable[]>([], { name: "journals" });
  const [picked, setPicked] = createSignal<BookId | undefined>(undefined, { name: "reviewBook" });
  const [confirming, setConfirming] = createSignal<Confirmation | undefined>(undefined, {
    name: "confirmRevert",
  });

  const version = createRecordedVersion(shell);

  /**
   * The review, against the last RECORDED version — never against the disk.
   * `autosave` writes about a second after typing stops, so a review built on
   * the disk baseline reports an empty session's worth of work as nothing at
   * all. See `changes.ts` for the two baselines.
   */
  const changed = () => recordedChanges(shell, version.recorded());

  /** The status-line answer: what has not reached the file yet. */
  const pending = () => unsavedChanges(shell);

  /** What a person calls a book, as the sidebar and the history call it. */
  const nameOf = (bookId: BookId): string => bookName(bookId, metadataOf(shell.project()));

  /**
   * The book whose diff is on the right. The first changed book until somebody
   * picks another, and back to the first when the pick stops being changed —
   * a reverted book must not leave the pane showing a diff that is gone.
   */
  const current = (): BookChanges | undefined => {
    const rows = changed();
    return rows.find((row) => row.bookId === picked()) ?? rows[0];
  };

  const announce = (done: Result.Result<unknown, { readonly reason: string }>): void => {
    if (Result.isFailure(done)) {
      toasts.error({ title: t("Revert refused"), message: t(done.failure.reason) });
      return;
    }
    toasts.success({ title: t("Reverted") });
    shell.bump();
  };

  const revertHunk = (changes: BookChanges, hunk: Diff.Hunk): void => {
    setConfirming({
      title: t("Revert this change?"),
      label: t("Revert"),
      description: t("{book} goes back to the recorded version for this one hunk.", {
        book: nameOf(changes.bookId),
      }),
      run: () => announce(Diff.revert(hunk, changes.book)),
    });
  };

  const revertFile = (changes: BookChanges): void => {
    setConfirming({
      title: t("Revert every change in {book}?", { book: nameOf(changes.bookId) }),
      label: t("Revert {count} change(s)", { count: changes.hunks.length }),
      description: t("One edit, so one Undo takes the whole thing back."),
      run: () => announce(Diff.revertAll(changes.hunks, changes.book)),
    });
  };

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
          message: t(
            "The work is in the editor. It is not a recorded version until you record one.",
          ),
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
    // A snapshot: the review is over the books as they stood when the button
    // was pressed, and those are the paths the commit will stage.
    const review = changed();
    if (project === undefined || busy() || review.length === 0) return;
    setBusy(true);
    const notice = toasts.progress({ title: t("Recording…") });

    // The file has to hold the text before a commit can stage it. Usually
    // there is nothing left to do here — the idle write got there first — so
    // an empty receipt list is the ordinary case, not a reason to stop.
    const saved = await shell.services.run(
      Effect.result(shell.services.save.saveAll(project.books)),
    );
    if (Result.isFailure(saved)) {
      toasts.update(notice, {
        tone: "error",
        title: t("Could not write to disk"),
        message: saved.failure.description,
        autoClose: false,
      });
      setBusy(false);
      return;
    }
    shell.bump();

    // What to stage: exactly the books this review is about, each with the
    // stamp of the text now on disk — `saveAll` has just made the two agree,
    // so a receipt here names bytes that really are in the file.
    const receipts: { readonly path: string; readonly stamp: SourceStamp }[] = [];
    for (const book of review) {
      const baseline = shell.services.save.baseline(book.book);
      if (Option.isNone(baseline)) continue;
      receipts.push({ path: baseline.value.path, stamp: baseline.value.stamp });
    }
    if (receipts.length === 0) {
      toasts.update(notice, { title: t("Nothing to record"), tone: "info" });
      setBusy(false);
      return;
    }

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
      toasts.update(notice, {
        tone: "error",
        autoClose: false,
        title: t("On disk, but not recorded"),
        message: t("{reason}: {description}", {
          reason: recorded.failure.reason,
          description: recorded.failure.description ?? t("no detail"),
        }),
      });
    } else {
      toasts.update(notice, {
        tone: "success",
        title: t("Recorded {count} book(s) as {hash}", {
          count: receipts.length,
          hash: recorded.success.slice(0, 7),
        }),
        message: staticMessage,
      });
      setMessage("");
      // The version moved, so the baseline every summary on this screen is
      // measured against moved with it.
      version.refresh();
    }
    setBusy(false);
  };

  return (
    <main class="min-w-0 space-y-4 p-6">
      <PanelHeader
        title={t("Save & Review")}
        subtitle={t(
          "Your books are written to disk on their own. This is where a version goes into the project's history.",
        )}
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
                "Sefer found a working-state backup from an earlier session that was never recorded. Restoring puts it back in the editor, where the ordinary idle write picks it up.",
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

        <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <div class="min-w-0 space-y-4 lg:sticky lg:top-6">
            <Card padded={false} class="overflow-hidden" aria-label={t("Books in this version")}>
              <div class="flex flex-wrap items-center gap-2 border-b border-surface-border px-3.5 py-2.5">
                <h3 class="text-small font-semibold text-on-surface-primary">
                  {t("{count} book(s) to record", { count: changed().length })}
                </h3>
                <Show when={changed().length > 0}>
                  <Badge tone="success" class="ms-auto">
                    +{totals().added}
                  </Badge>
                  <Badge tone="error">−{totals().removed}</Badge>
                </Show>
              </div>
              <Show
                when={changed().length > 0}
                fallback={
                  <div class="p-3">
                    <EmptyState
                      icon={<Check size={20} />}
                      title={t("Everything is already in the latest version.")}
                      description={t("Nothing has changed since the last one was recorded.")}
                    />
                  </div>
                }
              >
                <ul class="divide-y divide-surface-border" data-changed={changed().length}>
                  <For each={changed()}>
                    {(book) => (
                      <li data-book={book.bookId}>
                        <button
                          type="button"
                          class={ROW}
                          aria-current={current()?.bookId === book.bookId ? "true" : undefined}
                          onClick={() => setPicked(book.bookId)}
                        >
                          <span class="flex w-full items-center gap-2">
                            <strong class="min-w-0 flex-1 truncate text-small font-semibold text-on-surface-primary">
                              {nameOf(book.bookId)}
                            </strong>
                            <Show
                              when={book.firstTime === true}
                              fallback={
                                <>
                                  <Badge tone="success">+{book.added}</Badge>
                                  <Badge tone="error">−{book.removed}</Badge>
                                </>
                              }
                            >
                              <Badge tone="brand">{t("new")}</Badge>
                            </Show>
                          </span>
                          <span class="w-full truncate font-mono text-smallest text-on-surface-tertiary">
                            {book.path}
                          </span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Card>

            <Card class="space-y-3" aria-label={t("Commit")}>
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
                {t("Record this version")}
              </Button>
              <p class="text-smallest text-on-surface-tertiary">
                {t(
                  "A book is written to disk shortly after you stop typing, and a working-state backup is kept while you type. Neither is a version: this button is what puts one in the history, under your message.",
                )}
              </p>
              <p class="text-smallest text-on-surface-tertiary" data-pending={pending().length}>
                <Show when={pending().length > 0} fallback={t("Every book is written to disk.")}>
                  {t("{count} book(s) still to be written to disk; recording writes them first.", {
                    count: pending().length,
                  })}
                </Show>
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

          <Card class="min-w-0 space-y-3" aria-label={t("Changes")}>
            <Show
              when={current()}
              fallback={
                <EmptyState
                  icon={<Check size={20} />}
                  title={t("No changes to review.")}
                  description={t("Type in a book and it will appear here.")}
                />
              }
            >
              {(book) => (
                <div class="space-y-3" data-diff-book={book().bookId}>
                  <PanelHeader
                    level={3}
                    title={nameOf(book().bookId)}
                    subtitle={book().path}
                    actions={
                      <Show when={book().firstTime !== true}>
                        <Button
                          size="sm"
                          variant="tertiary"
                          icon={<Undo2 size={12} />}
                          onClick={() => revertFile(book())}
                        >
                          {t("Revert file")}
                        </Button>
                      </Show>
                    }
                  />
                  <Show
                    when={book().firstTime !== true}
                    fallback={
                      <EmptyState
                        title={t("Recorded for the first time.")}
                        description={t("{count} line(s) go into the first version of this book.", {
                          count: book().added,
                        })}
                      />
                    }
                  >
                    <DiffView hunks={book().hunks} onRevert={(hunk) => revertHunk(book(), hunk)} />
                  </Show>
                </div>
              )}
            </Show>
          </Card>
        </div>
      </Show>

      <Dialog
        open={confirming() !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirming(undefined);
        }}
        title={confirming()?.title ?? ""}
        description={confirming()?.description}
        footer={
          <>
            <Button onClick={() => setConfirming(undefined)}>{t("Cancel")}</Button>
            <Button
              variant="danger"
              onClick={() => {
                confirming()?.run();
                setConfirming(undefined);
              }}
            >
              {confirming()?.label ?? t("Revert")}
            </Button>
          </>
        }
      >
        <p class="text-small text-on-surface-secondary">
          {t(
            "This changes the text in the editor, where Undo can take it back. It records nothing.",
          )}
        </p>
      </Dialog>
    </main>
  );
}
