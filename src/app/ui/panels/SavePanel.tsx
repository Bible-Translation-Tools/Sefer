/**
 * Save & Review: what is not in the file yet, and the one button that writes
 * and records it.
 *
 * This screen is the ONLY thing in Sefer that writes a project file. Nothing
 * saves on a timer any more; two things keep your work between presses, and
 * neither of them is the file:
 *
 *   * The WORKING-STATE BACKUP is the crash journal (`core/recovery`), written
 *     a moment after typing pauses ("Back up work after" in Settings). It is
 *     not the file and it is not a version: it exists so a session that ended
 *     badly can be replayed into the editor.
 *   * A VERSION is what "Record a version" makes, and it is one action in two
 *     halves: `SaveCoordinator.saveAll` writes the files, then `Git.commit`
 *     records exactly those paths under the message you wrote. A write that
 *     fails records nothing. A commit that fails after a write that succeeded
 *     is reported as exactly that — the files ARE on disk, no version holds
 *     them — because telling someone their work was lost when it is in the
 *     file would be a lie, and telling them it was recorded when no commit
 *     exists would be a worse one.
 *
 * ## The baseline is the FILE
 *
 * The review is `core/diff` against `SaveCoordinator.baseline` — the bytes on
 * disk — and not against the blob at HEAD. That follows from explicit-only
 * saving: the file is exactly the text nobody has agreed to change, so the
 * books that differ from it are the books this press is about, and a project
 * somebody merely opened differs from its files in nothing.
 *
 * It used to diff against the last commit, which was right when the file moved
 * on its own and is wrong now. A 66-book project with no repository has no
 * HEAD, so every book read as "recorded for the first time" and the screen
 * offered to record 66 untouched books with a diff of 92,208 lines. The last
 * commit is still the right baseline for HISTORY, which is the screen about
 * what has happened rather than what is about to; `recorded.ts` belongs to it
 * alone now.
 *
 * A project with no repository gets one on the first record (`Git.init` before
 * `commit`), and that first commit holds the books that were actually changed
 * — not the whole project restated as a change.
 *
 * ## The two views
 *
 * **Side by side** is the default and the one built for scripture: the file on
 * the left, the editor on the right, verse-aligned rows under a heading per
 * chapter, with the characters that differ marked inside the verse. **Unified**
 * is the line diff, for a structural change that is not verse-shaped. Revert
 * is offered per row and per file in both, and is the same `diff.revert` in
 * both — one trusted change through `book.apply`, which Undo reaches.
 *
 * Git is allowed to be absent — a browser fixture has never run `git init`.
 */

import { useNavigate } from "@tanstack/solid-router";
import { Effect, Option, Result } from "effect";
import Check from "lucide-solid/icons/check";
import Columns2 from "lucide-solid/icons/columns-2";
import History from "lucide-solid/icons/history";
import LifeBuoy from "lucide-solid/icons/life-buoy";
import Rows3 from "lucide-solid/icons/rows-3";
import Save from "lucide-solid/icons/save";
import Undo2 from "lucide-solid/icons/undo-2";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import type { BookId } from "../../../core/book/book";
import * as Diff from "../../../core/diff/diff";
import { alignVerses, hunkOf, type VerseRow } from "../../../core/diff/verses";
import type { Restorable } from "../../../core/recovery/recovery";
import type { SourceStamp } from "../../../core/source/source";
import { describe } from "../../describe";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  PanelHeader,
  SegmentedControl,
  Switch,
  toasts,
} from "../primitives";
import { bookName } from "../workspace/books";
import { metadataOf } from "../workspace/project";
import { unsavedChanges, type BookChanges } from "./changes";
import { DiffView } from "./DiffView";
import { ago, exact } from "./format";
import { SideBySide } from "./SideBySide";
import { verseSpans } from "./verses";

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

type ReviewView = "columns" | "unified";

