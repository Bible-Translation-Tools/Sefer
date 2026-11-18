import { useNavigate } from "@tanstack/solid-router";
import { books } from "@wycliffeassociates/scripture-kitchen/canon";
import { bookName } from "@wycliffeassociates/sefer-text/location/bookName";
import { Option } from "effect";
import FileArchive from "lucide-solid/icons/file-archive";
import FolderOpen from "lucide-solid/icons/folder-open";
import Link from "lucide-solid/icons/link";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";

import { m } from "#app/paraglide/messages";
import { prefillForm } from "#core/migrate/assemble";
import {
  candidateLabel,
  defaultCandidate,
  groupByBook,
  testamentOfBook,
  type BookCandidate,
  type BookRow,
  type StagedBook,
} from "#core/migrate/candidate";

import { announceSourceTexts } from "../../arrival";
import { describe } from "../../describe";
import { contentHostFor } from "../../endpoints";
import {
  addToProject,
  assembleProject,
  forgetPicked,
  historyFor,
  openOne,
  releaseOpened,
  pickLocal,
  remoteCandidates,
  urlCandidate,
  type Opened,
} from "../../migrate";
import { useShell } from "../../ProjectContext";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  Input,
  Menu,
  MenuItem,
  PanelHeader,
  cx,
  toasts,
  type BadgeTone,
} from "../primitives";
import { BookPane } from "./BookPane";
import { WriterLanguages } from "./WriterLanguages";

type Step = "find" | "books";

const OPEN_AT_ONCE = 10;

/** Picked copies whose full history is fetched at once before Assemble. */
const HISTORY_AT_ONCE = 6;

const refuseAdd = (
  label: string,
  found: readonly BookCandidate[],
  fresh: readonly BookCandidate[],
  language: string,
): boolean => {
  const otherLanguage = found.find(
    (candidate) => language !== "" && candidate.language.toLowerCase() !== language,
  );
  if (otherLanguage !== undefined && fresh.length === 0) {
    toasts.error({
      title: m.migrate_not_added_another_language(),
      message: m.migrate_this_run_assembles_language_label({
        language,
        label,
        other: otherLanguage.language,
      }),
    });
    return true;
  }
  if (found.length > 0 && fresh.length === 0) {
    toasts.success({
      title: m.migrate_nothing_new_in_label({ label }),
      message: m.migrate_this_project_already_has_every(),
    });
    return true;
  }
  if (found.length === 0) {
    toasts.error({
      title: m.migrate_no_writer_projects_in_label({ label }),
      message: m.migrate_a_writer_project_is_a(),
    });
    return true;
  }
  return false;
};

const settle = (work: Promise<void>, failure: string, done: () => void): void => {
  void work
    .catch((cause: unknown) => {
      toasts.error({ title: failure, message: describe(cause) });
    })
    .finally(done);
};

/**
 * One testament's books. Each has a box to leave it out of the run, so a team
 * can migrate one testament or part of one (the PO, 2026-11-17); the heading's
 * box takes or leaves the whole testament.
 */
function TestamentSection(props: {
  readonly testament: "ot" | "nt";
  readonly title: string;
  readonly rows: readonly BookRow[];
  readonly count: string;
  readonly current: string | undefined;
  readonly markOf: (row: BookRow) => { readonly tone: BadgeTone; readonly label: string };
  readonly included: (book: string) => boolean;
  readonly onInclude: (books: readonly string[], on: boolean) => void;
  readonly onSelect: (book: string) => void;
}) {
  const own = (): readonly BookRow[] =>
    props.rows.filter((row) => testamentOfBook(row.book) === props.testament);
  const taken = (): number => own().filter((row) => props.included(row.book)).length;
  return (
    <Show when={own().length > 0}>
      <div class="sticky top-0 z-10 flex items-center gap-2 border-b border-surface-border bg-surface-secondary px-3 py-2">
        <Checkbox
          checked={taken() === own().length}
          indeterminate={taken() > 0 && taken() < own().length}
          aria-label={m.migrate_include_testament({ testament: props.title })}
          data-testid={`migrate-include-${props.testament}`}
          onChange={(on) =>
            props.onInclude(
              own().map((row) => row.book),
              on,
            )
          }
        />
        <span class="me-auto text-small font-semibold text-on-surface-primary">{props.title}</span>
        <span class="text-smallest text-on-surface-secondary">{props.count}</span>
      </div>
      <For each={own()}>
        {(row) => (
          <div
            class={cx(
              "flex items-center gap-2 border-b border-surface-border ps-3 hover:bg-surface-secondary",
              props.current === row.book && "bg-surface-tertiary",
            )}
          >
            <Checkbox
              checked={props.included(row.book)}
              aria-label={m.migrate_include_book({ book: bookName(row.book) })}
              data-testid={`migrate-include-${row.book}`}
              onChange={(on) => props.onInclude([row.book], on)}
            />
            <button
              type="button"
              data-testid={`migrate-row-${row.book}`}
              aria-current={props.current === row.book ? "true" : undefined}
              class={cx(
                "flex min-w-0 flex-1 items-center gap-2 py-1.5 pe-3 text-start text-small",
                props.current === row.book && "font-semibold",
                !props.included(row.book) && "text-on-surface-tertiary",
              )}
              onClick={() => props.onSelect(row.book)}
            >
              <span class="me-auto truncate">{bookName(row.book)}</span>
              <Badge tone={props.markOf(row).tone} class="max-w-28 truncate">
                {props.markOf(row).label}
              </Badge>
            </button>
          </div>
        )}
      </For>
    </Show>
  );
}

