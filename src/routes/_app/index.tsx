import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { Show, untrack } from "solid-js";

import { useShell } from "#app/ProjectContext";
import { ShellGate } from "#app/ui/ShellGate";
import { EmptyWorkspace } from "#app/ui/workspace/EmptyWorkspace";
import "#app/ui/theme";

function Landing() {
  const shell = useShell();
  const navigate = useNavigate();

  const enter = (): boolean => {
    const last = untrack(() => shell.recentProjects())[0];
    if (last === undefined) return false;
    void navigate({
      to: "/project/$slug",
      params: { slug: shell.slugFor(last.root) },
      replace: true,
    });
    return true;
  };

  const forwarded = enter();
  return (
    <Show when={!forwarded}>
      <EmptyWorkspace />
    </Show>
  );
}

export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "Sefer" }] }),
  component: () => <ShellGate>{() => <Landing />}</ShellGate>,
});
