/**
 * Migrate from Writer: assemble one project from single-book BTT Writer
 * projects, choosing between rival copies up front.
 *
 * Three steps, one screen:
 *
 *   find      a folder or zip of Writer projects, or a language from "Writer
 *             projects on WACS" (`WriterLanguages`) — several may be combined
 *             in one run, and every one works offline except the catalogue
 *   books     a sidebar of books in canonical order, under OT and NT, beside
 *             the selected book's candidates as a table (`BookPane`): who,
 *             status, updated, health, and passages differing from the pick
 *   project   the form, prefilled to bwc_reg's convention, then Assemble
 *
 * Inactive candidates are hidden by default; Primary is "Recommended". Every
 * candidate is opened and measured as soon as it is listed, a few at a time,
 * so the health a person chooses by is there when they look.
 */

import { useNavigate } from "@tanstack/solid-router";
import { Option } from "effect";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import FileArchive from "lucide-solid/icons/file-archive";
import FolderOpen from "lucide-solid/icons/folder-open";
import { For, Show, createMemo, createSignal, untrack } from "solid-js";

import { CANON } from "#core/location/canon";
import { prefillForm, type AssembleForm } from "#core/migrate/assemble";
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
import { t } from "../../i18n";
import {
  addToProject,
  assembleProject,
  openOne,
  pickLocal,
  remoteCandidates,
  type Opened,
} from "../../migrate";
import { useShell } from "../../ProjectContext";
import {
  Badge,
  Button,
  Card,
  Input,
  PanelHeader,
  Select,
  cx,
  toasts,
  type BadgeTone,
} from "../primitives";
import { BookPane } from "./BookPane";
import { WriterLanguages } from "./WriterLanguages";

type Step = "find" | "books" | "project";

const OPEN_AT_ONCE = 4;

