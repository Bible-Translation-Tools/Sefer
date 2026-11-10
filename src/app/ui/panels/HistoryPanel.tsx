import { useNavigate, useSearch } from "@tanstack/solid-router";
import type { EditorBook } from "@wycliffeassociates/sefer-editor";
import type { Book, BookId } from "@wycliffeassociates/sefer-text/book";
import * as TextResult from "@wycliffeassociates/sefer-text/result";
import { decode, type Source } from "@wycliffeassociates/sefer-text/source";
import { Effect, Option, Result } from "effect";
import GitCommitVertical from "lucide-solid/icons/git-commit-vertical";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
  type Accessor,
} from "solid-js";

import { diffSkeleton } from "#core/diff/skeleton";
import { revertUnits, type UnitChanges } from "#core/diff/units";
import type { Analysis, DecisionUnit } from "#core/galley";
import type { Commit, Repo, Version } from "#core/git/git";
import { Git, repositoryPath } from "#core/git/git";
import type { Project } from "#core/project/project";
import { Remote, type Deepen } from "#core/remote/remote";
import { trackingRef } from "#core/sync";

import { remoteReasonOf } from "../../describe";
import { m } from "../../paraglide/messages";
import { useShell, type Shell } from "../../ProjectContext";
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

type Older = "whole" | "missing" | "loading" | "failed";

type Answer = Timeline | { readonly kind: "absent"; readonly reason: string };

interface HistoryState {
  readonly setLog: (log: readonly Commit[]) => void;
  readonly setVersions: (versions: ReadonlyMap<BookId, readonly Version[]>) => void;
  readonly setProblem: (problem: string) => void;
  readonly setShared: (shared: ReadonlySet<string> | undefined) => void;
  readonly setOlder: (update: (now: Older) => Older) => void;
}

const none = () => Option.none<string>();

const tipsOf = (project: Project, repo: Repo, branch: Option.Option<string>) =>
  Effect.gen(function* () {
    const git = yield* Git;
    const tipOf = (ref: string) =>
      Effect.map(Effect.orElseSucceed(git.resolve(repo, ref), none), (tip) =>
        Option.getOrElse(tip, () => "-"),
      );
    return [
      yield* tipOf("HEAD"),
      Option.isSome(branch) ? yield* tipOf(trackingRef(branch.value)) : "-",
      project.books.map((book) => book.id).join(","),
    ].join("|");
  });

const readFresh = (project: Project, repo: Repo, branch: Option.Option<string>, tips: string) =>
  Effect.gen(function* () {
    const git = yield* Git;
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
  });

const readTimeline = (project: Project, fresh: boolean) =>
  Effect.gen(function* () {
    const git = yield* Git;
    const opened = yield* Effect.result(git.open(project.root));
    if (Result.isFailure(opened)) return { kind: "absent", reason: opened.failure.reason } as const;
    const repo = opened.success;
    const branch = yield* Effect.orElseSucceed(git.branch(repo), none);
    const tips = yield* tipsOf(project, repo, branch);
    const known = timelines.get(project.root);
    if (!fresh && known !== undefined && known.tips === tips) return known.timeline;
    return yield* readFresh(project, repo, branch, tips);
  });

const settleTimeline = (
  state: HistoryState,
  project: Project,
  answer: Answer,
  loadOlder: (more: Deepen) => void,
): void => {
  if (answer.kind === "absent") {
    state.setProblem(answer.reason);
    state.setLog([]);
    return;
  }
  state.setProblem("");
  state.setLog(answer.commits);
  state.setVersions(answer.perBook);
  state.setShared(answer.shared);
  state.setOlder((now) => {
    if (!answer.shallow) return "whole";
    return now === "loading" ? now : "missing";
  });
  if (answer.shallow && !deepened.has(project.root) && syncStatus.interfaceUp()) {
    deepened.add(project.root);
    loadOlder(HISTORY_STEP);
  }
};

const deepen = (project: Project, more: Deepen) =>
  Effect.gen(function* () {
    const git = yield* Git;
    const remote = yield* Remote;
    return yield* remote.deepen(yield* git.open(project.root), more);
  });

