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
type Shell = ReturnType<typeof useShell>;
type Keys = ReturnType<typeof shellKeys>;

const lookalike = (row: ProjectSummary): string =>
  `${row.name}\u0000${row.language}\u0000${row.languageTag}`;

const sortProjects = (
  rows: readonly ProjectSummary[],
  downloads: readonly PendingDownload[],
): readonly ProjectSummary[] => {
  const fresh = downloads.map((download) => download.root);
  const rank = (row: ProjectSummary): number => {
    const at = fresh.indexOf(row.root);
    return at === -1 ? fresh.length : at;
  };
  return [...rows].sort((left, right) => {
    if (rank(left) !== rank(right)) return rank(left) - rank(right);
    const leftOpened = left.lastOpened ?? "";
    const rightOpened = right.lastOpened ?? "";
    if (leftOpened !== rightOpened) return rightOpened.localeCompare(leftOpened);
    return left.name.localeCompare(right.name);
  });
};

const createProjectList = (shell: Shell, keys: Keys) => {
  const { services } = shell;
  const [rows, setRows] = createSignal<readonly ProjectSummary[] | undefined>(undefined, {
    name: "projectSummaries",
  });
  const twins = createMemo(
    (): ReadonlySet<string> => {
      const seen = new Map<string, number>();
      for (const row of rows() ?? []) seen.set(lookalike(row), (seen.get(lookalike(row)) ?? 0) + 1);
      return new Set([...seen].filter(([, count]) => count > 1).map(([key]) => key));
    },
    { name: "projectTwins" },
  );
  const folderLabel = (row: ProjectSummary): string => {
    if (row.languageTag === "") return row.folder;
    return twins().has(lookalike(row)) ? `${row.languageTag} · ${row.folder}` : row.languageTag;
  };

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
  return { rows, folderLabel };
};

const rememberOpened = (services: Shell["services"], keys: Keys, row: ProjectSummary): void => {
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
};

const deleteProject = (services: Shell["services"], keys: Keys, row: ProjectSummary) =>
  services.run(
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
  );

const createRowActions = (shell: Shell, keys: Keys) => {
  const { services } = shell;
  const navigate = useNavigate();
  return {
    share: (row: ProjectSummary): void => {
      void navigate({ to: "/project/$slug", params: { slug: shell.slugFor(row.root) } });
    },
    open: (row: ProjectSummary): void => {
      rememberOpened(services, keys, row);
      shell.openProjectAtStart(row.root);
    },
    exportZip: (row: ProjectSummary): void => {
      void exportProjectZip(services, row.root);
    },
  };
};

