import { useNavigate } from "@tanstack/solid-router";
import { CANON } from "@wycliffeassociates/sefer-text/location/canon";
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
  openOne,
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

function TestamentSection(props: {
  readonly testament: "ot" | "nt";
  readonly title: string;
  readonly rows: readonly BookRow[];
  readonly count: string;
  readonly current: string | undefined;
  readonly markOf: (row: BookRow) => { readonly tone: BadgeTone; readonly label: string };
  readonly onSelect: (book: string) => void;
}) {
  const own = (): readonly BookRow[] =>
    props.rows.filter((row) => testamentOfBook(row.book) === props.testament);
  return (
    <Show when={own().length > 0}>
      <div class="flex items-baseline justify-between border-b border-surface-border bg-surface-secondary px-3 py-1.5 text-smallest font-semibold text-on-surface-secondary">
        <span>{props.title}</span>
        <span class="font-normal">{props.count}</span>
      </div>
      <For each={own()}>
        {(row) => (
          <button
            type="button"
            data-testid={`migrate-row-${row.book}`}
            aria-current={props.current === row.book ? "true" : undefined}
            class={cx(
              "flex w-full items-center gap-2 border-b border-surface-border px-3 py-1.5 text-start text-small hover:bg-surface-secondary",
              props.current === row.book && "bg-surface-tertiary font-semibold",
            )}
            onClick={() => props.onSelect(row.book)}
          >
            <span class="me-auto truncate">
              {CANON.find((book) => book.id === row.book)?.name ?? row.book}
            </span>
            <Badge tone={props.markOf(row).tone} class="max-w-28 truncate">
              {props.markOf(row).label}
            </Badge>
          </button>
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

  onCleanup(forgetPicked);

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
        (inactiveToo || candidate.hints.status !== "Inactive"),
    );
    for (const candidate of initialQueue) setOpenedOf(candidate.id, { state: "opening" });
    const next = async (): Promise<void> => {
      const candidate = initialQueue.shift();
      if (candidate === undefined) return;
      setOpenedOf(candidate.id, await openOne(services, candidate));
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

  const needsChoice = createMemo(
    () => allRows().filter((row) => contested(row) && !chosen().has(row.book)),
    { name: "migrateNeedsChoice" },
  );

  const picked = createMemo(
    () =>
      allRows().flatMap((row) => {
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
    const total = CANON.filter((book) => book.testament === testament).length;
    const have = picked().filter((candidate) => testamentOfBook(candidate.book) === testament);
    return m.migrate_have_of_total({ have: have.length, total });
  };

  const assembleLabel = (): string => {
    if (assembling() && ready().some((staged) => (staged.history?.saves ?? 0) > 0))
      return m.migrate_writing_count_books_history({ count: picked().length });
    if (props.into === undefined) return m.migrate_assemble_count_books({ count: picked().length });
    return m.migrate_add_count_books({ count: picked().length });
  };

  const runAssemble = (): void => {
    const books = ready();
    const form = prefillForm(books);
    const name = `${form.language.id}_${form.resource}`.trim() || "writer-project";
    setAssembling(true);
    settle(
      (async () => {
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
    const books = ready();
    setAssembling(true);
    settle(
      (async () => {
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
    if (shown.length === 0) return { tone: "muted", label: m.migrate_left_out() };
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
              onSelect={setSelected}
            />
            <TestamentSection
              testament="nt"
              title={m.common_new_testament()}
              rows={allRows()}
              count={counted("nt")}
              current={current()?.book}
              markOf={mark}
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