const createTimelineLoader = (shell: Shell, state: HistoryState) => {
  const load = (fresh = false): void => {
    const project = shell.project();
    if (project === undefined) return;
    void shell.services
      .run(readTimeline(project, fresh))
      .then((answer) => settleTimeline(state, project, answer, loadOlder));
  };

  const loadOlder = (more: Deepen): void => {
    const project = shell.project();
    if (project === undefined) return;
    state.setOlder(() => "loading");
    const operation = shell.services.composition.observability.operation("history.deepen", {
      "history.more": String(more),
    });
    void shell.services.run(deepen(project, more)).then(
      (progress) => {
        operation.end("passed", { "history.loaded": progress.loaded });
        state.setOlder(() => "missing");
        load(true);
      },
      (cause: unknown) => {
        operation.end("failed", { "history.reason": remoteReasonOf(cause) ?? "unknown" });
        state.setOlder(() => "failed");
      },
    );
  };

  return { load, loadOlder };
};

type VersionMap = ReadonlyMap<BookId, readonly Version[]>;

const booksIn = (versions: VersionMap, id: string): readonly BookId[] => {
  const out: BookId[] = [];
  for (const [bookId, list] of versions)
    if (list.some((version) => version.commit.id === id)) out.push(bookId);
  return out;
};

const versionOf = (versions: VersionMap, bookId: BookId, id: string): Version | undefined =>
  versions.get(bookId)?.find((version) => version.commit.id === id);

const previousOf = (versions: VersionMap, bookId: BookId, id: string): Version | undefined => {
  const list = versions.get(bookId) ?? [];
  const at = list.findIndex((version) => version.commit.id === id);
  return at < 0 ? undefined : list[at + 1];
};

const textOf = async (shell: Shell, version: Version): Promise<Source | undefined> => {
  const bytes = await shell.services.run(Effect.result(version.bytes()));
  if (Result.isFailure(bytes)) return undefined;
  const decoded = decode(bytes.success);
  return TextResult.isFailure(decoded) ? undefined : decoded.success;
};

const changesOfVersion = async (
  shell: Shell,
  project: Project,
  versions: VersionMap,
  bookId: BookId,
  id: string,
): Promise<BookChanges | undefined> => {
  const book = project.book(bookId);
  const version = versionOf(versions, bookId, id);
  if (book === undefined || version === undefined) return undefined;
  const after = await textOf(shell, version);
  if (after === undefined) return undefined;
  const previous = previousOf(versions, bookId, id);
  const before = previous === undefined ? undefined : await textOf(shell, previous);
  const changes = versionChanges(
    shell.services.galley,
    book,
    before === undefined ? undefined : { bookId, stamp: before.stamp, text: before.text },
    { bookId, stamp: after.stamp, text: after.text },
  );
  return changes.firstTime === true || changeCount(changes) > 0 ? changes : undefined;
};

const createShownChanges = (
  shell: Shell,
  selected: Accessor<string>,
  versions: Accessor<VersionMap>,
  setShown: (shown: readonly BookChanges[]) => void,
): void => {
  let asked = 0;
  const recompute = async (): Promise<void> => {
    asked += 1;
    const mine = asked;
    const project = shell.project();
    const id = selected();
    if (project === undefined || id === "") {
      setShown([]);
      return;
    }
    const out: BookChanges[] = [];
    for (const bookId of booksIn(versions(), id)) {
      const changes = await changesOfVersion(shell, project, versions(), bookId, id);
      if (changes !== undefined) out.push(changes);
    }
    // A version chosen since has its own answer coming.
    if (mine === asked) setShown(out);
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
};

const yoursFor = (
  shell: Shell,
  changes: BookChanges,
  analysis: (role: "version" | "yours", bookId: BookId, text: string) => Analysis,
): Yours | undefined => {
  const galley = shell.services.galley;
  const texts = changes.changes;
  const book = shell.project()?.book(changes.bookId);
  if (texts === undefined || book === undefined) return undefined;
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
          baseline: analysis("version", changes.bookId, version.baselineText),
          current: analysis("yours", changes.bookId, version.workingText),
        };
  return { book, version, before, sides };
};

const createYours = (
  shell: Shell,
  selected: Accessor<string>,
  shown: Accessor<readonly BookChanges[]>,
) => {
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

  return createMemo(
    (): ReadonlyMap<BookId, Yours> => {
      const out = new Map<BookId, Yours>();
      if (selected() === "") return out;
      const held = shown().filter((changes) => changes.firstTime !== true);
      for (const changes of held) void shell.stampOf(changes.bookId)?.revision;
      return untrack(() => {
        for (const changes of held) {
          const mine = yoursFor(shell, changes, yoursAnalysis);
          if (mine !== undefined) out.set(changes.bookId, mine);
        }
        return out;
      });
    },
    { name: "historyYours" },
  );
};

