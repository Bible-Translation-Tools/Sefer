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
import { Effect, Option, Result } from "effect";
import GitCommitVertical from "lucide-solid/icons/git-commit-vertical";
import PencilLine from "lucide-solid/icons/pencil-line";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import Undo2 from "lucide-solid/icons/undo-2";
import { For, Show, createEffect, createMemo, createSignal, untrack } from "solid-js";

import type { Book, BookId } from "#core/book/book";
import { diffSkeleton } from "#core/diff/skeleton";
import { revertUnits, type UnitChanges } from "#core/diff/units";
import type { Analysis, DecisionUnit } from "#core/galley";
import type { Commit, Version } from "#core/git/git";
import { Git, repositoryPath } from "#core/git/git";
import { Remote, type Deepen } from "#core/remote/remote";
import { decode, type Source } from "#core/source/source";
import { trackingRef } from "#core/sync";
import type { EditorBook } from "#editor/index";

import { remoteReasonOf } from "../../describe";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { syncStatus } from "../../syncStatus";
import type { DiffSides } from "../diff/DiffCard";
import { hunksOf, type Hunk, type Range } from "../diff/hunks";
import type { CardAction } from "../multibuffer/CardAction";
import {
  Badge,
  Button,
  Card,
  DelayedSpinner,
  Dialog,
  EmptyState,
  PanelHeader,
  toasts,
} from "../primitives";
import { ReviewReader, type ReviewBook } from "../review/ReviewReader";
import { bookName } from "../workspace/books";
import { metadataOf } from "../workspace/project";
import {
  changeCount,
  changesOf,
  recordedChanges,
  unsavedChanges,
  versionChanges,
  type BookChanges,
} from "./changes";
import { ago, dated, exact } from "./format";
import { createRecordedVersion } from "./recorded";
import { YoursRow } from "./YoursRow";

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

/** Your text against both sides of a selected version, for one book. */
interface Yours {
  readonly book: Book;
  /** Your text against this version: `baselineText` is the version, `workingText` yours. */
  readonly version: UnitChanges | undefined;
  /** Your text against the book's version before it. */
  readonly before: UnitChanges | undefined;
  /** `version`'s two texts and their parses, for the third row. */
  readonly sides: DiffSides | undefined;
}

const point = (at: number): Range => ({ from: at, to: at });

/**
 * Whether two stretches share text. Two verses that only meet at a boundary do
 * not; a point (a passage one side lacks) does when it falls inside or on the
 * edge of the other.
 */
const overlaps = (a: Range, b: Range): boolean =>
  a.from === a.to || b.from === b.to
    ? a.from <= b.to && b.from <= a.to
    : a.from < b.to && b.from < a.to;

/** How many commits further back one step of older history goes. */
const HISTORY_STEP = 10;

