import ChevronDown from "lucide-solid/icons/chevron-down";
import Save from "lucide-solid/icons/save";
import { Show } from "solid-js";

import { m } from "#app/paraglide/messages";

import { ago } from "../../panels/format";
import { Badge, Button, Popover } from "../../primitives";
import { BackToEditor } from "../../workspace/BackToEditor";
import type { Compare } from "./createCompare";
import type { Decisions } from "./createDecisions";
import type { SaveForm } from "./createSaveForm";
import type { Sides } from "./createSides";
import { SourcePicker } from "./SourcePicker";

interface ReviewHeaderProps {
  readonly sides: Sides;
  readonly compare: Compare;
  readonly decisions: Decisions;
  readonly form: SaveForm;
  readonly sourcesOpen: boolean;
  readonly onSourcesOpenChange: (open: boolean) => void;
  readonly sourcesLabel: string;
  readonly busy: string;
  readonly note: string;
  readonly lastBackup: number | undefined;
}

function SidePicker(props: { readonly sides: Sides; readonly side: "left" | "right" }) {
  return (
    <SourcePicker
      side={props.side}
      from={(props.side === "left") === props.sides.editorFirst()}
      value={props.side === "left" ? props.sides.leftId() : props.sides.rightId()}
      other={props.side === "left" ? props.sides.rightId() : props.sides.leftId()}
      picked={props.side === "left" ? props.sides.leftPicked() : props.sides.rightPicked()}
      choice={props.sides.choiceOf(
        props.side === "left" ? props.sides.leftId() : props.sides.rightId(),
      )}
      choices={props.sides.choices()}
      onPick={props.sides.pick}
    />
  );
}

function SourcesPanel(props: { readonly sides: Sides }) {
  return (
    <div class="space-y-3">
      <div class="grid gap-3 sm:grid-cols-2">
        {/* In the order the title and the columns read: the editor first when what is arriving comes second. */}
        <SidePicker sides={props.sides} side={props.sides.editorFirst() ? "left" : "right"} />
        <SidePicker sides={props.sides} side={props.sides.editorFirst() ? "right" : "left"} />
      </div>
      <Show when={props.sides.leftId() === props.sides.rightId()}>
        <p class="text-smallest text-on-surface-secondary">
          {m.review_pick_two_different_sides_a()}
        </p>
      </Show>
      <p class="text-smallest text-on-surface-tertiary">
        {m.review_a_decision_per_difference_one()}
      </p>
    </div>
  );
}

function HeaderNotices(props: { readonly header: ReviewHeaderProps }) {
  return (
    <>
      <Show
        when={
          props.header.sides.target() === undefined && props.header.compare.result() !== undefined
        }
      >
        <Badge tone="muted" data-review-readonly>
          {m.review_reading_only()}
        </Badge>
      </Show>
      <Show when={props.header.busy !== ""}>
        <span class="text-smallest text-on-surface-tertiary">{props.header.busy}</span>
      </Show>
      <Show when={props.header.note !== ""}>
        <span class="min-w-0 truncate text-smallest text-on-surface-error" data-review-note>
          {props.header.note}
        </span>
      </Show>
      <Show when={props.header.compare.diffRefusal()}>
        {(reason) => (
          <span
            class="text-smallest text-on-surface-error"
            data-review-engine="missing"
            title={reason()}
          >
            {m.review_this_builds_engine_has_no()}
          </span>
        )}
      </Show>
    </>
  );
}

function HeaderActions(props: { readonly header: ReviewHeaderProps }) {
  return (
    <div class="ms-auto flex items-center gap-1.5">
      <Show when={props.header.decisions.receipt() !== ""}>
        <span class="text-smallest text-on-surface-success" data-review-receipt>
          {props.header.decisions.receipt()}
        </span>
      </Show>
      <Show when={props.header.sides.target() !== undefined}>
        <Button
          size="sm"
          variant="primary"
          icon={<Save />}
          data-review-record
          disabled={props.header.form.unsaved().length === 0 && !props.header.sides.againstShared()}
          title={
            props.header.lastBackup === undefined
              ? m.review_write_and_keep_a_version()
              : m.review_write_and_keep_a_version_your({
                  when: ago(props.header.lastBackup ?? 0),
                })
          }
          onClick={props.header.form.openRecord}
        >
          {m.common_save()}
        </Button>
      </Show>
      <BackToEditor quiet />
    </div>
  );
}

export function ReviewHeader(props: ReviewHeaderProps) {
  return (
    <header class="flex min-h-12 min-w-0 flex-wrap items-center gap-2" data-review-header>
      <Popover
        label={m.review_what_is_compared()}
        align="start"
        class="w-[min(560px,90vw)]"
        open={props.sourcesOpen}
        onOpenChange={props.onSourcesOpenChange}
        trigger={
          <button
            type="button"
            data-review-sources
            title={m.review_change_what_is_compared()}
            class="-mx-1.5 inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-start transition-colors hover:bg-button-tertiary-surface-hover"
          >
            <h1 class="min-w-0 truncate text-h3 font-semibold text-on-surface-primary">
              {props.sourcesLabel}
            </h1>
            <ChevronDown size={18} aria-hidden="true" class="shrink-0 text-on-surface-tertiary" />
          </button>
        }
      >
        <SourcesPanel sides={props.sides} />
      </Popover>
      <HeaderNotices header={props} />

      <HeaderActions header={props} />
    </header>
  );
}
