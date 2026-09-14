/**
 * "Your projects": every project root this host can actually open, as a table.
 *
 * The columns are the four things that tell one project from another at a
 * glance — its name, its language, how many books it holds, and when it was
 * last opened here. Three of them come off disk (`summarize`); the fourth is a
 * preference, because nothing on disk records a visit.
 *
 * Opening writes `shell.recentProjects` BEFORE it navigates. A project that
 * failed to open is still a project you tried to open, and the ordering people
 * rely on is "what I was last working on", not "what last succeeded".
 */

import { useNavigate } from "@tanstack/solid-router";
import { Effect } from "effect";
import FolderOpen from "lucide-solid/icons/folder-open";
import { For, Show, createEffect, createSignal } from "solid-js";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../primitives";
import { formatDate, listProjectRoots, summarize, type ProjectSummary } from "./summaries";

export function YourProjects(props: { readonly reload: number }) {
  const navigate = useNavigate();
  const shell = useShell();
  const { services } = shell;
  const keys = shellKeys(services.settings);

  const [rows, setRows] = createSignal<readonly ProjectSummary[] | undefined>(undefined, {
    name: "projectSummaries",
  });

  /**
   * One pass per `reload` tick. The tick is the whole subscription: an import
   * raises it and the list re-reads itself, without the list ever knowing what
   * an import is.
   */
  createEffect(
    () => props.reload,
    () => {
      const recent = services.settings.get(keys.recentProjects);
      void services
        .run(
          Effect.flatMap(
            listProjectRoots(services.projectsRoot, services.fixtureProject),
            (roots) =>
              Effect.forEach(roots, (entry) =>
                summarize(entry.root, recent[entry.root], entry.fixture),
              ),
          ),
        )
        .then(setRows);
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
      Effect.ignore(services.settings.set(keys.recentProjects, { ...recent, [row.root]: stamp })),
    );
    void shell.openProject(row.root).then(() => {
      if (shell.project() === undefined) return;
      void navigate({ to: "/project/$id", params: { id: encodeURIComponent(row.root) } });
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
                      <Button size="sm" variant="primary" onClick={() => open(row)}>
                        {t("Open")}
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
              </For>
            </TableBody>
          </Table>
        </Card>
      </Show>
    </Show>
  );
}
