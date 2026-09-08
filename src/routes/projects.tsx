import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { Effect, FileSystem } from "effect";
import { For, Show, createSignal } from "solid-js";

import { t } from "../app/i18n";
import { useShell } from "../app/ProjectContext";
import { ShellGate } from "../app/ui/ShellGate";

/**
 * The projects list: what this host can actually open.
 *
 * On the Web host that is the OPFS subtree Sefer owns, plus (in a dev build
 * over the fixture FileSystem) the seeded `small-nt` project. It is NOT a
 * folder picker: `WebDialogsLive.pickFolder` returns a picked handle's name
 * rather than a path, so an arbitrary disk folder cannot be read yet — the
 * "Open a folder…" button says so instead of failing silently.
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
    <main>
      <header>
        <h2>{t("Projects")}</h2>
        <span class="muted spacer">{shell.services.projectsRoot}</span>
      </header>

      <Show when={shell.services.fixtureProject}>
        {(fixture) => (
          <ul class="list">
            <li>
              <strong>{t("small-nt (seeded fixture)")}</strong>
              <button
                type="button"
                data-variant="primary"
                class="spacer"
                onClick={() => open(fixture())}
              >
                {t("Open")}
              </button>
            </li>
          </ul>
        )}
      </Show>

      <Show when={roots()} fallback={<p class="muted">{t("Reading…")}</p>}>
        {(names) => (
          <Show
            when={names().length > 0}
            fallback={
              <p class="muted">
                {t("No projects yet. Import a resource, or open the dev fixture with ?fixture=1.")}
              </p>
            }
          >
            <ul class="list">
              <For each={names()}>
                {(root) => (
                  <li>
                    <code>{root}</code>
                    <button type="button" class="spacer" onClick={() => open(root)}>
                      {t("Open")}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        )}
      </Show>

      <p class="muted">
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
