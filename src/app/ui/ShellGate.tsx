/**
 * The gate every screen that needs services renders inside.
 *
 * Its children are rendered only once the shell is ready, so a screen below it
 * can call `useShell()` directly — which is why the gate passes nothing down.
 *
 * The engine loads asynchronously and can refuse (a wasm fetch that fails, a
 * wire format the reader does not know), so there are three states and all
 * three are shown honestly. A route body therefore never has to ask whether
 * its services exist.
 */

import type { JSX } from "@solidjs/web";
import { Match, Switch } from "solid-js";

import { t } from "../i18n";
import { useShellState } from "../ProjectContext";

export function ShellGate(props: { readonly children: () => JSX.Element }) {
  const state = useShellState();

  const reason = (): string => {
    const held = state();
    return held.kind === "failed" ? held.reason : "";
  };

  return (
    <Switch fallback={<p class="muted">{t("Loading the USFM engine…")}</p>}>
      <Match when={state().kind === "ready"}>{props.children()}</Match>
      <Match when={state().kind === "failed"}>
        <p class="problem" data-shell="failed">
          {t("The USFM engine did not load. Sefer cannot parse without it.")}{" "}
          <code>{reason()}</code>
        </p>
      </Match>
    </Switch>
  );
}
