import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { Effect, FileSystem } from "effect";
import FolderOpen from "lucide-solid/icons/folder-open";
import { For, Show, createSignal } from "solid-js";

import { t } from "../app/i18n";
import { useShell } from "../app/ProjectContext";
import { Badge, Button, Card, EmptyState, PanelHeader } from "../app/ui/primitives";
import { ShellGate } from "../app/ui/ShellGate";

/**
 * The projects list: what this host can actually open.
 *
 * On the Web host that is the OPFS subtree Sefer owns, plus (in a dev build
 * over the fixture FileSystem) the seeded `small-nt` project. It is NOT a
 * folder picker: `WebDialogsLive.pickFolder` returns a picked handle's name
 * rather than a path, so an arbitrary disk folder cannot be read yet — the
 * page says so instead of failing silently.
 */

const listProjects = (
  root: string,
): Effect.Effect<readonly string[], never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const names = yield* fileSystem.readDirectory(root);
    return [...names].sort();
  }).pipe(Effect.orElseSucceed(() => []));

function Projects() {
  const navigate = useNavigate();
  const shell = useShell();
  const [roots, setRoots] = createSignal<readonly string[] | undefined>(undefined, {
    name: "projectRoots",
  });

  void shell.services.run(listProjects(shell.services.projectsRoot)).then((names) => {
    setRoots(names.map((name) => `${shell.services.projectsRoot}/${name}`));
  });

  const open = (root: string): void => {
    void shell.openProject(root).then(() => {
      if (shell.project() === undefined) return;
      void navigate({ to: "/project/$id", params: { id: encodeURIComponent(root) } });
    });
  };

  return (
    <main class="min-w-0 space-y-4 p-6">
      <PanelHeader title={t("Projects")} subtitle={shell.services.projectsRoot} />

      <Show when={shell.services.fixtureProject}>
        {(fixture) => (
          <Card class="flex items-center gap-3">
            <strong class="text-small">{t("small-nt (seeded fixture)")}</strong>
            <Badge tone="brand">{t("dev")}</Badge>
            <Button variant="primary" class="ms-auto" onClick={() => open(fixture())}>
              {t("Open")}
            </Button>
          </Card>
        )}
      </Show>

      <Show
        when={roots()}
        fallback={<p class="text-small text-on-surface-tertiary">{t("Reading…")}</p>}
      >
        {(names) => (
          <Show
            when={names().length > 0}
            fallback={
              <EmptyState
                icon={<FolderOpen size={22} />}
                title={t("No projects yet")}
                description={t("Import a resource, or open the dev fixture with ?fixture=1.")}
              />
            }
          >
            <ul class="flex flex-col gap-2">
              <For each={names()}>
                {(root) => (
                  <li>
                    <Card class="flex items-center gap-3">
                      <code class="truncate font-mono text-small text-on-surface-secondary">
                        {root}
                      </code>
                      <Button class="ms-auto" onClick={() => open(root)}>
                        {t("Open")}
                      </Button>
                    </Card>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        )}
      </Show>

      <p class="max-w-prose text-smallest text-on-surface-tertiary">
        {t(
          "This host cannot yet read a folder outside its own storage: the browser picker hands back a handle, not a path.",
        )}
      </p>
    </main>
  );
}

export const Route = createFileRoute("/projects")({
  head: () => ({ meta: [{ title: "Sefer — projects" }] }),
  component: () => <ShellGate>{() => <Projects />}</ShellGate>,
});
