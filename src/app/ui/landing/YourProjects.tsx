import { useNavigate, useSearch } from "@tanstack/solid-router";
import { Effect, FileSystem, Result } from "effect";
import ArrowRight from "lucide-solid/icons/arrow-right";
import Download from "lucide-solid/icons/download";
import FolderOpen from "lucide-solid/icons/folder-open";
import MoreVertical from "lucide-solid/icons/more-vertical";
import PencilLine from "lucide-solid/icons/pencil-line";
import Share2 from "lucide-solid/icons/share-2";
import Trash2 from "lucide-solid/icons/trash-2";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import { touchProject } from "#core/project/projectIndex";

import { t } from "../../i18n";
import { exportProjectZip, renameProject } from "../../projectCommands";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import {
  Badge,
  Button,
  Card,
  Dialog,
  IconButton,
  Input,
  Menu,
  MenuItem,
  toasts,
} from "../primitives";
import { flyCard, type PendingDownload } from "./downloads";
import {
  forgetRemembered,
  listProjects,
  projectIndexRevision,
  type ProjectSummary,
} from "./summaries";

export function YourProjects(props: {
  readonly downloads: readonly PendingDownload[];
  readonly flyFrom: DOMRect | undefined;
  readonly onDismiss: (id: string) => void;
}) {
  const shell = useShell();
  const { services } = shell;
  const keys = shellKeys(services.settings);

  const [rows, setRows] = createSignal<readonly ProjectSummary[] | undefined>(undefined, {
    name: "projectSummaries",
  });
  const navigate = useNavigate();

  const [strip, setStrip] = createSignal<HTMLUListElement>();
  const [hidden, setHidden] = createSignal(0, { name: "projectsHidden" });
  const share = (row: ProjectSummary): void => {
    void navigate({ to: "/project/$slug", params: { slug: shell.slugFor(row.root) } });
  };
  const [renaming, setRenaming] = createSignal<ProjectSummary | undefined>(undefined, {
    name: "renamingProject",
  });
  const [newName, setNewName] = createSignal("", { name: "newProjectName" });
  const lookalike = (row: ProjectSummary): string =>
    `${row.name}\u0000${row.language}\u0000${row.languageTag}`;
  const twins = createMemo(
    (): ReadonlySet<string> => {
      const seen = new Map<string, number>();
      for (const row of rows() ?? []) seen.set(lookalike(row), (seen.get(lookalike(row)) ?? 0) + 1);
      return new Set([...seen].filter(([, count]) => count > 1).map(([key]) => key));
    },
    { name: "projectTwins" },
  );

  const [deleting, setDeleting] = createSignal<ProjectSummary | undefined>(undefined, {
    name: "deletingProject",
  });
  const [busy, setBusy] = createSignal(false, { name: "projectActionBusy" });

  // Returned, not onCleanup: a Solid 2 effect's callback has no owner (NO_OWNER_CLEANUP).
  createEffect(
    () => projectIndexRevision(),
    () => {
      const recent = services.settings.get(keys.recentProjects);
      void services
        .run(listProjects(services.projectsRoot, services.fixtureProject, recent))
        .then(setRows);
    },
  );

  // SAFETY: `strict: false` gives the union of every route's search; only `rename` is read, and a missing or non-string value is treated as absent.
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

  const pending = (): readonly PendingDownload[] => {
    const listed = new Set((rows() ?? []).map((row) => row.root));
    return props.downloads.filter((download) => !listed.has(download.root));
  };

  createEffect(
    () => ({ box: strip(), count: rows()?.length, pending: pending().length }),
    ({ box }) => {
      if (box === undefined) return;
      const past = new Set<Element>();
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const beyond =
              entry.intersectionRatio < 0.99 &&
              entry.boundingClientRect.left > (entry.rootBounds?.left ?? 0);
            if (beyond) past.add(entry.target);
            else past.delete(entry.target);
          }
          setHidden(past.size);
        },
        { root: box, threshold: [0.99] },
      );
      for (const card of box.children) observer.observe(card);
      return () => observer.disconnect();
    },
  );

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
    });
  };

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
        const fileSystem = yield* FileSystem.FileSystem;
        yield* Effect.ignore(touchProject(fileSystem, services.projectsRoot, row.root, stamp));
      }),
    );
    shell.openProjectAtStart(row.root);
  };

  const exportZip = (row: ProjectSummary): void => {
    void exportProjectZip(services, row.root);
  };

  const rename = (): void => {
    const row = renaming();
    const name = newName().trim();
    if (row === undefined || name === "" || busy()) return;
    setBusy(true);
    void renameProject(services, row.root, name, row.lastOpened).then(() => {
      setBusy(false);
      setRenaming(undefined);
    });
  };

  const remove = (): void => {
    const staticRow = deleting();
    if (staticRow === undefined || busy()) return;
    const row = staticRow;
    setBusy(true);
    void services
      .run(
        Effect.result(
          Effect.gen(function* () {
            yield* services.admin.delete(row.root, () => Effect.succeed(true));
            yield* forgetRemembered(services.projectsRoot, row.root);
            const recent = { ...services.settings.get(keys.recentProjects) };
            if (recent[row.root] !== undefined) {
              delete recent[row.root];
              yield* Effect.ignore(services.settings.set(keys.recentProjects, recent));
            }
            const slugs = services.settings.get(keys.projectSlugs);
            const kept = Object.fromEntries(
              Object.entries(slugs).filter(([, root]) => root !== row.root),
            );
            if (Object.keys(kept).length !== Object.keys(slugs).length)
              yield* Effect.ignore(services.settings.set(keys.projectSlugs, kept));
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
        <div class="relative">
          <ul
            ref={setStrip}
            data-projects={sorted().length}
            class="scrollbar-subtle flex snap-x gap-4 overflow-x-auto pb-2"
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

                    <code
                      class="truncate font-mono text-smallest text-on-surface-tertiary"
                      data-project-folder={row.folder}
                    >
                      {row.languageTag === ""
                        ? row.folder
                        : twins().has(lookalike(row))
                          ? `${row.languageTag} · ${row.folder}`
                          : row.languageTag}
                    </code>

                    <div class="mt-auto flex items-center gap-2 pt-4">
                      <Button
                        variant="accent"
                        class="flex-1 justify-between"
                        onClick={() => open(row)}
                      >
                        {t("Open Project")}
                        <ArrowRight aria-hidden="true" />
                      </Button>
                      <Menu
                        label={t("Project actions")}
                        side="bottom"
                        align="end"
                        class="w-52"
                        trigger={
                          <IconButton
                            label={t("More actions for {name}", { name: row.name })}
                            icon={<MoreVertical />}
                          />
                        }
                      >
                        <MenuItem
                          icon={<FolderOpen aria-hidden="true" />}
                          onSelect={() => open(row)}
                        >
                          {t("Open")}
                        </MenuItem>

                        <Show when={!row.fixture}>
                          <MenuItem
                            icon={<Share2 aria-hidden="true" />}
                            onSelect={() => share(row)}
                          >
                            {t("Share…")}
                          </MenuItem>
                          <MenuItem
                            icon={<PencilLine aria-hidden="true" />}
                            onSelect={() => {
                              setNewName(row.name);
                              setRenaming(row);
                            }}
                          >
                            {t("Rename…")}
                          </MenuItem>
                          <MenuItem
                            icon={<Download aria-hidden="true" />}
                            onSelect={() => exportZip(row)}
                          >
                            {t("Export as zip")}
                          </MenuItem>
                          <MenuItem
                            icon={<Trash2 aria-hidden="true" />}
                            onSelect={() => setDeleting(row)}
                          >
                            {t("Delete…")}
                          </MenuItem>
                        </Show>
                      </Menu>
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
              onClick={() => {
                const box = strip();
                box?.scrollBy({ left: box.clientWidth, behavior: "smooth" });
              }}
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