function FindStep(props: {
  readonly adding: boolean;
  readonly busy: boolean;
  readonly online: boolean;
  readonly sources: readonly string[];
  readonly language: string;
  readonly onLocal: (kind: "folder" | "zip") => void;
  readonly onCatalogue: (code: string) => void;
}) {
  return (
    <>
      <Card class="flex flex-col gap-3">
        <PanelHeader
          title={!props.adding ? m.common_migrate_from_writer() : m.migrate_add_books_from_writer()}
          subtitle={
            !props.adding
              ? m.migrate_assemble_one_project_from_btt()
              : m.migrate_only_books_this_project_does()
          }
        />
        <div class="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            data-testid="migrate-folder"
            disabled={props.busy}
            icon={<FolderOpen aria-hidden="true" />}
            onClick={() => props.onLocal("folder")}
          >
            {m.migrate_folder_of_writer_projects()}
          </Button>
          <Button
            variant="secondary"
            data-testid="migrate-zip"
            disabled={props.busy}
            icon={<FileArchive aria-hidden="true" />}
            onClick={() => props.onLocal("zip")}
          >
            {m.migrate_zip_of_writer_projects()}
          </Button>
        </div>
        <Show when={props.sources.length > 0}>
          <p class="text-small text-on-surface-secondary">{props.sources.join(" · ")}</p>
        </Show>
      </Card>
      <Show
        when={props.online}
        fallback={
          <p class="text-small text-on-surface-secondary">{m.migrate_no_wacs_server_is_set()}</p>
        }
      >
        <Show
          when={!props.busy}
          fallback={
            <p class="py-8 text-center text-on-surface-tertiary">
              {m.migrate_listing_writer_projects()}
            </p>
          }
        >
          <WriterLanguages initial={props.language} onPick={props.onCatalogue} />
        </Show>
      </Show>
    </>
  );
}

function BooksToolbar(props: {
  readonly summary: string;
  readonly sources: readonly string[];
  readonly busy: boolean;
  readonly online: boolean;
  readonly inactiveCount: number;
  readonly showInactive: boolean;
  readonly needsChoice: number;
  readonly assembling: boolean;
  readonly canAssemble: boolean;
  readonly assembleLabel: string;
  readonly onLocal: (kind: "folder" | "zip") => void;
  readonly onUrl: () => void;
  readonly onToggleInactive: () => void;
  readonly onRecommended: () => void;
  readonly onAssemble: () => void;
}) {
  return (
    <Card padded={false} class="flex flex-wrap items-center gap-3 px-4 py-3">
      <span class="font-semibold" data-testid="migrate-summary">
        {props.summary}
      </span>
      <span class="me-auto truncate text-small text-on-surface-tertiary">
        {props.sources.join(" · ")}
      </span>

      <Menu
        label={m.migrate_add_a_writer_project()}
        side="bottom"
        align="end"
        trigger={
          <Button size="sm" variant="tertiary" disabled={props.busy} data-testid="migrate-add">
            {m.migrate_add_a_writer_project_2()}
          </Button>
        }
      >
        <MenuItem icon={<FolderOpen aria-hidden="true" />} onSelect={() => props.onLocal("folder")}>
          {m.migrate_folder()}
        </MenuItem>
        <MenuItem icon={<FileArchive aria-hidden="true" />} onSelect={() => props.onLocal("zip")}>
          {m.migrate_zip()}
        </MenuItem>
        <MenuItem
          icon={<Link aria-hidden="true" />}
          disabled={!props.online}
          onSelect={() => props.onUrl()}
        >
          {m.migrate_from_a_url()}
        </MenuItem>
      </Menu>
      <Show when={props.inactiveCount > 0}>
        <Button size="sm" variant="tertiary" onClick={props.onToggleInactive}>
          {props.showInactive
            ? m.migrate_hide_inactive()
            : m.migrate_show_inactive_count({ count: props.inactiveCount })}
        </Button>
      </Show>
      <Show when={props.needsChoice > 0}>
        <Button
          size="sm"
          variant="secondary"
          data-testid="migrate-recommended"
          onClick={props.onRecommended}
        >
          {m.migrate_use_the_recommended_one_for({ count: props.needsChoice })}
        </Button>
      </Show>
      <Button
        variant="primary"
        data-testid="migrate-next"
        loading={props.assembling}
        disabled={!props.canAssemble || props.assembling}
        onClick={props.onAssemble}
      >
        {props.assembleLabel}
      </Button>
    </Card>
  );
}

function UrlDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly url: string;
  readonly onUrl: (url: string) => void;
  readonly busy: boolean;
  readonly onSubmit: () => void;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={m.migrate_add_a_writer_project_from()}
      description={m.migrate_for_a_project_the_list()}
      footer={<Button onClick={() => props.onOpenChange(false)}>{m.common_cancel()}</Button>}
    >
      <form
        class="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        <Input
          type="url"
          wrapperClass="min-w-0 flex-1"
          aria-label={m.migrate_writer_project_url()}
          placeholder={m.migrate_https_content_bibletranslationtools_org()}
          value={props.url}
          onInput={(event) => props.onUrl(event.currentTarget.value)}
        />
        <Button
          type="submit"
          variant="primary"
          loading={props.busy}
          disabled={props.busy || props.url.trim() === ""}
          data-testid="migrate-url-add"
        >
          {m.migrate_add()}
        </Button>
      </form>
    </Dialog>
  );
}

export function MigrateScreen(props: {
  readonly into?: string | undefined;
  readonly language?: string | undefined;
}) {
  const shell = useShell();
  const { services } = shell;
  const navigate = useNavigate();
  const online = contentHostFor(services.settings) !== null;

  const [candidates, setCandidates] = createSignal<readonly BookCandidate[]>([], {
    name: "migrateCandidates",
  });
  const [opened, setOpened] = createSignal<ReadonlyMap<string, Opened>>(new Map(), {
    name: "migrateOpened",
  });
  const [chosen, setChosen] = createSignal<ReadonlyMap<string, string>>(new Map(), {
    name: "migrateChosen",
  });
  const [sources, setSources] = createSignal<readonly string[]>([], { name: "migrateSources" });
  const intoProject = untrack(() => {
    const open = shell.project();
    return props.into !== undefined && open?.root === props.into ? open : undefined;
  });
  const held: readonly string[] = intoProject?.books.map((book) => book.id) ?? [];
  const intoLanguage = Option.match(intoProject?.metadata() ?? Option.none(), {
    onNone: () => "",
    onSome: (metadata) => metadata.language.tag.toLowerCase(),
  });
  const [busy, setBusy] = createSignal(false, { name: "migrateBusy" });
  const [askingUrl, setAskingUrl] = createSignal(false, { name: "migrateAskingUrl" });
  const [url, setUrl] = createSignal("", { name: "migrateUrl" });
  const [showInactive, setShowInactive] = createSignal(false, { name: "migrateInactive" });
  const [step, setStep] = createSignal<Step>("find", { name: "migrateStep" });
  const [selected, setSelected] = createSignal<string | undefined>(undefined, {
    name: "migrateSelected",
  });
  const [assembling, setAssembling] = createSignal(false, { name: "migrateAssembling" });
  /**
   * Books left out of this run: not opened, not assembled. `leftOut` is the
   * plain copy the opening queue reads: a signal written in one pass still
   * reads its old value in that pass (Solid 2), so ticking a book and then
   * queueing it would see it as still left out.
   */
  const leftOut = new Set<string>();
  const [skipped, setSkipped] = createSignal<ReadonlySet<string>>(new Set(), {
    name: "migrateSkipped",
  });
  const included = (book: string): boolean => !skipped().has(book);

  onCleanup(forgetPicked);
  onCleanup(() => untrack(opened).forEach(releaseOpened));

  const openedOf = (id: string): Opened => opened().get(id) ?? { state: "waiting" };

  const setOpenedOf = (id: string, value: Opened): void => {
    setOpened((held) => new Map(held).set(id, value));
  };

  const openPending = async (
    listed: readonly BookCandidate[],
    inactiveToo: boolean,
  ): Promise<void> => {
    const initialQueue = listed.filter(
      (candidate) =>
        openedOf(candidate.id).state === "waiting" &&
        !leftOut.has(candidate.book) &&
        (inactiveToo || candidate.hints.status !== "Inactive"),
    );
    for (const candidate of initialQueue) setOpenedOf(candidate.id, { state: "opening" });
    const next = async (): Promise<void> => {
      const candidate = initialQueue.shift();
      if (candidate === undefined) return;
      // Left out while it waited: no clone, no history. Ticking it again opens it.
      if (leftOut.has(candidate.book)) setOpenedOf(candidate.id, { state: "waiting" });
      else setOpenedOf(candidate.id, await openOne(services, candidate));
      await next();
    };
    await Promise.all(Array.from({ length: OPEN_AT_ONCE }, next));
  };

  /**
   * The run's language, once it has one: the project being added to, or the
   * first source picked. A run is one language (Will, 2026-10-07: "if you pick
   * from a starting point, that's what we're doing").
   */
  const runLanguage = (): string =>
    intoLanguage !== "" ? intoLanguage : (candidates()[0]?.language.toLowerCase() ?? "");

  const add = (label: string, found: readonly BookCandidate[]): void => {
    const known = new Set(candidates().map((candidate) => candidate.id));
    const language = runLanguage();
    const fresh = found.filter(
      (candidate) =>
        !known.has(candidate.id) &&
        !held.includes(candidate.book) &&
        (language === "" || candidate.language.toLowerCase() === language),
    );
    if (refuseAdd(label, found, fresh, language)) return;
    setCandidates((held) => [...held, ...fresh]);
    setStep("books");
    setSources((held) => [
      ...held,
      m.migrate_label_count_writer_projects({ label, count: found.length }),
    ]);
    void openPending(fresh, showInactive());
  };

  const fromLocal = (kind: "folder" | "zip"): void => {
    setBusy(true);
    settle(
      (async () => {
        const found = await pickLocal(services, kind);
        if (found !== undefined)
          add(kind === "zip" ? m.migrate_a_zip() : m.migrate_a_folder(), found);
      })(),
      m.migrate_could_not_read_it(),
      () => setBusy(false),
    );
  };

  const fromUrl = (): void => {
    const typed = url().trim();
    if (typed === "") return;
    setBusy(true);
    settle(
      (async () => {
        const candidate = await urlCandidate(services, typed);
        add(
          candidate.origin.kind === "remote"
            ? `${candidate.origin.owner}/${candidate.origin.repo}`
            : typed,
          [candidate],
        );
        setAskingUrl(false);
        setUrl("");
      })(),
      m.migrate_could_not_add_that_writer(),
      () => setBusy(false),
    );
  };

  const fromCatalogue = (code: string): void => {
    setBusy(true);
    settle(
      (async () => {
        add(m.migrate_the_catalogue_code({ code }), await remoteCandidates(services, code));
      })(),
      m.migrate_the_catalogue_did_not_answer(),
      () => setBusy(false),
    );
  };

  createEffect(
    () => props.language,
    (language) => {
      if (language !== undefined && online) fromCatalogue(language);
    },
  );

  const allRows = createMemo(() => groupByBook(candidates()), { name: "migrateAllRows" });

  const visible = (row: BookRow): readonly BookCandidate[] =>
    row.candidates.filter(
      (candidate) =>
        (showInactive() || candidate.hints.status !== "Inactive") &&
        openedOf(candidate.id).state !== "refused",
    );

  const pick = (row: BookRow): BookCandidate | undefined => {
    const shown = visible(row);
    const id = chosen().get(row.book);
    return shown.find((candidate) => candidate.id === id) ?? defaultCandidate(shown);
  };

  const contested = (row: BookRow): boolean => visible(row).length > 1;

  const include = (list: readonly string[], on: boolean): void => {
    for (const book of list) {
      if (on) leftOut.delete(book);
      else leftOut.add(book);
    }
    setSkipped(new Set(leftOut));
    if (on) {
      const wanted = new Set(list);
      void openPending(
        candidates().filter((candidate) => wanted.has(candidate.book)),
        showInactive(),
      );
    }
  };

  const takenRows = createMemo(() => allRows().filter((row) => included(row.book)), {
    name: "migrateTakenRows",
  });

  const needsChoice = createMemo(
    () => takenRows().filter((row) => contested(row) && !chosen().has(row.book)),
    { name: "migrateNeedsChoice" },
  );

  const picked = createMemo(
    () =>
      takenRows().flatMap((row) => {
        const candidate = pick(row);
        return candidate === undefined ? [] : [candidate];
      }),
    { name: "migratePicked" },
  );

  const ready = (): readonly StagedBook[] =>
    picked().flatMap((candidate) => {
      const held = openedOf(candidate.id);
      return held.state === "ready" ? [held.staged] : [];
    });

  const stillOpening = (): number =>
    picked().filter((candidate) => openedOf(candidate.id).state !== "ready").length;

  const checking = (): number =>
    [...opened().values()].filter((held) => held.state === "opening").length;

  const canAssemble = (): boolean =>
    picked().length > 0 && needsChoice().length === 0 && stillOpening() === 0;

  const counted = (testament: "ot" | "nt"): string => {
    const total = books("protestant66").filter((book) => book.division === testament).length;
    const have = picked().filter((candidate) => testamentOfBook(candidate.book) === testament);
    return m.migrate_have_of_total({ have: have.length, total });
  };

  /** Books whose history is still being fetched before Assemble: 0 when not fetching. */
  const [fetching, setFetching] = createSignal(0, { name: "migrateFetching" });

  /**
   * Every picked copy with its saves (`historyFor`), a few at a time. Copies
   * are checked with their latest commit only, so this is the one download of
   * the history Assemble replays; each is kept, so a retry does not fetch again.
   */
  const withHistories = async (): Promise<readonly StagedBook[]> => {
    // What was picked when Assemble was clicked; a later pick does not join this run.
    const initialPicks = picked().flatMap((candidate) => {
      const held = openedOf(candidate.id);
      return held.state === "ready" ? [held] : [];
    });
    const out: StagedBook[] = initialPicks.map((held) => held.staged);
    let next = 0;
    setFetching(initialPicks.length);
    const worker = async (): Promise<void> => {
      while (next < initialPicks.length) {
        const at = next;
        next += 1;
        const held = initialPicks[at];
        if (held === undefined) continue;
        const staged = await historyFor(services, held);
        out[at] = staged;
        setOpenedOf(staged.candidate.id, { ...held, staged });
        setFetching((left) => left - 1);
      }
    };
    try {
      await Promise.all(Array.from({ length: HISTORY_AT_ONCE }, worker));
    } finally {
      setFetching(0);
    }
    return out;
  };

  const assembleLabel = (): string => {
    if (fetching() > 0) return m.migrate_fetching_history({ count: fetching() });
    if (assembling() && ready().some((staged) => (staged.history?.saves ?? 0) > 0))
      return m.migrate_writing_count_books_history({ count: picked().length });
    if (props.into === undefined) return m.migrate_assemble_count_books({ count: picked().length });
    return m.migrate_add_count_books({ count: picked().length });
  };

  const runAssemble = (): void => {
    setAssembling(true);
    settle(
      (async () => {
        const books = await withHistories();
        const form = prefillForm(books);
        const name = `${form.language.id}_${form.resource}`.trim() || "writer-project";
        const { root } = await services.run(assembleProject(services, name, form, books));
        toasts.success({
          title: m.migrate_assembled_count_books({ count: books.length }),
          message: root,
        });
        void announceSourceTexts(services, root);
        void navigate({ to: "/project/$slug", params: { slug: shell.slugFor(root) } });
      })(),
      m.migrate_could_not_assemble(),
      () => setAssembling(false),
    );
  };

  const runAdd = (): void => {
    const root = props.into;
    if (root === undefined) return;
    setAssembling(true);
    settle(
      (async () => {
        const books = await withHistories();
        await services.run(addToProject(services, root, held, books));
        toasts.success({
          title: m.migrate_added_count_books({ count: books.length }),
          message: root,
        });
        await shell.openProject(root);
        void navigate({ to: "/project/$slug", params: { slug: shell.slugFor(root) } });
      })(),
      m.migrate_could_not_add_the_books(),
      () => setAssembling(false),
    );
  };

  const recommended = (row: BookRow): BookCandidate | undefined => defaultCandidate(visible(row));

  const useRecommended = (): void => {
    setChosen((held) => {
      const next = new Map(held);
      for (const row of needsChoice()) {
        const candidate = recommended(row);
        if (candidate !== undefined) next.set(row.book, candidate.id);
      }
      return next;
    });
  };

  const current = (): BookRow | undefined =>
    allRows().find((row) => row.book === selected()) ?? needsChoice()[0] ?? allRows()[0];

  const mark = (row: BookRow): { readonly tone: BadgeTone; readonly label: string } => {
    const shown = visible(row);
    if (!included(row.book) || shown.length === 0)
      return { tone: "muted", label: m.migrate_left_out() };
    if (shown.length > 1 && !chosen().has(row.book))
      return { tone: "warning", label: m.migrate_choose_count({ count: shown.length }) };
    const candidate = pick(row);
    const held = candidate === undefined ? undefined : openedOf(candidate.id);
    if (held?.state === "refused") return { tone: "error", label: m.migrate_refused() };
    if (held?.state !== "ready") return { tone: "neutral", label: m.migrate_checking_2() };
    return { tone: "success", label: candidate === undefined ? "" : candidateLabel(candidate) };
  };

  const inactiveCount = (): number =>
    candidates().filter((candidate) => candidate.hints.status === "Inactive").length;

  return (
    <div class="flex min-w-0 flex-col gap-4">
      <Show when={step() === "find"}>
        <FindStep
          adding={intoProject !== undefined}
          busy={busy()}
          online={online}
          sources={sources()}
          language={intoLanguage}
          onLocal={fromLocal}
          onCatalogue={fromCatalogue}
        />
      </Show>

      <Show when={step() === "books"}>
        <BooksToolbar
          summary={[
            needsChoice().length > 0
              ? m.migrate_count_books_need_a_choice({ count: needsChoice().length })
              : m.migrate_count_books_ready({ count: picked().length - stillOpening() }),
            checking() > 0 ? m.migrate_checking_count_more({ count: checking() }) : "",
          ]
            .filter((part) => part !== "")
            .join(" · ")}
          sources={sources()}
          busy={busy()}
          online={online}
          inactiveCount={inactiveCount()}
          showInactive={showInactive()}
          needsChoice={needsChoice().length}
          assembling={assembling()}
          canAssemble={canAssemble()}
          assembleLabel={assembleLabel()}
          onLocal={fromLocal}
          onUrl={() => setAskingUrl(true)}
          onToggleInactive={() => {
            const on = !showInactive();
            setShowInactive(on);
            if (on) void openPending(candidates(), true);
          }}
          onRecommended={useRecommended}
          onAssemble={props.into === undefined ? runAssemble : runAdd}
        />

        <div class="grid min-h-0 grid-cols-[15rem_minmax(0,1fr)] items-start gap-4">
          <Card padded={false} data-tour="migrate-books" class="max-h-[75vh] overflow-y-auto">
            <TestamentSection
              testament="ot"
              title={m.common_old_testament()}
              rows={allRows()}
              count={counted("ot")}
              current={current()?.book}
              markOf={mark}
              included={included}
              onInclude={include}
              onSelect={setSelected}
            />
            <TestamentSection
              testament="nt"
              title={m.common_new_testament()}
              rows={allRows()}
              count={counted("nt")}
              current={current()?.book}
              markOf={mark}
              included={included}
              onInclude={include}
              onSelect={setSelected}
            />
          </Card>
          <Show when={current()} keyed>
            {(row) => (
              <BookPane
                book={row.book}
                candidates={visible(row)}
                opened={openedOf}
                picked={pick(row)?.id}
                recommended={recommended(row)?.id}
                onUse={(id) => setChosen((held) => new Map(held).set(row.book, id))}
              />
            )}
          </Show>
        </div>
      </Show>
      <UrlDialog
        open={askingUrl()}
        onOpenChange={setAskingUrl}
        url={url()}
        onUrl={setUrl}
        busy={busy()}
        onSubmit={fromUrl}
      />
    </div>
  );
}
