import type { JSX } from "@solidjs/web";
import ChevronDownIcon from "lucide-solid/icons/chevron-down";
import ChevronUpIcon from "lucide-solid/icons/chevron-up";
import FoldVerticalIcon from "lucide-solid/icons/fold-vertical";
import UnfoldVerticalIcon from "lucide-solid/icons/unfold-vertical";

import { m } from "#app/paraglide/messages";
import type { Extent } from "#core/excerpts/excerpts";

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
      label={
        folded()
          ? m.multibuffer_show_the_context_again()
          : (props.only ?? m.multibuffer_show_only_the_match())
      }
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
        aria-label={m.multibuffer_context()}
        data-context
        class="inline-flex items-stretch overflow-hidden rounded-md"
      >
        <button
          type="button"
          data-step="up"
          class={part}
          aria-label={m.multibuffer_show_one_more_above()}
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
          {m.common_chapter()}
        </button>
        <button
          type="button"
          data-step="down"
          class={part}
          aria-label={m.multibuffer_show_one_more_below()}
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