export function MigrateScreen(props: { readonly into?: string | undefined }) {
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
  /** The person's choice per contested book; a settled book needs none. */
  const [chosen, setChosen] = createSignal<ReadonlyMap<string, string>>(new Map(), {
    name: "migrateChosen",
  });
  const [sources, setSources] = createSignal<readonly string[]>([], { name: "migrateSources" });
  /**
   * Adding to a project: the books it holds already are never offered (no
   * Bible prints John twice), and only its language is. Read once: this
   * screen is entered from the project, and leaves back to it.
   */
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
  const [showInactive, setShowInactive] = createSignal(false, { name: "migrateInactive" });
  const [step, setStep] = createSignal<Step>("find", { name: "migrateStep" });
  /** The book open in the main pane. */
  const [selected, setSelected] = createSignal<string | undefined>(undefined, {
    name: "migrateSelected",
  });
  const [form, setForm] = createSignal<AssembleForm | undefined>(undefined, {
    name: "migrateForm",
  });
  const [folder, setFolder] = createSignal("", { name: "migrateFolder" });
  const [assembling, setAssembling] = createSignal(false, { name: "migrateAssembling" });

  const openedOf = (id: string): Opened => opened().get(id) ?? { state: "waiting" };

  const setOpenedOf = (id: string, value: Opened): void => {
    setOpened((held) => new Map(held).set(id, value));
  };

  /**
   * Opens what is listed and not yet opened, a few at a time. Takes the list
   * and the Inactive switch as arguments rather than reading them: a signal
   * written in this same tick still reads its old value until the flush.
   */
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

  const add = (label: string, found: readonly BookCandidate[]): void => {
    const known = new Set(candidates().map((candidate) => candidate.id));
    const fresh = found.filter(
      (candidate) =>
        !known.has(candidate.id) &&
        !held.includes(candidate.book) &&
        (intoLanguage === "" || candidate.language.toLowerCase() === intoLanguage),
    );
    if (found.length > 0 && fresh.length === 0) {
      toasts.success({
        title: t("Nothing new in {label}", { label }),
        message: t("This project already has every book offered there."),
      });
      return;
    }
    if (found.length === 0) {
      toasts.error({
        title: t("No Writer projects in {label}", { label }),
        message: t("A Writer project is a folder with a manifest.json and chapter folders."),
      });
      return;
    }
    setCandidates((held) => [...held, ...fresh]);
    setStep("books");
    setSources((held) => [
      ...held,
      t("{label} · {count} Writer projects", { label, count: found.length }),
    ]);
    void openPending(fresh, showInactive());
  };

  const fromLocal = (kind: "folder" | "zip"): void => {
    setBusy(true);
    void (async () => {
      try {
        const found = await pickLocal(services, kind);
        if (found !== undefined) add(kind === "zip" ? t("a zip") : t("a folder"), found);
      } catch (cause) {
        toasts.error({ title: t("Could not read it"), message: describe(cause) });
      } finally {
        setBusy(false);
      }
    })();
  };

  const fromCatalogue = (code: string): void => {
    setBusy(true);
    void (async () => {
      try {
        add(t("the catalogue ({code})", { code }), await remoteCandidates(services, code));
      } catch (cause) {
        toasts.error({ title: t("The catalogue did not answer"), message: describe(cause) });
      } finally {
        setBusy(false);
      }
    })();
  };

  /** Every book, all candidates: what decides "left out, Inactive only". */
  const allRows = createMemo(() => groupByBook(candidates()), { name: "migrateAllRows" });

  const visible = (row: BookRow): readonly BookCandidate[] =>
    row.candidates.filter(
      (candidate) =>
        (showInactive() || candidate.hints.status !== "Inactive") &&
        openedOf(candidate.id).state !== "refused",
    );

  /** The candidate a book will be assembled from, or undefined when it is left out. */
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

  /** Candidates still being opened, whether or not they are the pick. */
  const checking = (): number =>
    [...opened().values()].filter((held) => held.state === "opening").length;

  const canAssemble = (): boolean =>
    picked().length > 0 && needsChoice().length === 0 && stillOpening() === 0;

  const counted = (testament: "ot" | "nt"): string => {
    const total = CANON.filter((book) => book.testament === testament).length;
    const have = picked().filter((candidate) => testamentOfBook(candidate.book) === testament);
    return t("{have} of {total}", { have: have.length, total });
  };

  const toProject = (): void => {
    const books = ready();
    const prefilled = prefillForm(books);
    setForm(prefilled);
    setFolder(`${prefilled.language.id}_${prefilled.resource}`);
    setStep("project");
  };

  const runAssemble = (): void => {
    const held = form();
    if (held === undefined) return;
    const books = ready();
    const name = folder().trim() || "writer-project";
    setAssembling(true);
    void (async () => {
      try {
        const { root } = await services.run(assembleProject(services, name, held, books));
        toasts.success({
          title: t("Assembled {count} books", { count: books.length }),
          message: root,
        });
        void announceSourceTexts(services, root);
        void navigate({ to: "/project/$slug", params: { slug: shell.slugFor(root) } });
      } catch (cause) {
        toasts.error({ title: t("Could not assemble"), message: describe(cause) });
      } finally {
        setAssembling(false);
      }
    })();
  };

  /** "Add a book…": the picks go into the open project, in one commit. */
  const runAdd = (): void => {
    const root = props.into;
    if (root === undefined) return;
    const books = ready();
    setAssembling(true);
    void (async () => {
      try {
        await services.run(addToProject(services, root, held, books));
        toasts.success({ title: t("Added {count} books", { count: books.length }), message: root });
        await shell.openProject(root);
        void navigate({ to: "/project/$slug", params: { slug: shell.slugFor(root) } });
      } catch (cause) {
        toasts.error({ title: t("Could not add the books"), message: describe(cause) });
      } finally {
        setAssembling(false);
      }
    })();
  };

  /** What the rule would pick for a book, marked Recommended. */
  const recommended = (row: BookRow): BookCandidate | undefined => defaultCandidate(visible(row));

  /** Every book still waiting on a choice takes the Recommended one. */
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

  /** The book in the main pane: the one picked in the list, else the first that needs a choice. */
  const current = (): BookRow | undefined =>
    allRows().find((row) => row.book === selected()) ?? needsChoice()[0] ?? allRows()[0];

  /** A book's mark in the list: what it is waiting on, or who it comes from. */
  const mark = (row: BookRow): { readonly tone: BadgeTone; readonly label: string } => {
    const shown = visible(row);
    if (shown.length === 0) return { tone: "muted", label: t("left out") };
    if (shown.length > 1 && !chosen().has(row.book))
      return { tone: "warning", label: t("choose · {count}", { count: shown.length }) };
    const candidate = pick(row);
    const held = candidate === undefined ? undefined : openedOf(candidate.id);
    if (held?.state === "refused") return { tone: "error", label: t("refused") };
    if (held?.state !== "ready") return { tone: "neutral", label: t("checking") };
    return { tone: "success", label: candidate === undefined ? "" : candidateLabel(candidate) };
  };

  const Section = (sectionProps: { readonly testament: "ot" | "nt"; readonly title: string }) => (
    <Show when={allRows().some((row) => testamentOfBook(row.book) === sectionProps.testament)}>
      <div class="flex items-baseline justify-between border-b border-surface-border bg-surface-secondary px-3 py-1.5 text-smallest font-semibold text-on-surface-secondary">
        <span>{sectionProps.title}</span>
        <span class="font-normal">{counted(sectionProps.testament)}</span>
      </div>
      <For each={allRows().filter((row) => testamentOfBook(row.book) === sectionProps.testament)}>
        {(row) => (
          <button
            type="button"
            data-testid={`migrate-row-${row.book}`}
            aria-current={current()?.book === row.book ? "true" : undefined}
            class={cx(
              "flex w-full items-center gap-2 border-b border-surface-border px-3 py-1.5 text-start text-small hover:bg-surface-secondary",
              current()?.book === row.book && "bg-surface-tertiary font-semibold",
            )}
            onClick={() => setSelected(row.book)}
          >
            <span class="me-auto truncate">
              {CANON.find((book) => book.id === row.book)?.name ?? row.book}
            </span>
            <Badge tone={mark(row).tone} class="max-w-28 truncate">
              {mark(row).label}
            </Badge>
          </button>
        )}
      </For>
    </Show>
  );

  const inactiveCount = (): number =>
    candidates().filter((candidate) => candidate.hints.status === "Inactive").length;

  return (
    <div class="flex min-w-0 flex-col gap-4">
      <Show when={step() === "find"}>
        <Card class="flex flex-col gap-3">
          <PanelHeader
            title={
              intoProject === undefined ? t("Migrate from Writer") : t("Add books from Writer")
            }
            subtitle={
              intoProject === undefined
                ? t(
                    "Assemble one project from BTT Writer's single-book projects. Pick a language below, or a folder or zip of Writer projects; you can combine several.",
                  )
                : t(
                    "Only books this project does not have yet, in its language, are offered. They arrive as one commit.",
                  )
            }
          />
          <div class="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              data-testid="migrate-folder"
              disabled={busy()}
              icon={<FolderOpen aria-hidden="true" />}
              onClick={() => fromLocal("folder")}
            >
              {t("Folder of Writer projects")}
            </Button>
            <Button
              variant="secondary"
              data-testid="migrate-zip"
              disabled={busy()}
              icon={<FileArchive aria-hidden="true" />}
              onClick={() => fromLocal("zip")}
            >
              {t("Zip of Writer projects")}
            </Button>
            <Show when={allRows().length > 0}>
              <Button variant="tertiary" class="ms-auto" onClick={() => setStep("books")}>
                {t("Back to {count} books", { count: allRows().length })}
              </Button>
            </Show>
          </div>
          <Show when={sources().length > 0}>
            <p class="text-small text-on-surface-secondary">{sources().join(" · ")}</p>
          </Show>
        </Card>
        <Show
          when={online}
          fallback={
            <p class="text-small text-on-surface-secondary">
              {t("No WACS server is set for this build: use a folder or a zip.")}
            </p>
          }
        >
          <Show
            when={!busy()}
            fallback={
              <p class="py-8 text-center text-on-surface-tertiary">
                {t("Listing Writer projects…")}
              </p>
            }
          >
            <WriterLanguages initial={intoLanguage} onPick={fromCatalogue} />
          </Show>
        </Show>
      </Show>

      <Show when={step() === "books"}>
        <Card padded={false} class="flex flex-wrap items-center gap-3 px-4 py-3">
          <span class="font-semibold" data-testid="migrate-summary">
            {[
              needsChoice().length > 0
                ? t("{count} books need a choice", { count: needsChoice().length })
                : t("{count} books ready", { count: picked().length - stillOpening() }),
              checking() > 0 ? t("checking {count} more…", { count: checking() }) : "",
            ]
              .filter((part) => part !== "")
              .join(" · ")}
          </span>
          <span class="me-auto truncate text-small text-on-surface-tertiary">
            {sources().join(" · ")}
          </span>
          <Button size="sm" variant="tertiary" onClick={() => setStep("find")}>
            {t("Add more…")}
          </Button>
          <Show when={inactiveCount() > 0}>
            <Button
              size="sm"
              variant="tertiary"
              onClick={() => {
                const on = !showInactive();
                setShowInactive(on);
                if (on) void openPending(candidates(), true);
              }}
            >
              {showInactive()
                ? t("Hide inactive")
                : t("Show inactive ({count})", { count: inactiveCount() })}
            </Button>
          </Show>
          <Show when={needsChoice().length > 0}>
            <Button
              size="sm"
              variant="secondary"
              data-testid="migrate-recommended"
              onClick={useRecommended}
            >
              {t("Use the recommended one for {count} books", { count: needsChoice().length })}
            </Button>
          </Show>
          <Button
            variant="primary"
            data-testid="migrate-next"
            loading={assembling()}
            disabled={!canAssemble() || assembling()}
            onClick={props.into === undefined ? toProject : runAdd}
          >
            {props.into === undefined
              ? t("Next")
              : t("Add {count} books", { count: picked().length })}
          </Button>
        </Card>

        <div class="grid min-h-0 grid-cols-[15rem_minmax(0,1fr)] items-start gap-4">
          <Card padded={false} class="max-h-[75vh] overflow-y-auto">
            <Section testament="ot" title={t("Old Testament")} />
            <Section testament="nt" title={t("New Testament")} />
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

      <Show when={step() === "project" ? form() : undefined}>
        {(held) => (
          <Card class="flex max-w-3xl flex-col gap-4">
            <div class="flex items-center gap-2">
              <Button
                size="sm"
                variant="tertiary"
                icon={<ChevronLeft aria-hidden="true" />}
                onClick={() => setStep("books")}
              >
                {t("Books")}
              </Button>
              <PanelHeader
                title={t("The project")}
                subtitle={t(
                  "{count} books. Nothing is sent: share it through sync when you are ready.",
                  {
                    count: ready().length,
                  },
                )}
              />
            </div>
            <label class="flex flex-col gap-1 text-small">
              {t("Title")}
              <Input
                value={held().title}
                onInput={(event) => setForm({ ...held(), title: event.currentTarget.value })}
              />
            </label>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label class="flex flex-col gap-1 text-small">
                {t("Language")}
                <Input
                  value={held().language.name}
                  onInput={(event) =>
                    setForm({
                      ...held(),
                      language: { ...held().language, name: event.currentTarget.value },
                    })
                  }
                />
              </label>
              <label class="flex flex-col gap-1 text-small">
                {t("Language code")}
                <Input
                  value={held().language.id}
                  onInput={(event) =>
                    setForm({
                      ...held(),
                      language: { ...held().language, id: event.currentTarget.value.trim() },
                    })
                  }
                />
              </label>
              <label class="flex flex-col gap-1 text-small">
                {t("Direction")}
                <Select
                  value={held().language.direction}
                  onChange={(event) =>
                    setForm({
                      ...held(),
                      language: {
                        ...held().language,
                        direction: event.currentTarget.value === "rtl" ? "rtl" : "ltr",
                      },
                    })
                  }
                >
                  <option value="ltr">{t("Left to right")}</option>
                  <option value="rtl">{t("Right to left")}</option>
                </Select>
              </label>
              <label class="flex flex-col gap-1 text-small">
                {t("Resource")}
                <Input
                  value={held().resource}
                  onInput={(event) =>
                    setForm({ ...held(), resource: event.currentTarget.value.trim() })
                  }
                />
              </label>
              <label class="flex flex-col gap-1 text-small">
                {t("Checking level")}
                <Input
                  value={held().checkingLevel}
                  onInput={(event) =>
                    setForm({ ...held(), checkingLevel: event.currentTarget.value })
                  }
                />
              </label>
              <label class="flex flex-col gap-1 text-small">
                {t("Rights")}
                <Input
                  value={held().rights}
                  onInput={(event) => setForm({ ...held(), rights: event.currentTarget.value })}
                />
              </label>
            </div>
            <label class="flex flex-col gap-1 text-small">
              {t("Contributors, one per line")}
              <textarea
                class="min-h-32 rounded-lg border border-surface-border bg-surface-primary p-3 text-small"
                value={held().contributors.join("\n")}
                onInput={(event) =>
                  setForm({
                    ...held(),
                    contributors: event.currentTarget.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter((line) => line !== ""),
                  })
                }
              />
            </label>
            <div class="flex flex-col gap-1 text-small">
              <span>{t("Source texts")}</span>
              <p class="text-on-surface-secondary">
                {held().sources.length === 0
                  ? t("None listed.")
                  : held()
                      .sources.map((ref) =>
                        ref.version === undefined
                          ? `${ref.language}_${ref.resource}`
                          : `${ref.language}_${ref.resource} ${ref.version}`,
                      )
                      .join(", ")}
              </p>
            </div>
            <label class="flex flex-col gap-1 text-small">
              {t("Folder name")}
              <Input value={folder()} onInput={(event) => setFolder(event.currentTarget.value)} />
            </label>
            <div class="flex justify-end">
              <Button
                variant="primary"
                data-testid="migrate-assemble"
                loading={assembling()}
                disabled={assembling()}
                onClick={runAssemble}
              >
                {t("Assemble")}
              </Button>
            </div>
          </Card>
        )}
      </Show>
    </div>
  );
}
