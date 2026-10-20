import type { JSX } from "@solidjs/web";
import ChevronDownIcon from "lucide-solid/icons/chevron-down";
import ChevronUpIcon from "lucide-solid/icons/chevron-up";
import FoldVerticalIcon from "lucide-solid/icons/fold-vertical";
import UnfoldVerticalIcon from "lucide-solid/icons/unfold-vertical";

import type { Extent } from "#core/excerpts/excerpts";

import { t } from "../../i18n";
import { cx, IconButton } from "../primitives";
import { widened, type ContextStep } from "./cardState";

const part =
  "inline-flex h-6 cursor-pointer items-center gap-1 px-2 text-smallest font-medium text-on-surface-secondary transition-colors hover:not-disabled:bg-surface-secondary hover:not-disabled:text-on-surface-primary disabled:cursor-not-allowed disabled:opacity-40";

export function ContextControl(props: {
  readonly extent: Extent;
  readonly canUp: boolean;
  readonly canDown: boolean;
  readonly onStep: (step: ContextStep) => void;
  readonly only?: string;
}) {
  const chapter = (): boolean => props.extent.chapter === true;
  const folded = (): boolean => props.extent.folded !== undefined;
  const fold = (): JSX.Element => (
    <IconButton
      size="sm"
      data-step="fold"
      label={folded() ? t("Show the context again") : (props.only ?? t("Show only the match"))}
      icon={folded() ? <UnfoldVerticalIcon /> : <FoldVerticalIcon />}
      aria-pressed={folded() ? "true" : "false"}
      disabled={!folded() && !widened(props.extent)}
      onClick={() => props.onStep("fold")}
    />
  );
  return (
    <div class="inline-flex items-center gap-1">
      <div
        role="group"
        aria-label={t("Context")}
        data-context
        class="inline-flex items-stretch overflow-hidden rounded-md"
      >
        <button
          type="button"
          data-step="up"
          class={part}
          aria-label={t("Show one more above")}
          disabled={chapter() || !props.canUp}
          onClick={() => props.onStep("up")}
        >
          <ChevronUpIcon size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          data-step="chapter"
          class={cx(part, chapter() && "bg-surface-secondary text-brand")}
          aria-pressed={chapter() ? "true" : "false"}
          onClick={() => props.onStep("chapter")}
        >
          {t("Chapter")}
        </button>
        <button
          type="button"
          data-step="down"
          class={part}
          aria-label={t("Show one more below")}
          disabled={chapter() || !props.canDown}
          onClick={() => props.onStep("down")}
        >
          <ChevronDownIcon size={13} aria-hidden="true" />
        </button>
      </div>
      {fold()}
    </div>
  );
}
