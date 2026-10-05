/**
 * One line of where the project stands with the shared project, for the
 * screen where versions are made: Review.
 *
 * It is the status bar's "↑2 ↓3" said in words — "2 versions only on this
 * device · 3 in the shared project you don't have" — with the one move beside
 * it. Shown only when there is something to say: both sides agreeing, or a
 * project attached to nothing, is no line at all.
 */

import CloudAlert from "lucide-solid/icons/cloud-alert";
import CloudDownload from "lucide-solid/icons/cloud-download";
import CloudOff from "lucide-solid/icons/cloud-off";
import CloudUpload from "lucide-solid/icons/cloud-upload";
import { Show } from "solid-js";

import type { Sync } from "#core/sync";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Button, cx } from "../primitives";
import { plural } from "./copy";
import { attentionOf, createQuickSync, quickActionOf, quickLabel } from "./quick";

const SAID = new Set(["ahead", "behind", "diverged", "offline", "unauthorized", "conflicted"]);

const glyphOf = (sync: Sync) => {
  switch (sync.state) {
    case "ahead":
      return <CloudUpload size={16} />;
    case "behind":
      return <CloudDownload size={16} />;
    case "offline":
      return <CloudOff size={16} />;
    default:
      return <CloudAlert size={16} />;
  }
};

/** "2 versions only on this device · 3 in the shared project you don't have". */
const countsOf = (sync: Sync): string => {
  const parts: string[] = [];
  const ahead = sync.clocks.local.unshared;
  const behind = sync.clocks.shared.unshared;
  if (ahead > 0)
    parts.push(
      plural(ahead, "{count} version only on this device", "{count} versions only on this device"),
    );
  if (behind > 0)
    parts.push(
      plural(
        behind,
        "{count} version in the shared project you don't have",
        "{count} versions in the shared project you don't have",
      ),
    );
  return parts.join(" · ");
};

export function SyncLine(props: {
  /** What "See the changes" does here: Review sets itself against the shared project. */
  readonly onSee: () => void;
  /** Review is already against the shared project, so "See the changes" is this screen. */
  readonly seeing: boolean;
}) {
  const shell = useShell();
  const quick = createQuickSync(shell, () => props.onSee());
  const shown = (): Sync | undefined => {
    const held = quick.sync();
    return held !== undefined && held.reading.origin !== undefined && SAID.has(held.state)
      ? held
      : undefined;
  };

  return (
    <Show when={shown()}>
      {(held) => (
        <div
          class={cx(
            "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-surface-border px-3 py-1.5 text-small",
            attentionOf(held()) === "none"
              ? "text-on-surface-secondary"
              : "text-on-surface-warning",
          )}
          data-sync-line={held().state}
        >
          <span aria-hidden="true" class="inline-flex">
            {glyphOf(held())}
          </span>
          <span>
            {held().state === "offline"
              ? t("Offline — versions stay on this device until you're back.")
              : held().state === "unauthorized"
                ? t("Sign in to send to the shared project.")
                : countsOf(held())}
          </span>
          <Show
            when={
              !(props.seeing && quickActionOf(held()) === "see") &&
              quickActionOf(held()) !== "check"
            }
          >
            <Button
              size="sm"
              variant="secondary"
              class="ms-auto"
              loading={quick.busy() !== ""}
              data-sync-line-action={quickActionOf(held())}
              onClick={() => quick.run(quickActionOf(held()))}
            >
              {quickLabel(quickActionOf(held()))}
            </Button>
          </Show>
        </div>
      )}
    </Show>
  );
}
