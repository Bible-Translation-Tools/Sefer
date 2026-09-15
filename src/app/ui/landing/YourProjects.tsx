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
import Download from "lucide-solid/icons/download";
import FolderOpen from "lucide-solid/icons/folder-open";
import MoreVertical from "lucide-solid/icons/more-vertical";
import PencilLine from "lucide-solid/icons/pencil-line";
import Trash2 from "lucide-solid/icons/trash-2";
import { For, Show, createEffect, createSignal } from "solid-js";

import { forgetProject, touchProject } from "../../../core/project/projectIndex";
import { t } from "../../i18n";
import { exportProjectZip, renameProject } from "../../projectCommands";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  IconButton,
  Input,
  Popover,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toasts,
} from "../primitives";
import { formatDate, listProjects, type ProjectSummary } from "./summaries";

/** One row of the kebab menu; the same class the toolbar's menu uses. */
const item =
  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-small text-on-surface-primary hover:bg-surface-secondary disabled:cursor-not-allowed disabled:text-on-surface-tertiary";

export function YourProjects(props: { readonly reload: number }) {
  const navigate = useNavigate();
  const shell = useShell();
  const { services } = shell;
  const keys = shellKeys(services.settings);

  const [rows, setRows] = createSignal<readonly ProjectSummary[] | undefined>(undefined, {
    name: "projectSummaries",
  });
  /** Raised by this component's own writes; `props.reload` is the import hub's. */
  const [changed, setChanged] = createSignal(0, { name: "projectsChanged" });
  const [menu, setMenu] = createSignal("", { name: "projectMenu" });
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
  const sorted = (): readonly ProjectSummary[] =>
    [...(rows() ?? [])].sort((left, right) => {
      const l = left.lastOpened ?? "";
      const r = right.lastOpened ?? "";
      if (l !== r) return r.localeCompare(l);
      return left.name.localeCompare(right.name);
    });

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
    void shell.openProject(row.root).then(() => {
      if (shell.project() === undefined) return;
      void navigate({ to: "/project/$id", params: { id: encodeURIComponent(row.root) } });
    });
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
        when={sorted().length > 0}
        fallback={
          <EmptyState
            icon={<FolderOpen size={22} />}
            title={t("No projects yet")}
            description={t("Import one below, or find one to download.")}
          />
        }
      >
        <Card padded={false} class="overflow-hidden">
          <Table data-projects={sorted().length}>
            <TableHead>
              <TableRow>
                <TableHeader>{t("Project")}</TableHeader>
                <TableHeader>{t("Language")}</TableHeader>
                <TableHeader>{t("Books")}</TableHeader>
                <TableHeader>{t("Last opened")}</TableHeader>
                <TableHeader>
                  <span class="sr-only">{t("Actions")}</span>
                </TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              <For each={sorted()}>
                {(row) => (
                  <TableRow data-project={row.root}>
                    <TableCell>
                      <div class="flex items-center gap-2">
                        <strong class="font-medium text-on-surface-primary">{row.name}</strong>
                        <Show when={row.fixture}>
                          <Badge tone="brand" size="sm">
                            {t("fixture")}
                          </Badge>
                        </Show>
                      </div>
                      <code class="font-mono text-smallest text-on-surface-tertiary">
                        {row.root}
                      </code>
                    </TableCell>
                    <TableCell class="text-on-surface-secondary">
                      {/* A project whose metadata declares no language still has
                          an identity on disk, and the folder id is it — more use
                          than a dash, and muted so nobody reads it as a tag. */}
                      <Show
                        when={row.language !== ""}
                        fallback={
                          <span
                            class="text-on-surface-tertiary"
                            title={t("No language declared in this project's metadata.")}
                          >
                            {row.folder}
                          </span>
                        }
                      >
                        {row.language}
                      </Show>
                    </TableCell>
                    <TableCell class="tabular-nums text-on-surface-secondary">
                      {row.books}
                    </TableCell>
                    <TableCell class="text-on-surface-secondary">
                      {formatDate(row.lastOpened) || "—"}
                    </TableCell>
                    <TableCell class="text-end">
                      <div class="flex items-center justify-end gap-2">
                        <Button size="sm" variant="primary" onClick={() => open(row)}>
                          {t("Open")}
                        </Button>
                        {/* The fixture is an in-memory copy of the seeded
                            folder: there is nothing on disk to rename, zip or
                            delete, so it gets no menu rather than a menu of
                            things that would fail. */}
                        <Show when={!row.fixture}>
                          <Popover
                            label={t("Project actions")}
                            side="bottom"
                            align="end"
                            class="w-52 p-1"
                            open={menu() === row.root}
                            onOpenChange={(open) => setMenu(open ? row.root : "")}
                            trigger={
                              <IconButton
                                size="sm"
                                label={t("More")}
                                icon={<MoreVertical size={16} />}
                              />
                            }
                          >
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
                          </Popover>
                        </Show>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </For>
            </TableBody>
          </Table>
        </Card>
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
