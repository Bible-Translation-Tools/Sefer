/**
 * "Your projects": every project root this host can actually open, as a table.
 *
 * The columns are the four things that tell one project from another at a
 * glance — its name, its language, how many books it holds, and when it was
 * last opened here. All four come out of ONE file read:
 * `<projectsRoot>/.sefer/projects.json`, the index
 * (`src/core/project/projectIndex.ts`), repaired against the folder names that
 * are actually there. A project is described from disk once, when it first
 * appears; after that the list is the index's word for it.
 *
 * Opening writes `lastOpened` — to the index, and to `shell.recentProjects`,
 * which the sidebar reads — BEFORE it navigates. A project that failed to open
 * is still a project you tried to open, and the ordering people rely on is
 * "what I was last working on", not "what last succeeded".
 *
 * The kebab is the rest of a project's life: rename it, save a copy of it,
 * delete it. All three are `ProjectAdmin`, and all three end in the same place
 * the import does — a write to the index and a re-read of this list.
 */

import { useNavigate, useSearch } from "@tanstack/solid-router";
import { Effect, FileSystem, Result } from "effect";
import ArrowRight from "lucide-solid/icons/arrow-right";
import Download from "lucide-solid/icons/download";
import FolderOpen from "lucide-solid/icons/folder-open";
import MoreVertical from "lucide-solid/icons/more-vertical";
import PencilLine from "lucide-solid/icons/pencil-line";
import Share2 from "lucide-solid/icons/share-2";
import Trash2 from "lucide-solid/icons/trash-2";
import { For, Show, createEffect, createSignal } from "solid-js";

import { forgetProject, touchProject } from "#core/project/projectIndex";

import { t } from "../../i18n";
import { exportProjectZip, renameProject } from "../../projectCommands";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import { Badge, Button, Card, Dialog, IconButton, Input, Popover, toasts } from "../primitives";
import { flyCard, type PendingDownload } from "./downloads";
import { listProjects, type ProjectSummary } from "./summaries";

/** One row of the kebab menu; the same class the toolbar's menu uses. */
const item =
  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-small text-on-surface-primary hover:bg-surface-secondary disabled:cursor-not-allowed disabled:text-on-surface-tertiary";

