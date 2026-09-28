/**
 * The joined context control every card wears: one TOC step up, the whole
 * chapter, one TOC step down, and collapse — back to the card's own unit
 * alone. A card starts from the setting's steps (`excerpts.context`) and this
 * widens that one card, or takes it back down.
 */

import ChevronDownIcon from "lucide-solid/icons/chevron-down";
import ChevronUpIcon from "lucide-solid/icons/chevron-up";
import ChevronsDownUpIcon from "lucide-solid/icons/chevrons-down-up";

import { t } from "../../i18n";
import { cx } from "../primitives";

/** One press of the context control. */
export type ContextStep = "up" | "down" | "chapter" | "collapse";

/** How far a card reaches beyond its own unit, in TOC steps; or its chapter. */
interface Reach {
  readonly up: number;
  readonly down: number;
  readonly chapter?: boolean;
}

/**
 * A card's reach after one press — the ONE rule every list applies (Find's
 * feed, Review's cards). Collapse is the unit alone, whatever the setting
 * started it at: what the reader asked for is "just the hit" or "just the
 * change".
 */
export const stepExtent = (now: Reach, step: ContextStep): Reach =>
  step === "collapse"
    ? { up: 0, down: 0 }
    : step === "chapter"
      ? { up: now.up, down: now.down, chapter: now.chapter !== true }
      : step === "up"
        ? { up: now.up + 1, down: now.down }
        : { up: now.up, down: now.down + 1 };

/** Whether a card shows anything beyond its own unit: what Collapse is offered for. */
export const widened = (now: Reach): boolean => now.chapter === true || now.up > 0 || now.down > 0;

export function ContextControl(props: {
  /** Showing the whole chapter: the steps are off, Chapter is pressed. */
  readonly chapter: boolean;
  readonly canUp: boolean;
  readonly canDown: boolean;
  /** Showing more than its own unit: Collapse takes it back down. */
  readonly widened: boolean;
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
      <button
        type="button"
        data-step="collapse"
        class={part}
        aria-label={t("Back to just this one")}
        title={t("Back to just this one")}
        disabled={!props.widened}
        onClick={() => props.onStep("collapse")}
      >
        <ChevronsDownUpIcon size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
