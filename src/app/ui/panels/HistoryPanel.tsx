/**
 * The project's history: what git recorded, and what has not been recorded yet.
 *
 * The timeline is `git.log` plus one `git.previousVersions` per book, and that
 * second call is what makes the rest of the panel cheap: it answers "which
 * commits touched this book" AND hands back a `bytes()` thunk, so a commit row
 * can name the books it changed without reading a single blob, and reading one
 * happens only when somebody selects that commit.
 *
 * The diff is `core/diff` between the working text and the selected side, and
 * Revert means exactly one thing everywhere in the product: `diff.revert`
 * through `book.apply` with `trustedBy("diff.revert")`, refused when the book
 * has moved since the hunk was measured. It moves the TEXT IN THE EDITOR and
 * nothing else — no file is written here and no version is recorded — so Undo
 * takes it back, and it is behind a confirmation because scripture is not
 * something to replace by accident.
 *
 * The top row is what has not been recorded, because "where am I now" is the
 * question people come to a history for first. Its baseline is the blob at
 * HEAD (`recorded.ts`), NOT `SaveCoordinator.baseline`: the disk is not the
 * history, and a write whose commit failed would otherwise report as recorded.
 * What the disk baseline still answers is the small "not yet written" note
 * beside it.
 */

import { useNavigate } from "@tanstack/solid-router";
import { Effect, Result } from "effect";
import GitCommitVertical from "lucide-solid/icons/git-commit-vertical";
import PencilLine from "lucide-solid/icons/pencil-line";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import Undo2 from "lucide-solid/icons/undo-2";
import { For, Show, createEffect, createSignal, untrack } from "solid-js";

import type { BookId } from "#core/book/book";
import * as Diff from "#core/diff/diff";
import type { Commit, Version } from "#core/git/git";
import { Git, repositoryPath } from "#core/git/git";
import { decode } from "#core/source/source";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Badge, Button, Card, Dialog, EmptyState, PanelHeader, toasts } from "../primitives";
import { bookName } from "../workspace/books";
import { metadataOf } from "../workspace/project";
import { changesOf, recordedChanges, unsavedChanges, type BookChanges } from "./changes";
import { DiffView } from "./DiffView";
import { ago, exact } from "./format";
import { createRecordedVersion } from "./recorded";

/** The not-yet-recorded row's id in the selection. A commit id is 40 hex digits. */
const WORKING = "working";