/** Projects whose older history this session has already gone to fetch. */
const deepened = new Set<string>();

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
  /** Commit ids the shared project has; `undefined` when there is nothing to compare with. */
  const [shared, setShared] = createSignal<ReadonlySet<string> | undefined>(undefined, {
    name: "historyShared",
  });
  /** Recorded here and not yet on the shared project. */
  const onlyHere = (id: string): boolean => {
    const known = shared();
    return known !== undefined && !known.has(id);
  };
  /**
   * The cards whose "your text against this version" row is open, by card
   * key. A selected version shows what it changed, as a log shows a commit;
   * where your text has moved on since, a card offers that third row.
   */
  const [yoursOpen, setYoursOpen] = createSignal<ReadonlySet<string>>(new Set(), {
    name: "historyYoursOpen",
  });
  const choose = (id: string): void => {
    setSelected(id);
    setYoursOpen(new Set<string>());
  };
  const [confirming, setConfirming] = createSignal<Confirmation | undefined>(undefined, {
    name: "confirmRevert",
  });
  /** HEAD's blobs: the baseline the top row is measured against. */
  const version = createRecordedVersion(shell);
  /**
   * Whether older history is on this device. A project cloned with its
   * newest version only (the Web's default) has a short past until it is
   * deepened, and the list must not pass that off as the whole.
   */
  const [older, setOlder] = createSignal<"whole" | "missing" | "loading" | "failed">("whole", {
    name: "historyOlder",
  });

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
          const shallow = yield* Effect.orElseSucceed(git.shallow(repo), () => false);
          // What the shared project already has, as of the last check: every
          // commit reachable from the remote-tracking ref. `undefined` when
          // there is none to compare with — never sent, or no shared project —
          // and then the timeline marks nothing.
          const branch = yield* Effect.orElseSucceed(git.branch(repo), () => Option.none<string>());
          let shared: ReadonlySet<string> | undefined;
          if (Option.isSome(branch)) {
            const theirs = yield* Effect.result(git.logFrom(repo, trackingRef(branch.value)));
            if (Result.isSuccess(theirs))
              shared = new Set(theirs.success.map((commit) => commit.id));
          }
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
            shallow,
            shared,
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
        setShared(answer.shared);
        version.refresh();
        setOlder((now) => (answer.shallow ? (now === "loading" ? now : "missing") : "whole"));
        // The first time History opens on a project with its newest version
        // only, one step further back is fetched without being asked: opening
        // History is the asking. Once per project per session, so a failure is not
        // retried on every visit; the button below retries.
        if (answer.shallow && !deepened.has(project.root) && syncStatus.interfaceUp()) {
          deepened.add(project.root);
          loadOlder(HISTORY_STEP);
        }
      });
  };

  /** Fetch older history a newest-version clone left on the server, then read again. */
  const loadOlder = (more: Deepen): void => {
    const project = shell.project();
    if (project === undefined) return;
    setOlder("loading");
    const operation = shell.services.composition.observability.operation("history.deepen", {
      "history.more": String(more),
    });
    void shell.services
      .run(
        Effect.gen(function* () {
          const git = yield* Git;
          const remote = yield* Remote;
          return yield* remote.deepen(yield* git.open(project.root), more);
        }),
      )
      .then(
        (progress) => {
          operation.end("passed", { "history.loaded": progress.loaded });
          // `load` reads `shallow` again: a step that did not reach the
          // beginning leaves the card offering more.
          setOlder("missing");
          load();
        },
        (cause: unknown) => {
          operation.end("failed", { "history.reason": remoteReasonOf(cause) ?? "unknown" });
          setOlder("failed");
        },
      );
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

  /** The book's version just older than `id`'s, from its own newest-first list. */
  const previousOf = (bookId: BookId, id: string): Version | undefined => {
    const list = versions().get(bookId) ?? [];
    const at = list.findIndex((version) => version.commit.id === id);
    return at < 0 ? undefined : list[at + 1];
  };

  /** One version's text of a book, decoded; `undefined` when it cannot be read. */
  const textOf = async (version: Version): Promise<Source | undefined> => {
    const bytes = await shell.services.run(Effect.result(version.bytes()));
    if (Result.isFailure(bytes)) return undefined;
    const decoded = decode(bytes.success);
    return Result.isFailure(decoded) ? undefined : decoded.success;
  };

  /**
   * The selected side's diff.
   *
   * The top row is always the text in hand against the recorded baseline. A
   * commit shows what it changed: each book it touched, its previous version
   * against this one. Where your text stands against either is `yours`, below.
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
      const version = versionOf(bookId, id);
      if (book === undefined || version === undefined) continue;
      const after = await textOf(version);
      if (after === undefined) continue;
      const previous = previousOf(bookId, id);
      const before = previous === undefined ? undefined : await textOf(previous);
      const changes = versionChanges(
        shell.services.galley,
        book,
        before === undefined ? undefined : { bookId, stamp: before.stamp, text: before.text },
        { bookId, stamp: after.stamp, text: after.text },
      );
      if (changes.firstTime === true || changeCount(changes) > 0) out.push(changes);
    }
    setShown(out);
  };

  /**
   * The books this side is a diff OF, which is what decides when it restales.
   *
   * The working row diffs every book against the recorded baseline. A commit
   * diffs two recorded texts, which no keystroke moves: where your text
   * stands against them is `yours`, which follows the edits itself. Naming
   * the books is what lets a keystroke in Genesis leave this panel alone —
   * behind `shell.tick()` every edit anywhere re-ran it, blob fetch and
   * decode included.
   */
  const diffed = (): readonly BookId[] => {
    const id = selected();
    if (id !== WORKING) return [];
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

  /** One unit, or a whole book's: the engine's edits, one apply, one Undo. */
  const revertSome = (changes: BookChanges, units: readonly DecisionUnit[]) =>
    changes.changes === undefined
      ? Result.fail({ reason: "nothing to revert" })
      : revertUnits(shell.services.galley, changes.book, changes.changes, units);

  const revertFile = (changes: BookChanges): void => {
    setConfirming({
      title: t("Revert every change in {book}?", { book: nameOf(changes.bookId) }),
      label: t("Revert {count} change(s)", { count: changeCount(changes) }),
      description: t("One edit, so one Undo takes the whole thing back."),
      run: () => announce(changes.bookId, revertSome(changes, changes.changes?.units ?? [])),
    });
  };

  /** USFM or the reading, in the reader below; History's own, not Review's. */
  const [markup, setMarkup] = createSignal(false, { name: "historyMarkup" });
  const [focusBook, setFocusBook] = createSignal<BookId | undefined>(undefined, {
    name: "historyBook",
  });

  /** The shown books as the reader takes them: both texts and their skeleton. */
  const reviewBooks = createMemo(
    (): readonly ReviewBook[] => {
      const out: ReviewBook[] = [];
      for (const changes of shown()) {
        const held = changes.changes;
        if (changes.firstTime === true || held === undefined) continue;
        const skeleton = diffSkeleton(
          shell.services.galley,
          changes.bookId,
          held.baselineText,
          held.workingText,
        );
        if (Result.isFailure(skeleton)) continue;
        out.push({
          bookId: changes.bookId,
          name: nameOf(changes.bookId),
          currentText: held.workingText,
          baselineText: held.baselineText,
          skeleton: skeleton.success,
        });
      }
      return out;
    },
    { name: "historyReviewBooks" },
  );

  const seatBook = async (bookId: BookId): Promise<EditorBook | undefined> => {
    const project = shell.project();
    if (project === undefined) return undefined;
    const opened = await shell.services.run(Effect.result(project.instantiate(bookId)));
    if (Result.isFailure(opened)) return undefined;
    return shell.services.seated(bookId);
  };

  /**
   * Your text against each side of the selected version, per book it shows:
   * what Adopt writes from, and whether it would change anything. Follows
   * your edits to those books (`stampOf`), and nothing else.
   */
  const yours = createMemo(
    (): ReadonlyMap<BookId, Yours> => {
      const out = new Map<BookId, Yours>();
      if (selected() === WORKING) return out;
      const held = shown().filter((changes) => changes.firstTime !== true);
      for (const changes of held) void shell.stampOf(changes.bookId)?.revision;
      // The reads above are the dependencies; the diffs below are snapshots of them.
      return untrack(() => {
        const galley = shell.services.galley;
        for (const changes of held) {
          const texts = changes.changes;
          const book = shell.project()?.book(changes.bookId);
          if (texts === undefined || book === undefined) continue;
          const stamp = book.source().stamp;
          const against = (text: string): UnitChanges | undefined =>
            changesOf(galley, book, { bookId: changes.bookId, stamp, text }).changes;
          const version = against(texts.workingText);
          const before = against(texts.baselineText);
          const sides: DiffSides | undefined =
            version === undefined
              ? undefined
              : {
                  bookId: changes.bookId,
                  baselineText: version.baselineText,
                  currentText: version.workingText,
                  baseline: yoursAnalysis("version", changes.bookId, version.baselineText),
                  current: yoursAnalysis("yours", changes.bookId, version.workingText),
                };
          out.set(changes.bookId, { book, version, before, sides });
        }
        return out;
      });
    },
    { name: "historyYours" },
  );

  /** One parse per text per book, held while the text is the same — as the reader holds its own. */
  const yoursAnalyzers = new Map<string, (text: string) => Analysis>();
  const yoursAnalysis = (role: "version" | "yours", bookId: BookId, text: string): Analysis => {
    const key = `${role}\0${bookId}`;
    let analyze = yoursAnalyzers.get(key);
    if (analyze === undefined) {
      analyze = shell.services.galley.memoize();
      yoursAnalyzers.set(key, analyze);
    }
    return analyze(text);
  };

  /**
   * Your text's changes against one side that fall in this card's passage.
   * Matched by place in THAT side's text, which both diffs share: a card's
   * `current` ranges (before → this version) and a unit's `baseline` range in
   * "your text against this version" are offsets into the same text; likewise
   * `baseline` and "your text against before it". Empty: your text already
   * reads as that side here.
   */
  const yoursAt = (hunk: Hunk, side: "baseline" | "current"): readonly DecisionUnit[] => {
    const held = yours().get(hunk.bookId);
    const changes = side === "current" ? held?.version : held?.before;
    if (changes === undefined) return [];
    const spans = hunk.units.map(
      (unit) =>
        (side === "current" ? unit.current : unit.baseline) ??
        point(side === "current" ? unit.place.current : unit.place.baseline),
    );
    return changes.units.filter((mine) =>
      spans.some((span) => overlaps(span, mine.baseline ?? point(mine.place.baseline))),
    );
  };

  /**
   * One side of a card, written into your text: for its passage, your text
   * takes that side's wording. Never a revert of the version, never a
   * checkout — one ordinary edit, unsaved until Record a version, and one
   * Undo takes it back.
   */
  const adopt = (hunk: Hunk, side: "baseline" | "current"): void => {
    const held = yours().get(hunk.bookId);
    const changes = side === "current" ? held?.version : held?.before;
    const picked = yoursAt(hunk, side);
    if (held === undefined || changes === undefined || picked.length === 0) {
      toasts.success({ title: t("Already in your text") });
      return;
    }
    const done = revertUnits(shell.services.galley, held.book, changes, picked);
    if (Result.isFailure(done)) {
      toasts.error({ title: t("Adopt refused"), message: t(done.failure.reason) });
      return;
    }
    toasts.success({ title: t("Adopted into your text") });
    shell.changed({ kind: "book.apply", books: [hunk.bookId] });
  };

  /**
   * A card's Adopt on either side, its "Yours differs", and the row that
   * opens. In a split each sits under its side's caption; unified, both are
   * in the header and say which side they take.
   */
  const sidesOf = (hunk: Hunk, split: boolean) => {
    const already = t("Your text already reads this way here.");
    const adoptOf = (side: "baseline" | "current", id: string, label: string): CardAction => {
      const off = yoursAt(hunk, side).length === 0;
      return {
        kind: "button",
        id,
        emphasis: "tertiary",
        label,
        disabled: off,
        title: off
          ? already
          : t("Write this wording into your text. Unsaved until you record a version."),
        onPress: () => adopt(hunk, side),
      };
    };
    const differs = yoursAt(hunk, "current");
    const open = differs.length > 0 && yoursOpen().has(hunk.key);
    const sides = yours().get(hunk.bookId)?.sides;
    return {
      baseline: [adoptOf("baseline", "adopt-before", split ? t("Adopt") : t("Adopt before"))],
      current: [
        ...(differs.length === 0
          ? []
          : [
              {
                kind: "button",
                id: "yours",
                emphasis: "tertiary",
                label: t("Yours differs"),
                pressed: open,
                title: t("Show your text against this version"),
                onPress: () =>
                  setYoursOpen((was) => {
                    const next = new Set(was);
                    if (!next.delete(hunk.key)) next.add(hunk.key);
                    return next;
                  }),
              } satisfies CardAction,
            ]),
        adoptOf("current", "adopt-version", split ? t("Adopt") : t("Adopt this version")),
      ],
      below:
        open && sides !== undefined ? (
          <YoursRow
            sides={sides}
            hunks={hunksOf({
              bookId: hunk.bookId,
              units: differs,
              baseline: sides.baseline,
              current: sides.current,
              label: (address) => untrack(() => shell.location.label(address)),
              steps: 0,
            })}
            usfm={markup()}
            label={t("Your text against this version")}
          />
        ) : undefined,
    };
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
        actions={
          <>
            <Button icon={<RefreshCw />} onClick={load}>
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
            <Show when={older() !== "whole"}>
              <Card class="space-y-2" data-history-older={older()}>
                <p class="text-small text-on-surface-secondary">
                  {older() === "loading"
                    ? t("Bringing the older history to this device…")
                    : older() === "failed"
                      ? t(
                          "The older history could not be brought to this device. What is here is recent history only.",
                        )
                      : t(
                          "Only recent history is on this device. The older history is on the shared project.",
                        )}
                </p>
                <Show when={older() !== "loading"}>
                  <div class="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => loadOlder(HISTORY_STEP)}>
                      {t("Load {count} more", { count: HISTORY_STEP })}
                    </Button>
                    <Button variant="tertiary" size="sm" onClick={() => loadOlder("all")}>
                      {t("Load all")}
                    </Button>
                  </div>
                </Show>
              </Card>
            </Show>
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

            {/* Its own scroller: a long history scrolls inside the card, and
                the column stays one screen tall beside the changes. */}
            <Card padded={false} class="max-h-[70vh] overflow-y-auto" aria-label={t("Timeline")}>
              <ul class="divide-y divide-surface-border" data-commits={log()?.length ?? 0}>
                <li>
                  <button
                    type="button"
                    data-commit={WORKING}
                    aria-current={selected() === WORKING ? "true" : undefined}
                    class={ROW}
                    onClick={() => choose(WORKING)}
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

                {/* The first read of the log: the shared short-wait spinner. */}
                <Show when={log() === undefined && problem() === ""}>
                  <li>
                    <DelayedSpinner />
                  </li>
                </Show>
                <For each={log() ?? []}>
                  {(commit, index) => (
                    <>
                      {/* Only when some versions are not shared yet: a divider
                        above them, and one where the shared ones begin. */}
                      <Show when={index() === 0 && onlyHere(commit.id)}>
                        <li
                          data-history-divider="local"
                          class="bg-surface-secondary px-3 py-1 text-smallest font-medium text-on-surface-warning"
                        >
                          {t("Only on this device")}
                        </li>
                      </Show>
                      <Show
                        when={
                          index() > 0 &&
                          !onlyHere(commit.id) &&
                          onlyHere((log() ?? [])[index() - 1]?.id ?? "")
                        }
                      >
                        <li
                          data-history-divider="shared"
                          class="bg-surface-secondary px-3 py-1 text-smallest font-medium text-on-surface-tertiary"
                        >
                          {t("On the shared project")}
                        </li>
                      </Show>
                      <li>
                        <button
                          type="button"
                          data-commit={commit.id}
                          aria-current={selected() === commit.id ? "true" : undefined}
                          class={ROW}
                          onClick={() => choose(commit.id)}
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
                    </>
                  )}
                </For>
              </ul>
            </Card>

            <Show when={problem() === "" && log()?.length === 0}>
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
                  : t("What this version changed.")
              }
            />

            <Show
              when={shown().length > 0}
              fallback={
                <EmptyState
                  title={
                    selected() === WORKING
                      ? t("Everything on screen is already in the latest version.")
                      : t("This version changed no book's text.")
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
                            <Badge tone="warning">
                              {t("{count} change(s)", { count: changeCount(changes) })}
                            </Badge>
                            <Show when={changes.added > 0}>
                              <Badge tone="success">
                                {t("+{count} added", { count: changes.added })}
                              </Badge>
                            </Show>
                            <Show when={changes.removed > 0}>
                              <Badge tone="error">
                                {t("−{count} removed", { count: changes.removed })}
                              </Badge>
                            </Show>
                          </>
                        }
                      >
                        <Badge tone="brand">{t("first version")}</Badge>
                        <Badge tone="success">
                          {t("{count} line(s)", { count: changes.added })}
                        </Badge>
                      </Show>
                      {/* Against the last version, a book can go back. A version's
                          change is adopted a card at a time, never a whole side:
                          taking a book wholesale is Review's. */}
                      <Show when={selected() === WORKING && changes.firstTime !== true}>
                        <Button
                          size="sm"
                          variant="tertiary"
                          class="ms-auto"
                          icon={<Undo2 />}
                          onClick={() => revertFile(changes)}
                        >
                          {t("Revert file")}
                        </Button>
                      </Show>
                    </div>
                  </section>
                )}
              </For>
              {/* The changes themselves: the multibuffer Review reads with —
                  the same cards, steps, chapter and fold-back, Open in the
                  book. Against the last version a card can put that passage
                  back (Take); for a version's own change, Adopt on either side
                  (on hover) writes that side's wording into your text, and
                  "Yours differs" opens your text against this version. Neither
                  writes a file. */}
              <Show when={reviewBooks().length > 0}>
                <div class="flex h-[70vh] min-h-0 flex-col" data-history-reader>
                  <ReviewReader
                    books={reviewBooks()}
                    decision={() => undefined}
                    decide={(bookId, units, side) => {
                      if (side !== "baseline") return;
                      const changes = shown().find((held) => held.bookId === bookId);
                      if (changes !== undefined) announce(bookId, revertSome(changes, units));
                    }}
                    decidable={selected() === WORKING}
                    sides={selected() === WORKING ? undefined : sidesOf}
                    usfm={markup()}
                    onUsfm={setMarkup}
                    currentLabel={
                      selected() === WORKING
                        ? t("Your text")
                        : t("This version · {when}", {
                            when: dated(selectedCommit()?.at ?? Date.now()),
                          })
                    }
                    baselineLabel={(bookId) => {
                      const id = selected();
                      if (id === WORKING) return t("Last version");
                      const before = previousOf(bookId, id);
                      return before === undefined
                        ? t("Before it")
                        : t("Before it · {when}", { when: dated(before.commit.at) });
                    }}
                    currentShort={selected() === WORKING ? t("yours") : t("this version")}
                    baselineShort={selected() === WORKING ? t("the last version") : t("before")}
                    selected={focusBook()}
                    onSelect={setFocusBook}
                    seat={seatBook}
                    onEdited={(bookId) => shell.changed({ kind: "book.apply", books: [bookId] })}
                    currentFirst={false}
                  />
                </div>
              </Show>
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
