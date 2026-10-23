import { Show } from "solid-js";

import type { Clock, IncomingPlan, Sync } from "#core/sync";

import { t } from "../../i18n";
import { ago, exact } from "../panels/format";
import { cx } from "../primitives";
import { incomingWords, outgoingWords } from "./copy";

function ClockLine(props: {
  readonly label: string;
  readonly clock: Clock;
  readonly unshared: string;
  readonly test: string;
}) {
  return (
    <div class="flex-1 space-y-0.5" data-clock={props.test}>
      <p class="text-smallest font-medium text-on-surface-tertiary">{props.label}</p>
      <p
        class="text-small"
        title={props.clock.at === undefined ? undefined : exact(props.clock.at)}
      >
        <Show when={props.clock.at !== undefined} fallback={<span>{t("no versions yet")}</span>}>
          <span class="font-medium text-on-surface-primary">{ago(props.clock.at ?? 0)}</span>
          <Show when={props.clock.by !== undefined}>
            <span class="text-on-surface-tertiary">
              {" "}
              {t("by {who}", { who: props.clock.by ?? "" })}
            </span>
          </Show>
        </Show>
      </p>
      <p
        class={
          props.clock.unshared > 0
            ? "text-smallest text-on-surface-secondary"
            : "text-smallest text-on-surface-tertiary"
        }
        data-unshared={props.clock.unshared}
      >
        {props.unshared}
      </p>
    </div>
  );
}

export function SyncClocks(props: {
  readonly sync: Sync;
  readonly plan?: IncomingPlan;
  readonly class?: string;
}) {
  return (
    <div class={cx("flex flex-wrap gap-6", props.class)}>
      <ClockLine
        test="local"
        label={t("This device")}
        clock={props.sync.clocks.local}
        unshared={
          props.sync.clocks.local.unshared === 0 ? t("nothing waiting to be sent") : outgoingWords()
        }
      />
      <ClockLine
        test="shared"
        label={t("Shared project")}
        clock={props.sync.clocks.shared}
        unshared={
          props.sync.clocks.shared.unshared === 0
            ? t("nothing waiting to be received")
            : ((props.plan === undefined ? undefined : incomingWords(props.plan)) ??
              t("changes you don't have yet"))
        }
      />
    </div>
  );
}