const removeProject = (
  services: Shell["services"],
  keys: Keys,
  row: ProjectSummary,
  settled: () => void,
): void => {
  void deleteProject(services, keys, row).then((done) => {
    settled();
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

const watchRenameRequest = (
  rows: () => readonly ProjectSummary[] | undefined,
  startRename: (row: ProjectSummary) => void,
): void => {
  const search = useSearch({ from: "/_app/projects" });
  createEffect(
    () => ({ target: search().rename, held: rows() }),
    ({ target, held }) => {
      if (target === undefined || held === undefined) return;
      const row = held.find((candidate) => candidate.root === target);
      if (row === undefined) return;
      startRename(row);
    },
  );
};

const createProjectActions = (
  shell: Shell,
  keys: Keys,
  rows: () => readonly ProjectSummary[] | undefined,
) => {
  const { services } = shell;
  const [renaming, setRenaming] = createSignal<ProjectSummary | undefined>(undefined, {
    name: "renamingProject",
  });
  const [newName, setNewName] = createSignal("", { name: "newProjectName" });
  const [deleting, setDeleting] = createSignal<ProjectSummary | undefined>(undefined, {
    name: "deletingProject",
  });
  const [busy, setBusy] = createSignal(false, { name: "projectActionBusy" });

  const startRename = (row: ProjectSummary): void => {
    setNewName(row.name);
    setRenaming(row);
  };
  watchRenameRequest(rows, startRename);

  return {
    renaming,
    newName,
    setNewName,
    deleting,
    busy,
    startRename,
    cancelRename: (): void => setRenaming(undefined),
    startDelete: (row: ProjectSummary): void => {
      setDeleting(row);
    },
    cancelDelete: (): void => setDeleting(undefined),
    rename: (): void => {
      const row = renaming();
      const name = newName().trim();
      if (row === undefined || name === "" || busy()) return;
      setBusy(true);
      void renameProject(services, row.root, name, row.lastOpened).then(() => {
        setBusy(false);
        setRenaming(undefined);
      });
    },
    remove: (): void => {
      const staticRow = deleting();
      if (staticRow === undefined || busy()) return;
      const row = staticRow;
      setBusy(true);
      removeProject(services, keys, row, () => {
        setBusy(false);
        setDeleting(undefined);
      });
    },
  };
};

const flyIn = (card: HTMLElement, from: DOMRect | undefined, download: PendingDownload): void => {
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
};

const createStrip = (
  props: { readonly downloads: readonly PendingDownload[]; readonly flyFrom: DOMRect | undefined },
  rows: () => readonly ProjectSummary[] | undefined,
) => {
  const pending = (): readonly PendingDownload[] => {
    const listed = new Set((rows() ?? []).map((row) => row.root));
    return props.downloads.filter((download) => !listed.has(download.root));
  };

  const flown = new Set<string>();
  const arrive = (card: HTMLElement, download: PendingDownload): void => {
    if (flown.has(download.id)) return;
    flown.add(download.id);
    const from = props.flyFrom;
    requestAnimationFrame(() => {
      flyIn(card, from, download);
    });
  };

  return { pending, arrive };
};

const DownloadLine = (props: { readonly download: PendingDownload }) => (
  <div class="flex items-baseline gap-2 text-smallest">
    <span
      class={
        props.download.state === "failed"
          ? "min-w-0 flex-1 truncate text-on-surface-error"
          : "min-w-0 flex-1 truncate text-on-surface-secondary"
      }
      title={props.download.status}
    >
      {props.download.state === "failed"
        ? t("Download failed")
        : t("Downloading… {status}", { status: props.download.status })}
    </span>
    <Show when={props.download.state === "downloading" && props.download.percent !== undefined}>
      <span class="shrink-0 tabular-nums font-medium text-on-surface-primary">
        {t("{percent}%", { percent: props.download.percent ?? 0 })}
      </span>
    </Show>
  </div>
);

const DownloadBar = (props: { readonly download: PendingDownload }) => (
  <div
    role="progressbar"
    aria-label={t("Downloading {name}", { name: props.download.language })}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={props.download.percent}
    class="h-1.5 overflow-hidden rounded-full bg-surface-tertiary"
  >
    <div
      class={
        props.download.percent === undefined
          ? "h-full w-1/3 animate-pulse rounded-full bg-brand"
          : "h-full rounded-full bg-brand transition-[width] duration-300"
      }
      style={
        props.download.percent === undefined
          ? undefined
          : { width: `${String(props.download.percent)}%` }
      }
    />
  </div>
);

const DownloadCard = (props: {
  readonly download: PendingDownload;
  readonly arrive: (card: HTMLElement, download: PendingDownload) => void;
  readonly onDismiss: (id: string) => void;
}) => (
  <li
    ref={(card) => props.arrive(card, props.download)}
    data-downloading={props.download.id}
    class="shrink-0"
  >
    <Card
      class="flex flex-col gap-1"
      aria-busy={props.download.state === "downloading" ? "true" : "false"}
    >
      <h3 class="truncate text-h4 font-semibold text-on-surface-primary">
        {props.download.language}
      </h3>
      <code class="truncate font-mono text-smallest text-on-surface-tertiary">
        {props.download.code}
      </code>
      <div class="mt-auto flex flex-col gap-1.5 pt-4">
        <DownloadLine download={props.download} />
        <Show
          when={props.download.state === "downloading"}
          fallback={
            <Button size="sm" onClick={() => props.onDismiss(props.download.id)}>
              {t("Dismiss")}
            </Button>
          }
        >
          <DownloadBar download={props.download} />
        </Show>
      </div>
    </Card>
  </li>
);

const ProjectMenu = (props: {
  readonly row: ProjectSummary;
  readonly onOpen: () => void;
  readonly onShare: () => void;
  readonly onRename: () => void;
  readonly onExport: () => void;
  readonly onDelete: () => void;
}) => (
  <Menu
    label={t("Project actions")}
    side="bottom"
    align="end"
    class="w-52"
    trigger={
      <IconButton
        label={t("More actions for {name}", { name: props.row.name })}
        icon={<MoreVertical />}
      />
    }
  >
    <MenuItem icon={<FolderOpen aria-hidden="true" />} onSelect={props.onOpen}>
      {t("Open")}
    </MenuItem>

    <Show when={!props.row.fixture}>
      <MenuItem icon={<Share2 aria-hidden="true" />} onSelect={props.onShare}>
        {t("Share…")}
      </MenuItem>
      <MenuItem icon={<PencilLine aria-hidden="true" />} onSelect={props.onRename}>
        {t("Rename…")}
      </MenuItem>
      <MenuItem icon={<Download aria-hidden="true" />} onSelect={props.onExport}>
        {t("Export as zip")}
      </MenuItem>
      <MenuItem icon={<Trash2 aria-hidden="true" />} onSelect={props.onDelete}>
        {t("Delete…")}
      </MenuItem>
    </Show>
  </Menu>
);

const ProjectCard = (props: {
  readonly row: ProjectSummary;
  readonly folder: string;
  readonly onOpen: () => void;
  readonly onShare: () => void;
  readonly onRename: () => void;
  readonly onExport: () => void;
  readonly onDelete: () => void;
}) => (
  <li data-project={props.row.root} class="shrink-0">
    <Card class="flex flex-col gap-1" title={props.row.name}>
      <div class="flex items-start gap-2">
        <h3 class="min-w-0 flex-1 truncate text-h4 font-semibold text-on-surface-primary">
          {props.row.language || props.row.name}
        </h3>
        <Show when={props.row.fixture}>
          <Badge tone="brand" size="sm">
            {t("fixture")}
          </Badge>
        </Show>
      </div>

      <code
        class="truncate font-mono text-smallest text-on-surface-tertiary"
        data-project-folder={props.row.folder}
      >
        {props.folder}
      </code>

      <div class="mt-auto flex items-center gap-2 pt-4">
        <Button variant="accent" class="flex-1 justify-between" onClick={props.onOpen}>
          {t("Open Project")}
          <ArrowRight aria-hidden="true" />
        </Button>
        <ProjectMenu
          row={props.row}
          onOpen={props.onOpen}
          onShare={props.onShare}
          onRename={props.onRename}
          onExport={props.onExport}
          onDelete={props.onDelete}
        />
      </div>
    </Card>
  </li>
);

const ProjectStrip = (props: {
  readonly list: ReturnType<typeof createStrip>;
  readonly sorted: readonly ProjectSummary[];
  readonly folderLabel: (row: ProjectSummary) => string;
  readonly actions: ReturnType<typeof createProjectActions> & ReturnType<typeof createRowActions>;
  readonly onDismiss: (id: string) => void;
}) => (
  <ul data-projects={props.sorted.length} class="flex shrink-0 flex-col gap-3">
    <For each={props.list.pending()}>
      {(download) => (
        <DownloadCard download={download} arrive={props.list.arrive} onDismiss={props.onDismiss} />
      )}
    </For>
    <For each={props.sorted}>
      {(row) => (
        <ProjectCard
          row={row}
          folder={props.folderLabel(row)}
          onOpen={() => props.actions.open(row)}
          onShare={() => props.actions.share(row)}
          onRename={() => props.actions.startRename(row)}
          onExport={() => props.actions.exportZip(row)}
          onDelete={() => props.actions.startDelete(row)}
        />
      )}
    </For>
  </ul>
);

const RenameDialog = (props: {
  readonly open: boolean;
  readonly busy: boolean;
  readonly name: string;
  readonly onName: (name: string) => void;
  readonly onCancel: () => void;
  readonly onRename: () => void;
}) => (
  <Dialog
    open={props.open}
    onOpenChange={(open) => {
      if (!open) props.onCancel();
    }}
    title={t("Rename project")}
    description={t(
      "This is the name Sefer and other Burrito readers show. The folder on disk keeps its own name.",
    )}
    footer={
      <>
        <Button onClick={props.onCancel}>{t("Cancel")}</Button>
        <Button
          variant="primary"
          loading={props.busy}
          disabled={props.name.trim() === ""}
          onClick={props.onRename}
        >
          {t("Rename")}
        </Button>
      </>
    }
  >
    <form
      onSubmit={(event) => {
        event.preventDefault();
        props.onRename();
      }}
    >
      <Input
        value={props.name}
        aria-label={t("Project name")}
        onInput={(event) => props.onName(event.currentTarget.value)}
      />
    </form>
  </Dialog>
);

const DeleteDialog = (props: {
  readonly row: ProjectSummary | undefined;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onDelete: () => void;
}) => (
  <Dialog
    open={props.row !== undefined}
    onOpenChange={(open) => {
      if (!open) props.onCancel();
    }}
    title={t("Delete project")}
    description={t("The folder and everything in it is removed. This cannot be undone.")}
    footer={
      <>
        <Button onClick={props.onCancel}>{t("Cancel")}</Button>
        <Button variant="danger" loading={props.busy} onClick={props.onDelete}>
          {t("Delete")}
        </Button>
      </>
    }
  >
    <p class="break-words">
      <code class="font-mono text-smallest text-on-surface-tertiary">{props.row?.root}</code>
    </p>
  </Dialog>
);

const EmptyNote = () => (
  <p data-testid="projects-empty" class="text-small text-on-surface-secondary">
    {t(
      "To load a project into Sefer, download your translated work from WACS below. Then it will appear here, and you can open it.",
    )}
  </p>
);

export function YourProjects(props: {
  readonly downloads: readonly PendingDownload[];
  readonly flyFrom: DOMRect | undefined;
  readonly onDismiss: (id: string) => void;
}) {
  const shell = useShell();
  const keys = shellKeys(shell.services.settings);
  const { rows, folderLabel } = createProjectList(shell, keys);
  const actions = { ...createProjectActions(shell, keys, rows), ...createRowActions(shell, keys) };
  const list = createStrip(props, rows);
  const { pending } = list;
  const sorted = (): readonly ProjectSummary[] => sortProjects(rows() ?? [], props.downloads);

  return (
    <Show
      when={rows()}
      fallback={<p class="text-small text-on-surface-tertiary">{t("Reading…")}</p>}
    >
      <Show when={sorted().length > 0 || pending().length > 0} fallback={<EmptyNote />}>
        <ProjectStrip
          list={list}
          sorted={sorted()}
          folderLabel={folderLabel}
          actions={actions}
          onDismiss={props.onDismiss}
        />
      </Show>

      <RenameDialog
        open={actions.renaming() !== undefined}
        busy={actions.busy()}
        name={actions.newName()}
        onName={actions.setNewName}
        onCancel={actions.cancelRename}
        onRename={actions.rename}
      />

      <DeleteDialog
        row={actions.deleting()}
        busy={actions.busy()}
        onCancel={actions.cancelDelete}
        onDelete={actions.remove}
      />
    </Show>
  );
}
