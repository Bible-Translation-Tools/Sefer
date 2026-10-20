import type { EditorBook } from "@sefer/editor";
import type { Book, BookId } from "@sefer/text/book";
import { decode, type Source } from "@sefer/text/source";
import { useNavigate, useSearch } from "@tanstack/solid-router";
import { Effect, Option, Result } from "effect";
import GitCommitVertical from "lucide-solid/icons/git-commit-vertical";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";

import { diffSkeleton } from "#core/diff/skeleton";
import { revertUnits, type UnitChanges } from "#core/diff/units";
import type { Analysis, DecisionUnit } from "#core/galley";
import type { Commit, Version } from "#core/git/git";
import { Git, repositoryPath } from "#core/git/git";
import { Remote, type Deepen } from "#core/remote/remote";
import { trackingRef } from "#core/sync";

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
  DelayedSpinner,
  EmptyState,
  IconButton,
  PanelHeader,
  toasts,
} from "../primitives";
import { ReviewReader, type ReviewBook } from "../review/ReviewReader";
import { bookName } from "../workspace/books";
import { ChangesHistorySidebar } from "../workspace/ChangesHistorySidebar";
import { metadataOf } from "../workspace/project";
import { claimSidebar } from "../workspace/sidebarSlot";
import {
  changeCount,
  changesOf,
  unsavedChanges,
  versionChanges,
  type BookChanges,
} from "./changes";
import { ago, dated, exact } from "./format";
import { YoursRow } from "./YoursRow";

const ROW = [
  "flex w-full cursor-pointer flex-col gap-1 px-3.5 py-3 text-start transition-colors",
  "hover:bg-surface-secondary",
  "aria-[current=true]:bg-brand-light",
  "aria-[current=true]:shadow-[inset_0.1875rem_0_0_0_var(--brand-base)]",
].join(" ");

interface Yours {
  readonly book: Book;
  readonly version: UnitChanges | undefined;
  readonly before: UnitChanges | undefined;
  readonly sides: DiffSides | undefined;
}

const point = (at: number): Range => ({ from: at, to: at });

const overlaps = (a: Range, b: Range): boolean =>
  a.from === a.to || b.from === b.to
    ? a.from <= b.to && b.from <= a.to
    : a.from < b.to && b.from < a.to;

const HISTORY_STEP = 10;

const deepened = new Set<string>();

interface Timeline {
  readonly kind: "read";
  readonly commits: readonly Commit[];
  readonly perBook: ReadonlyMap<BookId, readonly Version[]>;
  readonly shallow: boolean;
  readonly shared: ReadonlySet<string> | undefined;
}

const timelines = new Map<string, { readonly tips: string; readonly timeline: Timeline }>();

