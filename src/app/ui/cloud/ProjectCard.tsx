/**
 * Where this project stands: the shared project it belongs to, the two clocks,
 * and the state as one badge.
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

import type { Clock, Sync } from "#core/sync";

import { t } from "../../i18n";
import { ago, exact } from "../panels/format";
import { Badge, Card, PanelHeader } from "../primitives";
import { plural, stateCopy } from "./copy";

/** The repository, as a person reads it: `owner/name`, not a clone URL. */
const shortOrigin = (url: string): string => {
  try {
    const path = new URL(url).pathname.replace(/^\/+|\.git$/gu, "");
    return path === "" ? url : path;
  } catch {
    return url;
  }
};

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
          {ago(props.clock.at ?? 0)}
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

export function ProjectCard(props: { readonly sync: Sync; readonly projectName: string }) {
  const copy = () => stateCopy(props.sync.state);
  const local = () => props.sync.clocks.local;
  const shared = () => props.sync.clocks.shared;

  return (
    <Card class="space-y-4" data-cloud-card="project" data-sync-state={props.sync.state}>
      <PanelHeader
        level={3}
        title={props.projectName}
        subtitle={
          props.sync.reading.origin === undefined
            ? t("Not connected to a shared project")
            : shortOrigin(props.sync.reading.origin)
        }
        actions={<Badge tone={copy().tone}>{copy().chip}</Badge>}
      />

      <div>
        <h4 class="text-body font-medium">{copy().headline}</h4>
        <p class="mt-1 text-small text-on-surface-secondary">{copy().detail}</p>
      </div>

      <div class="flex flex-wrap gap-6 border-t border-surface-border pt-3">
        <ClockLine
          test="local"
          label={t("This device")}
          clock={local()}
          unshared={
            local().unshared === 0
              ? t("nothing waiting to be sent")
              : plural(
                  local().unshared,
                  "{count} version the shared project does not have",
                  "{count} versions the shared project does not have",
                )
          }
        />
        <ClockLine
          test="shared"
          label={t("Shared project")}
          clock={shared()}
          unshared={
            shared().unshared === 0
              ? t("nothing waiting to be received")
              : plural(
                  shared().unshared,
                  "{count} version this device does not have",
                  "{count} versions this device does not have",
                )
          }
        />
      </div>

      <Show when={props.sync.reading.uncommitted > 0}>
        <p class="text-small text-on-surface-tertiary" data-cloud="uncommitted">
          {plural(
            props.sync.reading.uncommitted,
            "{count} file here has been written but not recorded as a version yet — it is not part of either count.",
            "{count} files here have been written but not recorded as a version yet — they are not part of either count.",
          )}
        </p>
      </Show>
    </Card>
  );
}
