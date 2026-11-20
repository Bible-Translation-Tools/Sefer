import ChevronDown from "lucide-solid/icons/chevron-down";
import CircleHelp from "lucide-solid/icons/circle-help";
import Save from "lucide-solid/icons/save";
import { Match, Show, Switch, createSignal, onCleanup } from "solid-js";

import { m } from "#app/paraglide/messages";

import { Badge, Button, Popover, Tooltip } from "../../primitives";
import { useBackToEditor } from "../../workspace/BackToEditor";
import { bookCount, changeCount } from "../reader/helpers";
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
  readonly busy: string;
  readonly note: string;
  /** How the person got here, which the subtitle answers: Review is no longer reached only from Save. */
  readonly reason: ReviewReason;
  readonly changes: number;
  readonly books: number;
  /** DESIGN SCAFFOLDING: the inline layout draws the title and the actions apart, in its card list. */
  readonly part?: "title" | "actions";
  /** DESIGN SCAFFOLDING: false keeps Save greyed out, as the inline layout does until every change is decided. */
  readonly saveReady?: boolean;
}

export type ReviewReason = "unsaved" | "suggestion" | "copy" | "incoming" | "writer" | "other";

function why(reason: ReviewReason, changes: number, books: number): string {
  if (changes === 0) return m.review_both_sides_hold_exactly_the();
  const words = { changes: changeCount(changes), books: bookCount(books) };
  switch (reason) {
    case "unsaved":
      return m.review_why_unsaved(words);
    case "suggestion":
      return m.review_why_suggestion(words);
    case "copy":
      return m.review_why_copy(words);
    case "incoming":
      return m.review_why_incoming(words);
    case "writer":
      return m.review_why_writer(words);
    default:
      return m.review_why_other(words);
  }
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

/** What is compared, and the door to change it: another version from history, a zip, the shared project. */
function SourcesPopover(props: { readonly sides: Sides }) {
  const label = (): string =>
    props.sides.editorFirst()
      ? `${props.sides.leftLabel()} → ${props.sides.rightLabel()}`
      : `${props.sides.rightLabel()} → ${props.sides.leftLabel()}`;
  return (
    <Popover
      label={m.review_what_is_compared()}
      align="start"
      class="w-[min(35rem,90vw)]"
      trigger={
        <button
          type="button"
          data-review-sources
          title={m.review_change_what_is_compared()}
          class="-mx-1.5 inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-start text-smallest text-on-surface-secondary transition-colors hover:bg-button-tertiary-surface-hover"
        >
          <span class="min-w-0 truncate">{label()}</span>
          <ChevronDown size={14} aria-hidden="true" class="shrink-0 text-on-surface-tertiary" />
        </button>
      }
    >
      <div class="space-y-3">
        <div class="grid gap-3 sm:grid-cols-2">
          {/* In the order the label reads: the editor first when what is arriving comes second. */}
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
    </Popover>
  );
}

function HeaderNotices(props: { readonly header: ReviewHeaderProps }) {
  return (
    <>
      <SourcesPopover sides={props.header.sides} />
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
  const back = useBackToEditor();
  // DESIGN SCAFFOLDING: the inline layout's "finish first" note, shown for a moment on a click.
  const [whyNot, setWhyNot] = createSignal(false, { name: "reviewSaveWhyNot" });
  let hide: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(hide));
  return (
    <div class="ms-auto flex items-center gap-2">
      <Show when={props.header.decisions.receipt() !== ""}>
        <span class="text-smallest text-on-surface-success" data-review-receipt>
          {props.header.decisions.receipt()}
        </span>
      </Show>
      <Show when={props.header.sides.target() !== undefined}>
        <span class="relative inline-flex">
          <Button
            size="md"
            variant="primary"
            icon={<Save />}
            data-review-record
            // Not yet ready reads as disabled but still takes the click, to say why.
            aria-disabled={props.header.saveReady === false ? "true" : undefined}
            class="aria-disabled:border-surface-border aria-disabled:bg-surface-secondary"
            disabled={
              props.header.form.unsaved().length === 0 &&
              !props.header.form.namesQueued() &&
              !props.header.sides.againstShared()
            }
            title={m.review_write_and_keep_a_version()}
            onClick={() => {
              if (props.header.saveReady !== false) {
                props.header.form.openRecord();
                return;
              }
              setWhyNot(true);
              clearTimeout(hide);
              hide = setTimeout(() => setWhyNot(false), 3000);
            }}
          >
            {m.common_save()}
          </Button>
          <Show when={whyNot()}>
            <span
              role="status"
              class="absolute top-full left-0 z-20 mt-2 w-60 rounded-md bg-on-surface-primary px-3 py-2 text-smallest text-surface-primary shadow-medium"
              data-review-save-why
            >
              {m.review_finish_every_change_before_save()}
            </span>
          </Show>
        </span>
      </Show>
      <Show when={back()}>
        {(door) => (
          <Button
            size="md"
            variant="secondary"
            data-testid="back-to-editor"
            title={door().label}
            onClick={() => door().go()}
          >
            {m.common_cancel()}
          </Button>
        )}
      </Show>
    </div>
  );
}

function HeaderTitle(props: { readonly header: ReviewHeaderProps }) {
  return (
    <>
      <h1 class="text-h3 font-semibold text-on-surface-primary">{m.review_review_changes()}</h1>
      <p class="max-w-prose text-small text-on-surface-secondary" data-review-why>
        {why(props.header.reason, props.header.changes, props.header.books)}
      </p>
      <div class="flex min-w-0 flex-wrap items-center gap-2 empty:hidden">
        <HeaderNotices header={props.header} />
      </div>
    </>
  );
}

export function ReviewHeader(props: ReviewHeaderProps) {
  return (
    <Switch
      fallback={
        <header class="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2" data-review-header>
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <HeaderTitle header={props} />
          </div>
          <HeaderActions header={props} />
        </header>
      }
    >
      <Match when={props.part === "title"}>
        <div class="flex min-w-0 flex-col gap-1" data-review-header>
          <div class="flex items-center gap-2">
            <h1 class="text-h3 font-semibold text-on-surface-primary">
              {m.review_review_changes()}
            </h1>
            <Tooltip label={why(props.reason, props.changes, props.books)} side="bottom">
              <span
                tabindex={0}
                aria-label={why(props.reason, props.changes, props.books)}
                class="grid size-6 cursor-help place-items-center rounded-full text-on-surface-secondary hover:bg-surface-secondary"
                data-review-why
              >
                <CircleHelp size={18} aria-hidden="true" />
              </span>
            </Tooltip>
          </div>
          <div class="flex min-w-0 flex-wrap items-center gap-2 empty:hidden">
            <HeaderNotices header={props} />
          </div>
        </div>
      </Match>
      <Match when={props.part === "actions"}>
        <HeaderActions header={props} />
      </Match>
    </Switch>
  );
}