export function HistoryPanel() {
  const shell = useShell();
  const navigate = useNavigate();
  const [log, setLog] = createSignal<readonly Commit[] | undefined>(undefined, { name: "gitLog" });
  const [versions, setVersions] = createSignal<ReadonlyMap<BookId, readonly Version[]>>(new Map(), {
    name: "gitVersions",
  });
  const [problem, setProblem] = createSignal("");
  const [shown, setShown] = createSignal<readonly BookChanges[]>([], { name: "shownDiff" });
  const [shared, setShared] = createSignal<ReadonlySet<string> | undefined>(undefined, {
    name: "historyShared",
  });
  const onlyHere = (id: string): boolean => {
    const known = shared();
    return known !== undefined && !known.has(id);
  };
  const [yoursOpen, setYoursOpen] = createSignal<ReadonlySet<string>>(new Set(), {
    name: "historyYoursOpen",
  });
  // SAFETY: `strict: false` gives the union of every route's search; `commit` is read as `unknown` and narrowed (the route validated it already).
  const search = useSearch({ strict: false }) as () => { readonly commit?: unknown };
  const selected = (): string => {
    const asked = search().commit;
    return typeof asked === "string" ? asked : (log()?.[0]?.id ?? "");
  };
  const choose = (id: string): void => {
    setYoursOpen(new Set<string>());
    void navigate({
      to: "/project/$slug/history",
      params: { slug: shell.slug() },
      search: { commit: id },
    });
  };
  const [older, setOlder] = createSignal<"whole" | "missing" | "loading" | "failed">("whole", {
    name: "historyOlder",
  });
  const emptyTitle = (): string => {
    if (log()?.length === 0) return t("No versions yet.");
    if (selected() === "") return t("Reading the history…");
    return t("This version changed no book's text.");
  };
  const olderNote = (): string => {
    if (older() === "loading") return t("Bringing the older history to this device…");
    if (older() === "failed")
      return t(
        "The older history could not be brought to this device. What is here is recent history only.",
      );
    return t("Only recent history is on this device. The older history is on the shared project.");
  };

  const load = (fresh = false): void => {
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
          const branch = yield* Effect.orElseSucceed(git.branch(repo), () => Option.none<string>());
          const tipOf = (ref: string) =>
            Effect.map(
              Effect.orElseSucceed(git.resolve(repo, ref), () => Option.none<string>()),
              (tip) => Option.getOrElse(tip, () => "-"),
            );
          const tips = [
            yield* tipOf("HEAD"),
            Option.isSome(branch) ? yield* tipOf(trackingRef(branch.value)) : "-",
            project.books.map((book) => book.id).join(","),
          ].join("|");
          const known = timelines.get(project.root);
          if (!fresh && known !== undefined && known.tips === tips) return known.timeline;
          const shallow = yield* Effect.orElseSucceed(git.shallow(repo), () => false);
          const paths = new Map<string, BookId>();
          for (const book of project.books) {
            const inside = repositoryPath(project.root, book.path);
            if (Option.isSome(inside)) paths.set(inside.value, book.id);
          }
          const read = yield* Effect.result(
            git.timeline(
              repo,
              [...paths.keys()],
              Option.isSome(branch) ? trackingRef(branch.value) : undefined,
            ),
          );
          const perBook = new Map<BookId, readonly Version[]>();
          if (Result.isSuccess(read))
            for (const [path, list] of read.success.versions) {
              const bookId = paths.get(path);
              if (bookId !== undefined) perBook.set(bookId, list);
            }
          const timeline: Timeline = {
            kind: "read",
            commits: Result.isSuccess(read) ? read.success.commits : [],
            perBook,
            shallow,
            shared: Result.isSuccess(read) ? read.success.shared : undefined,
          };
          timelines.set(project.root, { tips, timeline });
          return timeline;
        }),
      )
      .then((answer) => {
        if (answer.kind === "absent") {
          setProblem(answer.reason);
          setLog([]);
          return;
        }
        setProblem("");
        setLog(answer.commits);
        setVersions(answer.perBook);
        setShared(answer.shared);
        setOlder((now) => {
          if (!answer.shallow) return "whole";
          return now === "loading" ? now : "missing";
        });
        if (answer.shallow && !deepened.has(project.root) && syncStatus.interfaceUp()) {
          deepened.add(project.root);
          loadOlder(HISTORY_STEP);
        }
      });
  };

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
          setOlder("missing");
          load(true);
        },
        (cause: unknown) => {
          operation.end("failed", { "history.reason": remoteReasonOf(cause) ?? "unknown" });
          setOlder("failed");
        },
      );
  };
  untrack(load);

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

  const previousOf = (bookId: BookId, id: string): Version | undefined => {
    const list = versions().get(bookId) ?? [];
    const at = list.findIndex((version) => version.commit.id === id);
    return at < 0 ? undefined : list[at + 1];
  };

  const textOf = async (version: Version): Promise<Source | undefined> => {
    const bytes = await shell.services.run(Effect.result(version.bytes()));
    if (Result.isFailure(bytes)) return undefined;
    const decoded = decode(bytes.success);
    return Result.isFailure(decoded) ? undefined : decoded.success;
  };

  const recompute = async (): Promise<void> => {
    const project = shell.project();
    const id = selected();
    if (project === undefined || id === "") {
      setShown([]);
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

  createEffect(
    () => `${selected()}:${versions().size}`,
    () => {
      // Untracked on purpose: a one-time read, not a dependency (Solid 2: STRICT_READ_UNTRACKED).
      untrack(() => {
        void recompute();
      });
    },
  );

  const [markup, setMarkup] = createSignal(false, { name: "historyMarkup" });
  const [focusBook, setFocusBook] = createSignal<BookId | undefined>(undefined, {
    name: "historyBook",
  });

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

  const yours = createMemo(
    (): ReadonlyMap<BookId, Yours> => {
      const out = new Map<BookId, Yours>();
      if (selected() === "") return out;
      const held = shown().filter((changes) => changes.firstTime !== true);
      for (const changes of held) void shell.stampOf(changes.bookId)?.revision;
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

  const unsaved = (): number => unsavedChanges(shell).length;

  const review = (): void => {
    void navigate({ to: "/project/$slug/review", params: { slug: shell.slug() } });
  };

  const nameOf = (bookId: BookId): string => bookName(bookId, metadataOf(shell.project()));

  const Row = (props: { readonly commit: Commit }) => (
    <button
      type="button"
      data-commit={props.commit.id}
      aria-current={selected() === props.commit.id ? "true" : undefined}
      class={ROW}
      onClick={() => choose(props.commit.id)}
    >
      <span class="w-full truncate text-small font-medium text-on-surface-primary">
        {props.commit.message}
      </span>
      <span class="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-smallest text-on-surface-tertiary">
        <span>{props.commit.author.name}</span>
        <span aria-hidden="true">·</span>
        <time datetime={new Date(props.commit.at).toISOString()} title={exact(props.commit.at)}>
          {ago(props.commit.at)}
        </time>
        <span aria-hidden="true">·</span>
        <span class="font-mono">{props.commit.id.slice(0, 7)}</span>
      </span>
    </button>
  );

  onCleanup(
    claimSidebar(() => (
      <ChangesHistorySidebar active="history" changes={unsaved()}>
        <div class="flex items-center gap-2 px-4 pt-3 pb-2">
          <p class="min-w-0 flex-1 px-2 text-small text-on-surface-secondary">
            {t("{count} version(s)", { count: log()?.length ?? 0 })}
          </p>
          <IconButton
            size="sm"
            variant="subtle"
            label={t("Reload")}
            icon={<RefreshCw />}
            onClick={() => load(true)}
          />
        </div>
        <nav aria-label={t("Timeline")} class="min-h-0 flex-1 overflow-y-auto pb-4">
          <ul class="divide-y divide-sidebar-border" data-commits={log()?.length ?? 0}>
            <Show when={log() === undefined && problem() === ""}>
              <li class="px-4 py-3">
                <DelayedSpinner />
              </li>
            </Show>
            <For each={log() ?? []}>
              {(commit, index) => (
                <>
                  <Show when={index() === 0 && onlyHere(commit.id)}>
                    <li
                      data-history-divider="local"
                      class="px-5 py-1 text-smallest font-medium text-on-surface-warning"
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
                      class="px-5 py-1 text-smallest font-medium text-on-surface-tertiary"
                    >
                      {t("On the shared project")}
                    </li>
                  </Show>
                  <li>
                    <Row commit={commit} />
                  </li>
                </>
              )}
            </For>
          </ul>
          <Show when={older() !== "whole"}>
            <div class="space-y-2 px-5 pt-3" data-history-older={older()}>
              <p class="text-smallest text-on-surface-secondary">{olderNote()}</p>
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
            </div>
          </Show>
        </nav>
      </ChangesHistorySidebar>
    )),
  );

  return (
    <main class="flex h-full min-w-0 flex-col gap-4 p-6" data-history>
      <PanelHeader
        title={selectedCommit()?.message ?? t("History")}
        subtitle={
          <Show when={selectedCommit()}>
            {(commit) => (
              <span class="flex flex-wrap items-center gap-x-2">
                <span>{commit().author.name}</span>
                <span aria-hidden="true">·</span>
                <time datetime={new Date(commit().at).toISOString()}>{dated(commit().at)}</time>
                <span aria-hidden="true">·</span>
                <span class="font-mono">{commit().id.slice(0, 7)}</span>
              </span>
            )}
          </Show>
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
        <Show
          when={problem() === ""}
          fallback={
            <Show
              when={problem() === "NotARepository"}
              fallback={
                <EmptyState
                  title={t("Sefer could not read this project's history.")}
                  description={t("The repository refused the read: {reason}.", {
                    reason: problem(),
                  })}
                />
              }
            >
              <EmptyState
                icon={<GitCommitVertical size={22} />}
                title={t("Nothing has been recorded for this project yet.")}
                description={t(
                  "Your unsaved work is kept safe as you type, but your books are only written to disk when you Save & Review. That records a version you can come back to — the first one creates the repository.",
                )}
                action={
                  <Button variant="primary" size="sm" onClick={review}>
                    {t("Save & Review")}
                  </Button>
                }
              />
            </Show>
          }
        >
          <Show when={shown().length > 0} fallback={<EmptyState title={emptyTitle()} />}>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2" data-history-books>
              <For each={shown()}>
                {(changes) => (
                  <span class="flex items-center gap-2" data-diff-book={changes.bookId}>
                    <strong class="text-small font-semibold text-on-surface-primary">
                      {nameOf(changes.bookId)}
                    </strong>
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
                    </Show>
                  </span>
                )}
              </For>
            </div>

            <Show when={reviewBooks().length > 0}>
              <div class="flex min-h-0 flex-1 flex-col" data-history-reader>
                <ReviewReader
                  books={reviewBooks()}
                  decision={() => undefined}
                  decide={() => {}}
                  decidable={false}
                  claimSidebar={false}
                  sides={sidesOf}
                  usfm={markup()}
                  onUsfm={setMarkup}
                  currentLabel={t("This version · {when}", {
                    when: dated(selectedCommit()?.at ?? Date.now()),
                  })}
                  baselineLabel={(bookId) => {
                    const before = previousOf(bookId, selected());
                    return before === undefined
                      ? t("Before it")
                      : t("Before it · {when}", { when: dated(before.commit.at) });
                  }}
                  currentShort={t("this version")}
                  baselineShort={t("before")}
                  selected={focusBook()}
                  onSelect={setFocusBook}
                  seat={seatBook}
                  onEdited={(bookId) => shell.changed({ kind: "book.apply", books: [bookId] })}
                  currentFirst={false}
                />
              </div>
            </Show>
          </Show>
        </Show>
      </Show>
    </main>
  );
}