export function YourProjects(props: {
  readonly reload: number;
  /** Downloads in flight, drawn first until the project each becomes is listed. */
  readonly downloads: readonly PendingDownload[];
  /** Where the newest download's row was, to fly its card up from. */
  readonly flyFrom: DOMRect | undefined;
  readonly onDismiss: (id: string) => void;
}) {
  const shell = useShell();
  const { services } = shell;
  const keys = shellKeys(services.settings);

  const [rows, setRows] = createSignal<readonly ProjectSummary[] | undefined>(undefined, {
    name: "projectSummaries",
  });
  /** Raised by this component's own writes; `props.reload` is the import hub's. */
  const [changed, setChanged] = createSignal(0, { name: "projectsChanged" });
  const [menu, setMenu] = createSignal("", { name: "projectMenu" });
  const navigate = useNavigate();

  /** The card strip, and how many cards sit past its right edge. */
  const [strip, setStrip] = createSignal<HTMLUListElement>();
  const [hidden, setHidden] = createSignal(0, { name: "projectsHidden" });
  const measure = (): void => {
    const box = strip();
    if (box === undefined) return;
    const edge = box.getBoundingClientRect().right;
    let past = 0;
    for (const card of box.children) if (card.getBoundingClientRect().right > edge + 1) past += 1;
    setHidden(past);
  };
  // Re-count when the strip resizes or its cards change. The cleanup is the
  // effect's RETURN value — Solid 2 runs an `onCleanup` here unowned.
  createEffect(
    () => ({ box: strip(), count: rows()?.length, pending: pending().length }),
    ({ box }) => {
      if (box === undefined) return;
      const observer = new ResizeObserver(measure);
      observer.observe(box);
      measure();
      return () => observer.disconnect();
    },
  );

  /** Sharing is the cloud screen of that project; opening it gets there. */
  const share = (row: ProjectSummary): void => {
    void navigate({
      to: "/project/$slug/cloud",
      params: { slug: shell.slugFor(row.root) },
      search: {},
    });
  };
  const [renaming, setRenaming] = createSignal<ProjectSummary | undefined>(undefined, {
    name: "renamingProject",
  });
  const [newName, setNewName] = createSignal("", { name: "newProjectName" });
  const [deleting, setDeleting] = createSignal<ProjectSummary | undefined>(undefined, {
    name: "deletingProject",
  });
  const [busy, setBusy] = createSignal(false, { name: "projectActionBusy" });

  /**
   * One pass per tick. Two tickers, one subscription: an import raises
   * `props.reload` and this list re-reads itself without the list ever knowing
   * what an import is; a rename or a delete raises `changed` for the same
   * reason from the inside.
   */
  createEffect(
    () => [props.reload, changed()],
    () => {
      const recent = services.settings.get(keys.recentProjects);
      void services
        .run(listProjects(services.projectsRoot, services.fixtureProject, recent))
        .then(setRows);
    },
  );

  const refresh = (): void => {
    setChanged((held) => held + 1);
  };

  // `project.rename` (registered by the shell) lands here with the root in
  // the URL; the dialog opens once the rows are known.
  // SAFETY: `strict: false` gives the union of every route's search; only
  // `rename` is read, and a missing or non-string value is treated as absent.
  const search = useSearch({ strict: false }) as () => { readonly rename?: unknown };
  createEffect(
    () => ({ target: search().rename, held: rows() }),
    ({ target, held }) => {
      if (typeof target !== "string" || held === undefined) return;
      const row = held.find((candidate) => candidate.root === target);
      if (row === undefined) return;
      setNewName(row.name);
      setRenaming(row);
    },
  );

  /** Most recently opened first; never-opened projects fall to the bottom. */
  /** The downloads still to draw: a listed root means the real card is here. */
  const pending = (): readonly PendingDownload[] => {
    const listed = new Set((rows() ?? []).map((row) => row.root));
    return props.downloads.filter((download) => !listed.has(download.root));
  };

  /** Each download flies up once, when its card first mounts. */
  const flown = new Set<string>();
  const arrive = (card: HTMLElement, download: PendingDownload): void => {
    if (flown.has(download.id)) return;
    flown.add(download.id);
    const from = props.flyFrom;
    requestAnimationFrame(() => {
      strip()?.scrollTo({ left: 0 });
      card.scrollIntoView({ block: "nearest" });
      if (from !== undefined) flyCard(from, card, download.language);
      card.animate(
        [
          { opacity: 0, transform: "scale(0.96)" },
          { opacity: 1, transform: "none" },
        ],
        {
          duration: 300,
          delay: 350,
          easing: "ease-out",
          fill: "backwards",
        },
      );
      measure();
    });
  };

  // Downloaded this session first, newest first, so a finished download's
  // card lands where its downloading card was; then most recently opened.
  const sorted = (): readonly ProjectSummary[] => {
    const fresh = props.downloads.map((download) => download.root);
    const rank = (row: ProjectSummary): number => {
      const at = fresh.indexOf(row.root);
      return at === -1 ? fresh.length : at;
    };
    return [...(rows() ?? [])].sort((left, right) => {
      if (rank(left) !== rank(right)) return rank(left) - rank(right);
      const l = left.lastOpened ?? "";
      const r = right.lastOpened ?? "";
      if (l !== r) return r.localeCompare(l);
      return left.name.localeCompare(right.name);
    });
  };

  const open = (row: ProjectSummary): void => {
    const stamp = new Date(Date.now()).toISOString();
    const recent = services.settings.get(keys.recentProjects);
    void services.run(
      Effect.gen(function* () {
        yield* Effect.ignore(
          services.settings.set(keys.recentProjects, { ...recent, [row.root]: stamp }),
        );
        // The index's own column. A row that is not there yet (the fixture) is
        // left alone — `touchProject` does not invent one.
        const fileSystem = yield* FileSystem.FileSystem;
        yield* Effect.ignore(touchProject(fileSystem, services.projectsRoot, row.root, stamp));
      }),
    );
    // The route still does the opening (`project/$slug` is the one place a
    // project is opened); the shell then lands the reader in Matthew 1.
    shell.openProjectAtStart(row.root);
  };

  /** Saves a copy: the project as a zip, handed to the browser's downloads. */
  const exportZip = (row: ProjectSummary): void => {
    setMenu("");
    void exportProjectZip(services, row.root);
  };

  const rename = (): void => {
    const row = renaming();
    const name = newName().trim();
    if (row === undefined || name === "" || busy()) return;
    setBusy(true);
    void renameProject(services, row.root, name, row.lastOpened).then((done) => {
      setBusy(false);
      setRenaming(undefined);
      if (done) refresh();
    });
  };

  const remove = (): void => {
    // A deliberate snapshot: the dialog names one project, and that is the one
    // being deleted however the signal moves while the write runs.
    const staticRow = deleting();
    if (staticRow === undefined || busy()) return;
    const row = staticRow;
    setBusy(true);
    void services
      .run(
        Effect.result(
          Effect.gen(function* () {
            // `delete` takes a confirm port so there is no silent path. THIS
            // dialog is the confirmation — the person has already answered the
            // question the port exists to ask.
            yield* services.admin.delete(row.root, () => Effect.succeed(true));
            const fileSystem = yield* FileSystem.FileSystem;
            yield* Effect.ignore(forgetProject(fileSystem, services.projectsRoot, row.root));
            const recent = { ...services.settings.get(keys.recentProjects) };
            if (recent[row.root] !== undefined) {
              delete recent[row.root];
              yield* Effect.ignore(services.settings.set(keys.recentProjects, recent));
            }
          }),
        ),
      )
      .then((done) => {
        setBusy(false);
        setDeleting(undefined);
        if (Result.isFailure(done)) {
          toasts.error({
            title: t("Could not delete"),
            message: done.failure.description ?? done.failure.reason,
          });
          return;
        }
        toasts.info({ title: t("Deleted {name}", { name: row.name }) });
        refresh();
      });
  };

  return (
    <Show
      when={rows()}
      fallback={<p class="text-small text-on-surface-tertiary">{t("Reading…")}</p>}
    >
      <Show
        when={sorted().length > 0 || pending().length > 0}
        fallback={
          <p data-testid="projects-empty" class="text-small text-on-surface-secondary">
            {t(
              "To load a project into Sefer, download your translated work from WACS below. Then it will appear here, and you can open it.",
            )}
          </p>
        }
      >
        {/* ONE row of cards, scrolled sideways. The "+N more" pill counts the
            cards past the right edge and scrolls to them; it goes when there
            is nothing further to see. */}
        <div class="relative">
          <ul
            ref={setStrip}
            data-projects={sorted().length}
            class="scrollbar-subtle flex snap-x gap-4 overflow-x-auto pb-2"
            onScroll={measure}
          >
            <For each={pending()}>
              {(download) => (
                <li
                  ref={(card) => arrive(card, download)}
                  data-downloading={download.id}
                  class="shrink-0 snap-start"
                >
                  <Card
                    class="flex w-64 flex-col gap-1"
                    aria-busy={download.state === "downloading" ? "true" : "false"}
                  >
                    <h3 class="truncate text-h4 font-semibold text-on-surface-primary">
                      {download.language}
                    </h3>
                    <code class="truncate font-mono text-smallest text-on-surface-tertiary">
                      {download.code}
                    </code>
                    <div class="mt-auto flex flex-col gap-1.5 pt-4">
                      <div class="flex items-baseline gap-2 text-smallest">
                        <span
                          class={
                            download.state === "failed"
                              ? "min-w-0 flex-1 truncate text-on-surface-error"
                              : "min-w-0 flex-1 truncate text-on-surface-secondary"
                          }
                          title={download.status}
                        >
                          {download.state === "failed"
                            ? t("Download failed")
                            : t("Downloading… {status}", { status: download.status })}
                        </span>
                        <Show
                          when={download.state === "downloading" && download.percent !== undefined}
                        >
                          <span class="shrink-0 tabular-nums font-medium text-on-surface-primary">
                            {t("{percent}%", { percent: download.percent ?? 0 })}
                          </span>
                        </Show>
                      </div>
                      <Show
                        when={download.state === "downloading"}
                        fallback={
                          <Button size="sm" onClick={() => props.onDismiss(download.id)}>
                            {t("Dismiss")}
                          </Button>
                        }
                      >
                        {/* Indeterminate until the server says how much there
                            is: a bar pinned at 0% reads as stuck. */}
                        <div
                          role="progressbar"
                          aria-label={t("Downloading {name}", { name: download.language })}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={download.percent}
                          class="h-1.5 overflow-hidden rounded-full bg-surface-tertiary"
                        >
                          <div
                            class={
                              download.percent === undefined
                                ? "h-full w-1/3 animate-pulse rounded-full bg-brand"
                                : "h-full rounded-full bg-brand transition-[width] duration-300"
                            }
                            style={
                              download.percent === undefined
                                ? undefined
                                : { width: `${String(download.percent)}%` }
                            }
                          />
                        </div>
                      </Show>
                    </div>
                  </Card>
                </li>
              )}
            </For>
            <For each={sorted()}>
              {(row) => (
                <li data-project={row.root} class="shrink-0 snap-start">
                  <Card class="flex w-64 flex-col gap-1" title={row.name}>
                    <div class="flex items-start gap-2">
                      <h3 class="min-w-0 flex-1 truncate text-h4 font-semibold text-on-surface-primary">
                        {row.language || row.name}
                      </h3>
                      <Show when={row.fixture}>
                        <Badge tone="brand" size="sm">
                          {t("fixture")}
                        </Badge>
                      </Show>
                    </div>
                    {/* The code, or the folder when the metadata declares no
                        language — muted, so it never reads as one. */}
                    <code class="truncate font-mono text-smallest text-on-surface-tertiary">
                      {row.languageTag || row.folder}
                    </code>

                    {/* `mt-auto` keeps the button on the card's floor when a
                        neighbour in the row is taller; the 16px above it is
                        the whole of the space otherwise. */}
                    <div class="mt-auto flex items-center gap-2 pt-4">
                      <Button
                        variant="secondary"
                        class="h-auto! flex-1 justify-between rounded-2xl! p-[15px]! text-body! leading-6! text-brand!"
                        onClick={() => open(row)}
                      >
                        {t("Open Project")}
                        <ArrowRight size={16} aria-hidden="true" />
                      </Button>
                      <Popover
                        label={t("Project actions")}
                        side="bottom"
                        align="end"
                        class="w-52 p-1"
                        open={menu() === row.root}
                        onOpenChange={(open) => setMenu(open ? row.root : "")}
                        trigger={
                          <IconButton
                            size="md"
                            // A 56px touch target: a 24px icon, 16px all round
                            // (15px padding inside the 1px border), the same
                            // height and radius as Open Project beside it.
                            class="size-14! rounded-2xl! p-[15px]"
                            label={t("More actions for {name}", { name: row.name })}
                            icon={<MoreVertical size={24} />}
                          />
                        }
                      >
                        <button
                          type="button"
                          class={item}
                          onClick={() => {
                            setMenu("");
                            open(row);
                          }}
                        >
                          <FolderOpen size={14} aria-hidden="true" />
                          {t("Open")}
                        </button>
                        {/* The fixture is an in-memory copy of the seeded
                            folder: there is nothing on disk to rename, zip,
                            share or delete, so it offers Open and nothing
                            that would fail. */}
                        <Show when={!row.fixture}>
                          <button
                            type="button"
                            class={item}
                            onClick={() => {
                              setMenu("");
                              share(row);
                            }}
                          >
                            <Share2 size={14} aria-hidden="true" />
                            {t("Share…")}
                          </button>
                          <button
                            type="button"
                            class={item}
                            onClick={() => {
                              setMenu("");
                              setNewName(row.name);
                              setRenaming(row);
                            }}
                          >
                            <PencilLine size={14} aria-hidden="true" />
                            {t("Rename…")}
                          </button>
                          <button type="button" class={item} onClick={() => exportZip(row)}>
                            <Download size={14} aria-hidden="true" />
                            {t("Export as zip")}
                          </button>
                          <button
                            type="button"
                            class={item}
                            onClick={() => {
                              setMenu("");
                              setDeleting(row);
                            }}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                            {t("Delete…")}
                          </button>
                        </Show>
                      </Popover>
                    </div>
                  </Card>
                </li>
              )}
            </For>
          </ul>
          <Show when={hidden() > 0}>
            <Button
              size="sm"
              data-testid="projects-more"
              class="absolute end-0 top-1/2 -translate-y-1/2 shadow-medium"
              onClick={() => strip()?.scrollBy({ left: strip()!.clientWidth, behavior: "smooth" })}
            >
              {t("+{count} more", { count: hidden() })}
            </Button>
          </Show>
        </div>
      </Show>

      <Dialog
        open={renaming() !== undefined}
        onOpenChange={(open) => {
          if (!open) setRenaming(undefined);
        }}
        title={t("Rename project")}
        description={t(
          "This is the name Sefer and other Burrito readers show. The folder on disk keeps its own name.",
        )}
        footer={
          <>
            <Button onClick={() => setRenaming(undefined)}>{t("Cancel")}</Button>
            <Button
              variant="primary"
              loading={busy()}
              disabled={newName().trim() === ""}
              onClick={rename}
            >
              {t("Rename")}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            rename();
          }}
        >
          <Input
            value={newName()}
            aria-label={t("Project name")}
            onInput={(event) => setNewName(event.currentTarget.value)}
          />
        </form>
      </Dialog>

      <Dialog
        open={deleting() !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        title={t("Delete project")}
        description={t("The folder and everything in it is removed. This cannot be undone.")}
        footer={
          <>
            <Button onClick={() => setDeleting(undefined)}>{t("Cancel")}</Button>
            <Button variant="danger" loading={busy()} onClick={remove}>
              {t("Delete")}
            </Button>
          </>
        }
      >
        <p class="break-words">
          <code class="font-mono text-smallest text-on-surface-tertiary">{deleting()?.root}</code>
        </p>
      </Dialog>
    </Show>
  );
}
