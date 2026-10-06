/**
 * One line of where the project stands with the shared project, for the
 * screen where versions are made: Review.
 *
 * It is the status bar's "↑2 ↓3" said in words — "Saved changes not sent
 * yet · 3 verses in 2 books differ from yours" — with the one move beside it.
 * Shown only when there is something to say: both sides agreeing, or a project
 * attached to nothing, is no line at all.
 */

import CloudAlert from "lucide-solid/icons/cloud-alert";
import CloudDownload from "lucide-solid/icons/cloud-download";
import CloudOff from "lucide-solid/icons/cloud-off";
import CloudUpload from "lucide-solid/icons/cloud-upload";
import { Show } from "solid-js";

import type { IncomingPlan, Sync } from "#core/sync";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { syncWatch } from "../../syncWatch";
import { Button, cx } from "../primitives";
import { incomingWords, outgoingWords } from "./copy";
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

/**
 * "Saved changes not sent yet · 3 verses in 2 books differ from yours" — the
 * plan's numbers, never a count of versions (`incomingWords`).
 */
const countsOf = (sync: Sync, plan: IncomingPlan | undefined): string => {
  const parts: string[] = [];
  if (sync.clocks.local.unshared > 0) parts.push(outgoingWords());
  if (sync.clocks.shared.unshared > 0)
    parts.push(
      (plan === undefined ? undefined : incomingWords(plan)) ??
        t("the shared project has changes you don't have yet"),
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
              ? t("Offline — your saved changes stay on this device until you're back.")
              : held().state === "unauthorized"
                ? t("Sign in to send your changes.")
                : countsOf(held(), syncWatch.facts(shell.project()?.root)?.plan)}
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
