import { Outlet, createFileRoute, useNavigate } from "@tanstack/solid-router";
import { Match, Switch, createEffect, createMemo, untrack } from "solid-js";

import { m } from "#app/paraglide/messages";
import { useShell } from "#app/ProjectContext";
import { Button, DelayedSpinner, EmptyState } from "#app/ui/primitives";
import "#app/ui/theme";
import { ShellGate } from "#app/ui/ShellGate";
import type { OpenFailure } from "#core/project/lifecycle";

const failureWords = (reason: OpenFailure): string => {
  switch (reason) {
    case "NotADirectory":
      return m.shell_its_folder_is_gone();
    case "NoBooks":
      return m.shell_its_folder_has_no_books();
    case "Refused":
      return m.shell_its_files_could_not_be_read();
  }
};

type View =
  | { readonly kind: "unknown" }
  | { readonly kind: "opening" }
  | { readonly kind: "ready" }
  | { readonly kind: "failed"; readonly root: string; readonly reason: OpenFailure };

function ProjectLayout() {
  const shell = useShell();
  const params = Route.useParams();
  const navigate = useNavigate();

  // What this address shows is read off the shell's one phase, not kept beside it.
  const view = createMemo(
    (): View => {
      const root = shell.rootForSlug(params().slug);
      if (root === undefined) return { kind: "unknown" };
      const phase = shell.projectPhase();
      if (phase.kind === "open" && phase.root === root) return { kind: "ready" };
      if (phase.kind === "failed" && phase.root === root)
        return { kind: "failed", root, reason: phase.reason };
      return { kind: "opening" };
    },
    { name: "projectLayoutView" },
  );

  createEffect(
    () => params().slug,
    (slug) => {
      const root = shell.rootForSlug(slug);
      if (root === undefined) return;
      // A one-time question, not a subscription: is this project already the open one?
      const phase = untrack(() => shell.projectPhase());
      if (phase.kind === "open" && phase.root === root) return;
      void shell.openProject(root);
    },
  );

  const failed = (): Extract<View, { kind: "failed" }> | undefined => {
    const now = view();
    return now.kind === "failed" ? now : undefined;
  };

  return (
    <Switch>
      <Match when={view().kind === "ready"}>
        <Outlet />
      </Match>
      <Match when={view().kind === "unknown"}>
        <main data-testid="no-project" aria-label={m.shell_no_project_open()} class="h-full" />
      </Match>
      <Match when={failed()}>
        {(failure) => (
          <main data-testid="project-failed" class="grid h-full place-items-center p-6">
            <EmptyState
              title={m.shell_could_not_open_this_project()}
              description={failureWords(failure().reason)}
              action={
                <div class="flex gap-2">
                  <Button onClick={() => void shell.openProject(failure().root)}>
                    {m.shell_try_again()}
                  </Button>
                  <Button variant="tertiary" onClick={() => void navigate({ to: "/projects" })}>
                    {m.shell_back_to_projects()}
                  </Button>
                </div>
              }
            />
          </main>
        )}
      </Match>
      <Match when={view().kind === "opening"}>
        {/* The open reads every book, parses every book and proofreads the
            whole corpus before it answers — ~600ms for a Bible. Stated once,
            here, rather than per screen, and blank unless it runs long. */}
        <DelayedSpinner />
      </Match>
    </Switch>
  );
}

export const Route = createFileRoute("/_app/project/$slug")({
  component: () => <ShellGate>{() => <ProjectLayout />}</ShellGate>,
});
