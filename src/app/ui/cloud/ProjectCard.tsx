/**
 * Where this project stands: the two clocks, as the cloud popover shows them.
 *
 * The two clocks are the whole idea. A translator does not want a ref
 * comparison; they want to know how much of their morning has left this
 * machine and how much of everyone else's has arrived. So there are exactly
 * two stat lines, always both shown, and each says when that side last moved
 * and how many of its versions the other side has not got.
 *
 * The shared line names who recorded the newest cloud version when there is
 * something to receive; the local line never does, because we already know.
 */

import { Show } from "solid-js";

import type { Clock, IncomingPlan, Sync } from "#core/sync";

import { t } from "../../i18n";
import { ago, exact } from "../panels/format";
import { cx, type BadgeTone } from "../primitives";
import { incomingWords, outgoingWords } from "./copy";

function ClockLine(props: {
  readonly label: string;
  readonly clock: Clock;
  readonly unshared: string;
  readonly test: string;
}) {
  return (
    <div class="flex-1 space-y-0.5" data-clock={props.test}>
      <p class="text-smallest tracking-wide text-on-surface-tertiary uppercase">{props.label}</p>
      <p
        class="text-small"
        title={props.clock.at === undefined ? undefined : exact(props.clock.at)}
      >
        <Show when={props.clock.at !== undefined} fallback={<span>{t("no versions yet")}</span>}>
          {/* The time is the answer to "when", so it is the coloured word. */}
          <span class="font-medium text-brand">{ago(props.clock.at ?? 0)}</span>
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

/**
 * A state's tone as the colour of its headline. No chip: the sentence itself
 * says the state, and colours it only when it wants something from you.
 */
export const toneText = (tone: BadgeTone): string => {
  switch (tone) {
    case "success":
      return "text-on-surface-success";
    case "warning":
      return "text-on-surface-warning";
    case "error":
      return "text-on-surface-error";
    default:
      return "text-on-surface-primary";
  }
};

/** The two clocks, side by side: this device's and the shared project's. */
export function SyncClocks(props: {
  readonly sync: Sync;
  /** What would arrive, for the shared side's words in verses; absent until it is worked out. */
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
