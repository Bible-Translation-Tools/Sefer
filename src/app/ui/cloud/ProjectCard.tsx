import { Show } from "solid-js";

import { m } from "#app/paraglide/messages";
import type { Clock, IncomingPlan, Sync } from "#core/sync";

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
        <Show
          when={props.clock.at !== undefined}
          fallback={<span>{m.cloud_no_versions_yet()}</span>}
        >
          <span class="font-medium text-on-surface-primary">{ago(props.clock.at ?? 0)}</span>
          <Show when={props.clock.by !== undefined}>
            <span class="text-on-surface-tertiary">
              {" "}
              {m.cloud_by_who({ who: props.clock.by ?? "" })}
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
        label={m.cloud_this_device()}
        clock={props.sync.clocks.local}
        unshared={
          props.sync.clocks.local.unshared === 0
            ? m.cloud_nothing_waiting_to_be_sent()
            : outgoingWords()
        }
      />
      <ClockLine
        test="shared"
        label={m.cloud_shared_project()}
        clock={props.sync.clocks.shared}
        unshared={
          props.sync.clocks.shared.unshared === 0
            ? m.cloud_nothing_waiting_to_be_received()
            : ((props.plan === undefined ? undefined : incomingWords(props.plan)) ??
              m.cloud_changes_you_dont_have_yet())
        }
      />
    </div>
  );
}
