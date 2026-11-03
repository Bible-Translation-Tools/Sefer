import type { JSX } from "@solidjs/web";
import { Match, Switch } from "solid-js";

import { m } from "#app/paraglide/messages";

import { useShellState } from "../ProjectContext";
import { DelayedSpinner } from "./primitives";

export function ShellGate(props: { readonly children: () => JSX.Element }) {
  const state = useShellState();

  const reason = (): string => {
    const held = state();
    return held.kind === "failed" ? held.reason : "";
  };

  return (
    <Switch fallback={<DelayedSpinner />}>
      <Match when={state().kind === "ready"}>{props.children()}</Match>
      <Match when={state().kind === "failed"}>
        <p
          class="m-6 rounded-md bg-surface-error px-4 py-3 text-small text-on-surface-error"
          data-shell="failed"
        >
          {m.shell_the_usfm_engine_did_not()} <code class="font-mono">{reason()}</code>
        </p>
      </Match>
    </Switch>
  );
}