/** The author every Sefer commit carries until accounts reach this screen. */
const AUTHOR = { name: "Sefer", email: "sefer@localhost" } as const;

export function SavePanel() {
  const shell = useShell();
  const navigate = useNavigate();
  const [message, setMessage] = createSignal("");
  const [busy, setBusy] = createSignal(false, { name: "saving" });
  const [journals, setJournals] = createSignal<readonly Restorable[]>([], { name: "journals" });
  const [picked, setPicked] = createSignal<BookId | undefined>(undefined, { name: "reviewBook" });
  const [view, setView] = createSignal<ReviewView>("columns", { name: "reviewView" });
  const [context, setContext] = createSignal(false, { name: "reviewContext" });
  const [confirming, setConfirming] = createSignal<Confirmation | undefined>(undefined, {
    name: "confirmRevert",
  });

  // Mod-S lands on this screen, so the caret lands in the message: it is the
  // only thing left to supply, and Enter on it records. By id rather than a
  // ref because the field is inside a primitive that spreads its props.
  createEffect(
    () => shell.project()?.id,
    () => {
      document.getElementById("commit-message")?.focus();
    },
  );

  /**
   * The review: every book whose text differs from its file. See the header —
   * the file is the baseline, and `changes.ts` holds the other question.
   */
  const changed = () => unsavedChanges(shell);

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

  /**
   * The selected book's verses, the file's beside the editor's.
   *
   * Both sides are addressed the same way — `Galley.analyze(...).dish.toc`,
   * through `verses.ts`, which caches by the text itself — so the columns stay
   * level when a paragraph is added on one side. The line diff underneath is
   * untouched: this is a second reading of the same two texts, not a second
   * idea of what changed.
   */
  const rows = createMemo(
    (): readonly VerseRow[] => {
      const book = current();
      if (book === undefined) return [];
      const baseline = shell.services.save.baseline(book.book);
      if (Option.isNone(baseline)) return [];
      const galley = shell.services.galley;
      const working = book.book.source().text;
      return alignVerses(
        baseline.value.text,
        verseSpans(galley, baseline.value.text),
        working,
        verseSpans(galley, working),
      );
    },
    { name: "reviewRows" },
  );

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
      description: t("{book} goes back to what the file on disk holds, for this one hunk.", {
        book: nameOf(changes.bookId),
      }),
      run: () => announce(Diff.revert(hunk, changes.book)),
    });
  };

  /**
   * One verse back to the file. The row already carries both ranges and both
   * texts, so it becomes an ordinary `Hunk` and goes through the same
   * `diff.revert` — which refuses a stale one rather than splicing at offsets
   * that have moved.
   */
  const revertRow = (changes: BookChanges, row: VerseRow): void => {
    setConfirming({
      title: t("Revert {reference}?", { reference: row.reference }),
      label: t("Revert"),
      description: t("{book} {reference} goes back to what the file on disk holds.", {
        book: nameOf(changes.bookId),
        reference: row.reference,
      }),
      run: () =>
        announce(
          Diff.revert(hunkOf(row, changes.bookId, changes.book.source().stamp), changes.book),
        ),
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
            const book = yield* project.instantiate(journal.bookId);
            // Its text is the bytes on disk and its revision is still 0, so
            // this is the one moment the disk baseline can be learned for
            // free. The review above is against that baseline; without it the
            // restored work comes back invisible to this very screen.
            yield* shell.services.save.adopt(book);
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
            message: describe(done.failure),
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
          toasts.error({ title: t("Could not discard"), message: describe(done.failure) });
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

    // The file has to hold the text before a commit can stage it. `saveAll`
    // writes the dirty books and no others, which is exactly this review's
    // list — the two ask `SaveCoordinator` the same question.
    const saved = await shell.services.run(
      Effect.result(shell.services.save.saveAll(project.books)),
    );
    if (Result.isFailure(saved)) {
      // Nothing is recorded when nothing is written. The review still stands
      // and the backup still holds the work; the reader fixes the disk and
      // presses again.
      toasts.update(notice, {
        tone: "error",
        title: t("Could not write to disk"),
        message: describe(saved.failure),
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
          // A project with no repository gets one here, on its first record —
          // and because the review is against the FILE, that first commit
          // holds the books that changed rather than the whole project.
          const repo = yield* shell.services.git.init(project.root);
          return yield* shell.services.git.commit(repo, receipts, staticMessage, AUTHOR);
        }),
      ),
    );
    if (Result.isFailure(recorded)) {
      // The one state the new save model can leave behind, and the status line
      // has a name for it: the bytes are in the file, no version holds them.
      shell.noteWritten(
        review.map((book) => book.bookId),
        false,
      );
      toasts.update(notice, {
        tone: "error",
        autoClose: false,
        title: t("On disk, but not recorded"),
        message: describe(recorded.failure),
      });
    } else {
      shell.noteWritten(
        review.map((book) => book.bookId),
        true,
      );
      toasts.update(notice, {
        tone: "success",
        title: t("Recorded {count} book(s) as {hash}", {
          count: receipts.length,
          hash: recorded.success.slice(0, 7),
        }),
        message: staticMessage,
      });
      setMessage("");
    }
    setBusy(false);
  };

  return (
    <main class="min-w-0 space-y-4 p-6">
      <PanelHeader
        title={t("Save & Review")}
        subtitle={t(
          "This is the only place Sefer writes your books to disk, and it records the version at the same time.",
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
                "Sefer found a working-state backup from an earlier session that was never recorded. Restoring puts it back in the editor, where it stays unsaved until you record a version.",
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
                      title={t("Nothing to record.")}
                      description={t("Every book matches the file on disk.")}
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
                            <Badge tone="success">+{book.added}</Badge>
                            <Badge tone="error">−{book.removed}</Badge>
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
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.key !== "Enter" || event.isComposing) return;
                  event.preventDefault();
                  if (changed().length > 0) void commit();
                }}
              />
              <Button
                variant="primary"
                class="w-full"
                icon={<Save size={14} />}
                loading={busy()}
                disabled={changed().length === 0}
                onClick={() => void commit()}
              >
                {t("Record a version")}
              </Button>
              <p class="text-smallest text-on-surface-tertiary">
                {t(
                  "Nothing is written to disk on a timer. This button writes the files and records the version together, under your message; until you press it, a working-state backup is what holds your work.",
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
                      <>
                        <SegmentedControl<ReviewView>
                          label={t("How to show the changes")}
                          size="sm"
                          value={view()}
                          onChange={setView}
                          items={[
                            {
                              value: "columns",
                              label: t("Side by side"),
                              icon: <Columns2 size={13} />,
                            },
                            { value: "unified", label: t("Unified"), icon: <Rows3 size={13} /> },
                          ]}
                        />
                        <Button
                          size="sm"
                          variant="tertiary"
                          icon={<Undo2 size={12} />}
                          onClick={() => revertFile(book())}
                        >
                          {t("Revert file")}
                        </Button>
                      </>
                    }
                  />
                  <Show when={view() === "columns"}>
                    <Switch
                      id="review-context"
                      checked={context()}
                      onChange={setContext}
                      label={t("Show unchanged verses")}
                    />
                  </Show>
                  <Show
                    when={view() === "columns"}
                    fallback={
                      <DiffView
                        hunks={book().hunks}
                        onRevert={(hunk) => revertHunk(book(), hunk)}
                        emptyTitle={t("This book matches the file on disk.")}
                      />
                    }
                  >
                    <SideBySide
                      rows={rows()}
                      leftLabel={t("On disk")}
                      rightLabel={t("In the editor")}
                      showUnchanged={context()}
                      onRevert={(row) => revertRow(book(), row)}
                      emptyTitle={t("This book matches the file on disk.")}
                    />
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