type YoursMap = ReadonlyMap<BookId, Yours>;

const yoursAt = (
  yours: YoursMap,
  hunk: Hunk,
  side: "baseline" | "current",
): readonly DecisionUnit[] => {
  const held = yours.get(hunk.bookId);
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

const adopt = (shell: Shell, yours: YoursMap, hunk: Hunk, side: "baseline" | "current"): void => {
  const held = yours.get(hunk.bookId);
  const changes = side === "current" ? held?.version : held?.before;
  const picked = yoursAt(yours, hunk, side);
  if (held === undefined || changes === undefined || picked.length === 0) {
    toasts.success({ title: m.history_already_in_your_text() });
    return;
  }
  const done = revertUnits(shell.services.galley, held.book, changes, picked);
  if (TextResult.isFailure(done)) {
    toasts.error({ title: m.history_adopt_refused(), message: done.failure.reason });
    return;
  }
  toasts.success({ title: m.history_adopted_into_your_text() });
  shell.changed({ kind: "book.apply", books: [hunk.bookId] });
};

const adoptAction = (
  shell: Shell,
  yours: YoursMap,
  hunk: Hunk,
  side: "baseline" | "current",
  id: string,
  label: string,
): CardAction => {
  const off = yoursAt(yours, hunk, side).length === 0;
  return {
    kind: "button",
    id,
    emphasis: "tertiary",
    label,
    disabled: off,
    title: off
      ? m.history_your_text_already_reads_this()
      : m.history_write_this_wording_into_your(),
    onPress: () => adopt(shell, yours, hunk, side),
  };
};

const yoursBelow = (
  shell: Shell,
  hunk: Hunk,
  differs: readonly DecisionUnit[],
  sides: DiffSides,
  markup: Accessor<boolean>,
) => (
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
    label={m.history_your_text_against_this_version()}
  />
);

const createSidesOf =
  (
    shell: Shell,
    yours: Accessor<YoursMap>,
    yoursOpen: Accessor<ReadonlySet<string>>,
    setYoursOpen: (update: (was: ReadonlySet<string>) => ReadonlySet<string>) => void,
    markup: Accessor<boolean>,
  ) =>
  (hunk: Hunk, split: boolean) => {
    const adoptOf = (side: "baseline" | "current", id: string, label: string): CardAction =>
      adoptAction(shell, yours(), hunk, side, id, label);
    const differs = yoursAt(yours(), hunk, "current");
    const open = differs.length > 0 && yoursOpen().has(hunk.key);
    const sides = yours().get(hunk.bookId)?.sides;
    return {
      baseline: [
        adoptOf("baseline", "adopt-before", split ? m.history_adopt() : m.history_adopt_before()),
      ],
      current: [
        ...(differs.length === 0
          ? []
          : [
              {
                kind: "button",
                id: "yours",
                emphasis: "tertiary",
                label: m.history_yours_differs(),
                pressed: open,
                title: m.history_show_your_text_against_this(),
                onPress: () =>
                  setYoursOpen((was) => {
                    const next = new Set(was);
                    if (!next.delete(hunk.key)) next.add(hunk.key);
                    return next;
                  }),
              } satisfies CardAction,
            ]),
        adoptOf(
          "current",
          "adopt-version",
          split ? m.history_adopt() : m.history_adopt_this_version(),
        ),
      ],
      below:
        open && sides !== undefined ? yoursBelow(shell, hunk, differs, sides, markup) : undefined,
    };
  };

function HistoryRow(props: {
  readonly commit: Commit;
  readonly selected: string;
  readonly onChoose: (id: string) => void;
}) {
  return (
    <button
      type="button"
      data-commit={props.commit.id}
      aria-current={props.selected === props.commit.id ? "true" : undefined}
      class={ROW}
      onClick={() => props.onChoose(props.commit.id)}
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
}

function TimelineList(props: {
  readonly log: readonly Commit[] | undefined;
  readonly problem: string;
  readonly selected: string;
  readonly onlyHere: (id: string) => boolean;
  readonly onChoose: (id: string) => void;
}) {
  return (
    <ul class="divide-y divide-sidebar-border" data-commits={props.log?.length ?? 0}>
      <Show when={props.log === undefined && props.problem === ""}>
        <li class="px-4 py-3">
          <DelayedSpinner />
        </li>
      </Show>
      <For each={props.log ?? []}>
        {(commit, index) => (
          <>
            <Show when={index() === 0 && props.onlyHere(commit.id)}>
              <li
                data-history-divider="local"
                class="px-5 py-1 text-smallest font-medium text-on-surface-warning"
              >
                {m.history_only_on_this_device()}
              </li>
            </Show>
            <Show
              when={
                index() > 0 &&
                !props.onlyHere(commit.id) &&
                props.onlyHere((props.log ?? [])[index() - 1]?.id ?? "")
              }
            >
              <li
                data-history-divider="shared"
                class="px-5 py-1 text-smallest font-medium text-on-surface-tertiary"
              >
                {m.history_on_the_shared_project()}
              </li>
            </Show>
            <li>
              <HistoryRow commit={commit} selected={props.selected} onChoose={props.onChoose} />
            </li>
          </>
        )}
      </For>
    </ul>
  );
}

const olderNoteOf = (older: Older): string => {
  if (older === "loading") return m.history_bringing_the_older_history_to();
  if (older === "failed") return m.history_the_older_history_could_not();
  return m.history_only_recent_history_is_on();
};

function OlderHistory(props: { readonly older: Older; readonly onLoad: (more: Deepen) => void }) {
  return (
    <div class="space-y-2 px-5 pt-3" data-history-older={props.older}>
      <p class="text-smallest text-on-surface-secondary">{olderNoteOf(props.older)}</p>
      <Show when={props.older !== "loading"}>
        <div class="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => props.onLoad(HISTORY_STEP)}>
            {m.history_load_count_more({ count: HISTORY_STEP })}
          </Button>
          <Button variant="tertiary" size="sm" onClick={() => props.onLoad("all")}>
            {m.history_load_all()}
          </Button>
        </div>
      </Show>
    </div>
  );
}

function HistorySidebar(props: {
  readonly changes: number;
  readonly log: readonly Commit[] | undefined;
  readonly problem: string;
  readonly selected: string;
  readonly older: Older;
  readonly onlyHere: (id: string) => boolean;
  readonly onChoose: (id: string) => void;
  readonly onReload: () => void;
  readonly onLoadOlder: (more: Deepen) => void;
}) {
  return (
    <ChangesHistorySidebar active="history" changes={props.changes}>
      <div class="flex items-center gap-2 px-4 pt-3 pb-2">
        <p class="min-w-0 flex-1 px-2 text-small text-on-surface-secondary">
          {m.history_count_versions({ count: props.log?.length ?? 0 })}
        </p>
        <IconButton
          size="sm"
          variant="subtle"
          label={m.common_reload()}
          icon={<RefreshCw />}
          onClick={props.onReload}
        />
      </div>
      <nav aria-label={m.history_timeline()} class="min-h-0 flex-1 overflow-y-auto pb-4">
        <TimelineList
          log={props.log}
          problem={props.problem}
          selected={props.selected}
          onlyHere={props.onlyHere}
          onChoose={props.onChoose}
        />
        <Show when={props.older !== "whole"}>
          <OlderHistory older={props.older} onLoad={props.onLoadOlder} />
        </Show>
      </nav>
    </ChangesHistorySidebar>
  );
}

function CommitSubtitle(props: { readonly commit: Commit }) {
  return (
    <span class="flex flex-wrap items-center gap-x-2">
      <span>{props.commit.author.name}</span>
      <span aria-hidden="true">·</span>
      <time datetime={new Date(props.commit.at).toISOString()}>{dated(props.commit.at)}</time>
      <span aria-hidden="true">·</span>
      <span class="font-mono">{props.commit.id.slice(0, 7)}</span>
    </span>
  );
}

function HistoryProblem(props: { readonly problem: string; readonly onReview: () => void }) {
  return (
    <Show
      when={props.problem === "NotARepository"}
      fallback={
        <EmptyState
          title={m.history_sefer_could_not_read_this()}
          description={m.history_the_repository_refused_the_read({
            reason: props.problem,
          })}
        />
      }
    >
      <EmptyState
        icon={<GitCommitVertical size={22} />}
        title={m.history_nothing_has_been_recorded_for()}
        description={m.history_your_unsaved_work_is_kept()}
        action={
          <Button variant="primary" size="sm" onClick={props.onReview}>
            {m.common_save_review()}
          </Button>
        }
      />
    </Show>
  );
}

function ChangedBooks(props: {
  readonly shown: readonly BookChanges[];
  readonly nameOf: (bookId: BookId) => string;
}) {
  return (
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2" data-history-books>
      <For each={props.shown}>
        {(changes) => (
          <span class="flex items-center gap-2" data-diff-book={changes.bookId}>
            <strong class="text-small font-semibold text-on-surface-primary">
              {props.nameOf(changes.bookId)}
            </strong>
            <Show
              when={changes.firstTime === true}
              fallback={
                <>
                  <Badge tone="warning">
                    {m.common_count_changes({ count: changeCount(changes) })}
                  </Badge>
                  <Show when={changes.added > 0}>
                    <Badge tone="success">{m.history_count_added({ count: changes.added })}</Badge>
                  </Show>
                  <Show when={changes.removed > 0}>
                    <Badge tone="error">
                      {m.history_count_removed({ count: changes.removed })}
                    </Badge>
                  </Show>
                </>
              }
            >
              <Badge tone="brand">{m.history_first_version()}</Badge>
            </Show>
          </span>
        )}
      </For>
    </div>
  );
}

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
  const search = useSearch({ from: "/_app/project/$slug/history" });
  const selected = (): string => search().commit ?? log()?.[0]?.id ?? "";
  const choose = (id: string): void => {
    setYoursOpen(new Set<string>());
    void navigate({
      to: "/project/$slug/history",
      params: { slug: shell.slug() },
      search: { commit: id },
    });
  };
  const [older, setOlder] = createSignal<Older>("whole", { name: "historyOlder" });
  const emptyTitle = (): string => {
    if (log()?.length === 0) return m.history_no_versions_yet();
    if (selected() === "") return m.history_reading_the_history();
    return m.history_this_version_changed_no_books();
  };

  const { load, loadOlder } = createTimelineLoader(shell, {
    setLog,
    setVersions,
    setProblem,
    setShared,
    setOlder,
  });
  untrack(load);

  createShownChanges(shell, selected, versions, setShown);

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

  const yours = createYours(shell, selected, shown);
  const sidesOf = createSidesOf(shell, yours, yoursOpen, setYoursOpen, markup);

  const selectedCommit = (): Commit | undefined =>
    log()?.find((commit) => commit.id === selected());

  const unsaved = (): number => unsavedChanges(shell).length;

  const review = (): void => {
    void navigate({ to: "/project/$slug/review", params: { slug: shell.slug() } });
  };

  const nameOf = (bookId: BookId): string => bookName(bookId, metadataOf(shell.project()));

  onCleanup(
    claimSidebar(
      () => (
        <HistorySidebar
          changes={unsaved()}
          log={log()}
          problem={problem()}
          selected={selected()}
          older={older()}
          onlyHere={onlyHere}
          onChoose={choose}
          onReload={() => load(true)}
          onLoadOlder={loadOlder}
        />
      ),
      { show: m.sidebar_show_history(), hide: m.sidebar_hide_history() },
    ),
  );

  return (
    <main class="flex h-full min-w-0 flex-col gap-4 p-6" data-history>
      <PanelHeader
        title={selectedCommit()?.message ?? m.common_history()}
        subtitle={
          <Show when={selectedCommit()}>{(commit) => <CommitSubtitle commit={commit()} />}</Show>
        }
      />

      <Show
        when={shell.project()}
        fallback={
          <EmptyState
            icon={<GitCommitVertical size={22} />}
            title={m.common_open_a_project_first()}
            description={m.history_history_is_read_from_the()}
          />
        }
      >
        <Show
          when={problem() === ""}
          fallback={<HistoryProblem problem={problem()} onReview={review} />}
        >
          <Show when={shown().length > 0} fallback={<EmptyState title={emptyTitle()} />}>
            <ChangedBooks shown={shown()} nameOf={nameOf} />

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
                  currentLabel={m.history_this_version_when({
                    when: dated(selectedCommit()?.at ?? Date.now()),
                  })}
                  baselineLabel={(bookId) => {
                    const before = previousOf(versions(), bookId, selected());
                    return before === undefined
                      ? m.history_before_it()
                      : m.history_before_it_when({ when: dated(before.commit.at) });
                  }}
                  currentShort={m.history_this_version()}
                  baselineShort={m.history_before()}
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
