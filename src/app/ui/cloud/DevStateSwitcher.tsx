/**
 * The dev-only row that puts `/cloud` into any state on one click.
 *
 * It writes `?syncState=` into the URL as well as into the signal, so a
 * screenshot run, a bug report and a reload all name the same thing. The
 * fixture it selects is `./fixture.ts`; nothing about the composition changes,
 * and the cards below render the fixture's facts through the same pure
 * derivation the real reading goes through.
 *
 * `CloudScreen` renders this inside a `Show when={import.meta.env.DEV}`, and
 * the constant folds away in a production build.
 */

import { For } from "solid-js";

import { t } from "../../i18n";
import { Button, Card } from "../primitives";
import { fixtureStates, type FixtureName } from "./fixture";

export function DevStateSwitcher(props: {
  readonly value: FixtureName | undefined;
  readonly onChange: (state: FixtureName | undefined) => void;
}) {
  const select = (state: FixtureName | undefined): void => {
    props.onChange(state);
    if (typeof history !== "object" || typeof location !== "object") return;
    const url = new URL(location.href);
    if (state === undefined) url.searchParams.delete("syncState");
    else url.searchParams.set("syncState", state);
    history.replaceState(null, "", url.toString());
  };

  return (
    <Card class="flex flex-wrap items-center gap-2" data-cloud-card="dev-states">
      <span class="text-smallest tracking-wide text-on-surface-tertiary uppercase">
        {t("dev: show state")}
      </span>
      <Button
        size="sm"
        aria-pressed={props.value === undefined ? "true" : "false"}
        onClick={() => select(undefined)}
        data-dev-state="real"
      >
        {t("real")}
      </Button>
      <For each={fixtureStates}>
        {(state) => (
          <Button
            size="sm"
            aria-pressed={props.value === state ? "true" : "false"}
            onClick={() => select(state)}
            data-dev-state={state}
          >
            {state}
          </Button>
        )}
      </For>
    </Card>
  );
}
