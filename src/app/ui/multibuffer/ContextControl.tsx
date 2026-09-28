/**
 * The joined three-part context control every card wears: one TOC step up,
 * the whole chapter, one TOC step down. A card starts from the setting's steps
 * (`excerpts.context`) and this widens that one card.
 */

import ChevronDownIcon from "lucide-solid/icons/chevron-down";
import ChevronUpIcon from "lucide-solid/icons/chevron-up";

import { t } from "../../i18n";
import { cx } from "../primitives";

/** One press of the context control. */
export type ContextStep = "up" | "down" | "chapter";

export function ContextControl(props: {
  /** Showing the whole chapter: the steps are off, Chapter is pressed. */
  readonly chapter: boolean;
  readonly canUp: boolean;
  readonly canDown: boolean;
  readonly onStep: (step: ContextStep) => void;
}) {
  const part =
    "inline-flex h-6 cursor-pointer items-center gap-1 px-2 text-smallest font-medium text-on-surface-secondary transition-colors hover:not-disabled:bg-surface-secondary hover:not-disabled:text-on-surface-primary disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div
      role="group"
      aria-label={t("Context")}
      data-context
      class="inline-flex items-stretch divide-x divide-surface-border overflow-hidden rounded-md border border-surface-border"
    >
      <button
        type="button"
        data-step="up"
        class={part}
        aria-label={t("Show one more above")}
        disabled={props.chapter || !props.canUp}
        onClick={() => props.onStep("up")}
      >
        <ChevronUpIcon size={13} aria-hidden="true" />
      </button>
      <button
        type="button"
        data-step="chapter"
        class={cx(part, props.chapter && "bg-surface-secondary text-brand")}
        aria-pressed={props.chapter ? "true" : "false"}
        onClick={() => props.onStep("chapter")}
      >
        {t("Chapter")}
      </button>
      <button
        type="button"
        data-step="down"
        class={part}
        aria-label={t("Show one more below")}
        disabled={props.chapter || !props.canDown}
        onClick={() => props.onStep("down")}
      >
        <ChevronDownIcon size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