/** The one row look, shared by the top row and every commit row. */
const ROW = [
  "flex w-full cursor-pointer flex-col gap-1 px-3.5 py-3 text-start transition-colors",
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

export function HistoryPanel() {
  const shell = useShell();
  const navigate = useNavigate();
  const [log, setLog] = createSignal<readonly Commit[] | undefined>(undefined, { name: "gitLog" });
  const [versions, setVersions] = createSignal<ReadonlyMap<BookId, readonly Version[]>>(new Map(), {
    name: "gitVersions",
  });
  const [problem, setProblem] = createSignal("");
  const [selected, setSelected] = createSignal<string>(WORKING, { name: "selectedCommit" });
  const [shown, setShown] = createSignal<readonly BookChanges[]>([], { name: "shownDiff" });
  const [confirming, setConfirming] = createSignal<Confirmation | undefined>(undefined, {
    name: "confirmRevert",
  });
  /** HEAD's blobs: the baseline the top row is measured against. */
  const version = createRecordedVersion(shell);

  /**
   * One pass over the repository. Every git call goes through `Effect.result`
   * so that a repository that does not exist — the ordinary case in a browser
   * fixture, where nothing has ever run `git init` — reports itself once and
   * leaves the top row working.
   */
  const load = (): void => {
    const project = shell.project();
    if (project === undefined) return;
    void shell.services
      .run(
        Effect.gen(function* () {
          const git = yield* Git;
          const opened = yield* Effect.result(git.open(project.root));
          if (Result.isFailure(opened))
            return { kind: "absent", reason: opened.failure.reason } as const;
          const repo = opened.success;
          const commits = yield* Effect.result(git.log(repo));
          const perBook = new Map<BookId, readonly Version[]>();
          for (const book of project.books) {
            const inside = repositoryPath(project.root, book.path);
            if (inside._tag === "None") continue;
            const found = yield* Effect.result(git.previousVersions(repo, inside.value));
            if (Result.isSuccess(found)) perBook.set(book.id, found.success);
          }
          return {
            kind: "read",
            commits: Result.isSuccess(commits) ? commits.success : [],
            perBook,
          } as const;
        }),
      )
      .then((answer) => {
        if (answer.kind === "absent") {
          // The TAG, not a sentence: the card below decides what to say about
          // it, and "NotARepository" is the ordinary state of a project nobody
          // has recorded yet rather than an error to print at someone.
          setProblem(answer.reason);
          setLog([]);
          return;
        }
        setProblem("");
        setLog(answer.commits);
        setVersions(answer.perBook);
        version.refresh();
      });
  };
  // One read of the open project, at setup. `load` is not a derivation.
  untrack(load);

  /** Which books a commit touched, from the per-book version lists. */
  const booksIn = (id: string): readonly BookId[] => {
    const out: BookId[] = [];
    for (const [bookId, list] of versions())
      if (list.some((version) => version.commit.id === id)) out.push(bookId);
    return out;
  };

  const versionOf = (bookId: BookId, id: string): Version | undefined =>
    versions()
      .get(bookId)
      ?.find((version) => version.commit.id === id);

  /**
   * The selected side, as a diff against the working text.
   *
   * The top row reads the recorded baseline; a commit reads its own blobs.
   * Either way the RIGHT side is the book in hand, so every diff on this
   * screen is "how what I have differs from that", read the same way round.
   */
  const recompute = async (): Promise<void> => {
    const project = shell.project();
    const id = selected();
    if (project === undefined) {
      setShown([]);
      return;
    }
    if (id === WORKING) {
      setShown(notRecorded());
      return;
    }
    const out: BookChanges[] = [];
    for (const bookId of booksIn(id)) {
      const book = project.book(bookId);
      const blob = versionOf(bookId, id);
      if (book === undefined || blob === undefined) continue;
      const bytes = await shell.services.run(Effect.result(blob.bytes()));
      if (Result.isFailure(bytes)) continue;
      const decoded = decode(bytes.success);
      if (Result.isFailure(decoded)) continue;
      const changes = changesOf(book, {
        bookId,
        stamp: decoded.success.stamp,
        text: decoded.success.text,
      });
      // A commit touches a file; it does not follow that the file still
      // differs from the text in hand. A book that matches is dropped rather
      // than shown as an empty diff.
      if (changes.hunks.length > 0) out.push(changes);
    }
    setShown(out);
  };

  /**
   * The books this side is a diff OF, which is what decides when it restales.
   *
   * The working row diffs every book against the recorded baseline; a commit
   * diffs only the books it touched. Naming them is what lets a keystroke in
   * Genesis leave a selected Ruth commit alone — behind `shell.tick()` every
   * edit anywhere re-ran this panel, blob fetch and decode included.
   */
  const diffed = (): readonly BookId[] => {
    const id = selected();
    if (id !== WORKING) return booksIn(id);
    return shell.project()?.books.map((book) => book.id) ?? [];
  };

  createEffect(
    () =>
      `${selected()}:${versions().size}:${version.recorded().head ?? ""}:${diffed()
        .map((bookId) => shell.stampOf(bookId)?.revision ?? -1)
        .join(",")}`,
    () => {
      // The compute above IS the dependency list. Everything this reads is a
      // one-time snapshot of the state that key already describes, so
      // `untrack` says so — a read in an effect's effect-phase that is not a
      // dependency is what STRICT_READ_UNTRACKED exists to catch, and it
      // cannot tell a deliberate snapshot from a mistake without being told.
      untrack(() => {
        void recompute();
      });
    },
  );

  /** `bookId` because a revert is an edit to ONE book, and says so. */
  const announce = (
    bookId: BookId,
    done: Result.Result<unknown, { readonly reason: string }>,
  ): void => {
    if (Result.isFailure(done)) {
      toasts.error({ title: t("Revert refused"), message: t(done.failure.reason) });
      return;
    }
    toasts.success({ title: t("Reverted") });
    shell.changed({ kind: "book.apply", books: [bookId] });
  };

  const revertHunk = (changes: BookChanges, hunk: Diff.Hunk): void => {
    setConfirming({
      title: t("Revert this change?"),
      label: t("Revert"),
      description: t(
        "{book} goes back to the selected version for this one hunk. Undo takes it back.",
        { book: nameOf(changes.bookId) },
      ),
      run: () => announce(changes.bookId, Diff.revert(hunk, changes.book)),
    });
  };

  const revertFile = (changes: BookChanges): void => {
    setConfirming({
      title: t("Revert every change in {book}?", { book: nameOf(changes.bookId) }),
      label: t("Revert {count} change(s)", { count: changes.hunks.length }),
      description: t("One edit, so one Undo takes the whole thing back."),
      run: () => announce(changes.bookId, Diff.revertAll(changes.hunks, changes.book)),
    });
  };

  const selectedCommit = (): Commit | undefined =>
    log()?.find((commit) => commit.id === selected());

  /** What the latest recorded version does not hold yet: the review answer. */
  const notRecorded = (): readonly BookChanges[] => recordedChanges(shell, version.recorded());

  /** The other question, kept small: what has not reached the file yet. */
  const notWritten = (): readonly BookChanges[] => unsavedChanges(shell);

  /** The one way to Save & Review from this screen, so both doors agree. */
  const review = (): void => {
    void navigate({
      to: "/project/$slug/history",
      params: { slug: shell.slug() },
      search: { review: true },
    });
  };

  /** What a person calls a book: the project's own name for it, else the canon's. */
  const nameOf = (bookId: BookId): string => bookName(bookId, metadataOf(shell.project()));

  return (
    <main class="min-w-0 space-y-4 p-6">
      <PanelHeader
        title={t("History")}
        subtitle={t("What git recorded, newest first — and, at the top, what it has not.")}
        actions={
          <>
            <Button icon={<RefreshCw size={14} />} onClick={load}>
              {t("Reload")}
            </Button>
            <Button variant="primary" onClick={review}>
              {t("Save & Review")}
            </Button>
          </>
        }
      />

      <Show
        when={shell.project()}
        fallback={
          <EmptyState
            icon={<GitCommitVertical size={22} />}
            title={t("Open a project first.")}
            description={t("History is read from the project's own repository.")}
          />
        }
      >
        <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <div class="space-y-3 lg:sticky lg:top-6">
            <Show when={problem() !== ""}>
              <Card class="space-y-2" data-history-problem={problem()}>
                <Show
                  when={problem() === "NotARepository"}
                  fallback={
                    <>
                      <p class="text-small text-on-surface-secondary">
                        {t("Sefer could not read this project's history.")}
                      </p>
                      <p class="text-smallest text-on-surface-tertiary">
                        {t("The repository refused the read: {reason}.", { reason: problem() })}
                      </p>
                    </>
                  }
                >
                  <p class="text-small text-on-surface-secondary">
                    {t("Nothing has been recorded for this project yet.")}
                  </p>
                  <p class="text-smallest text-on-surface-tertiary">
                    {t(
                      "Your unsaved work is kept safe as you type, but your books are only written to disk when you Save & Review. That records a version you can come back to — the first one creates the repository.",
                    )}
                  </p>
                  <Button variant="primary" size="sm" onClick={review}>
                    {t("Save & Review")}
                  </Button>
                </Show>
              </Card>
            </Show>

            <Card padded={false} class="overflow-hidden" aria-label={t("Timeline")}>
              <ul class="divide-y divide-surface-border" data-commits={log()?.length ?? 0}>
                <li>
                  <button
                    type="button"
                    data-commit={WORKING}
                    aria-current={selected() === WORKING ? "true" : undefined}
                    class={ROW}
                    onClick={() => setSelected(WORKING)}
                  >
                    <div class="flex w-full items-center gap-2">
                      <PencilLine
                        size={14}
                        class="shrink-0 text-on-surface-tertiary"
                        aria-hidden="true"
                      />
                      <span class="min-w-0 flex-1 truncate text-small font-semibold text-on-surface-primary">
                        {t("Not yet recorded")}
                      </span>
                      <Show when={notRecorded().length > 0}>
                        <Badge tone="warning">{notRecorded().length}</Badge>
                      </Show>
                    </div>
                    <div class="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-smallest text-on-surface-tertiary">
                      <Show
                        when={notRecorded().length > 0}
                        fallback={<span>{t("Every book is in the latest version.")}</span>}
                      >
                        <span>
                          {t("{count} book(s) changed since the last version", {
                            count: notRecorded().length,
                          })}
                        </span>
                      </Show>
                      <Show when={notWritten().length > 0}>
                        <span aria-hidden="true">·</span>
                        <span>
                          {t("{count} not yet written to disk", { count: notWritten().length })}
                        </span>
                      </Show>
                    </div>
                  </button>
                </li>

                <For each={log() ?? []}>
                  {(commit) => (
                    <li>
                      <button
                        type="button"
                        data-commit={commit.id}
                        aria-current={selected() === commit.id ? "true" : undefined}
                        class={ROW}
                        onClick={() => setSelected(commit.id)}
                      >
                        <div class="flex w-full items-center gap-2">
                          <Badge class="font-mono">{commit.id.slice(0, 7)}</Badge>
                          <span class="min-w-0 flex-1 truncate text-small font-medium text-on-surface-primary">
                            {commit.message}
                          </span>
                        </div>
                        <div class="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-smallest text-on-surface-tertiary">
                          <span>{commit.author.name}</span>
                          <span aria-hidden="true">·</span>
                          <time
                            datetime={new Date(commit.at).toISOString()}
                            title={exact(commit.at)}
                          >
                            {ago(commit.at)}
                          </time>
                          <For each={booksIn(commit.id)}>
                            {(bookId) => (
                              <span title={bookId}>
                                <Badge tone="brand">{nameOf(bookId)}</Badge>
                              </span>
                            )}
                          </For>
                        </div>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Card>

            <Show when={problem() === "" && (log()?.length ?? 0) === 0}>
              <p class="px-1 text-smallest text-on-surface-tertiary">{t("No commits yet.")}</p>
            </Show>
          </div>

          <Card class="min-w-0 space-y-4" aria-label={t("Changes")}>
            <PanelHeader
              level={3}
              title={
                selected() === WORKING
                  ? t("Not yet recorded")
                  : (selectedCommit()?.message ?? t("Selected version"))
              }
              subtitle={
                selected() === WORKING
                  ? t("The text in the editor against the last recorded version.")
                  : t("Working text against {hash}.", { hash: selected().slice(0, 7) })
              }
            />

            <Show
              when={shown().length > 0}
              fallback={
                <EmptyState
                  title={
                    selected() === WORKING
                      ? t("Everything on screen is already in the latest version.")
                      : t("This version matches the text in hand.")
                  }
                />
              }
            >
              <For each={shown()}>
                {(changes) => (
                  <section class="space-y-2" data-diff-book={changes.bookId}>
                    <div class="flex flex-wrap items-center gap-2">
                      <strong class="text-small font-semibold text-on-surface-primary">
                        {nameOf(changes.bookId)}
                      </strong>
                      <code class="min-w-0 truncate font-mono text-smallest text-on-surface-tertiary">
                        {changes.path}
                      </code>
                      <Show
                        when={changes.firstTime === true}
                        fallback={
                          <>
                            <Badge tone="success">+{changes.added}</Badge>
                            <Badge tone="error">−{changes.removed}</Badge>
                          </>
                        }
                      >
                        <Badge tone="brand">{t("first version")}</Badge>
                        <Badge tone="success">
                          {t("{count} line(s)", { count: changes.added })}
                        </Badge>
                      </Show>
                      <Show when={changes.firstTime !== true}>
                        <Button
                          size="sm"
                          variant="tertiary"
                          class="ms-auto"
                          icon={<Undo2 size={12} />}
                          onClick={() => revertFile(changes)}
                        >
                          {t("Revert file")}
                        </Button>
                      </Show>
                    </div>
                    <Show when={changes.firstTime !== true}>
                      <DiffView
                        hunks={changes.hunks}
                        onRevert={(hunk) => revertHunk(changes, hunk)}
                      />
                    </Show>
                  </section>
                )}
              </For>
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
            "This changes the text in the editor. It does not write a file and does not record a version.",
          )}
        </p>
      </Dialog>
    </main>
  );
}
