import Save from "lucide-solid/icons/save";
import { Show } from "solid-js";

import { m } from "#app/paraglide/messages";

import { Button, Dialog, Input, Switch } from "../../primitives";
import type { Receipt } from "./createReceipt";
import type { RecordAction } from "./createRecordAction";
import type { ReviewRoute } from "./createReviewRoute";
import type { SaveForm } from "./createSaveForm";
import type { Sides } from "./createSides";
import type { Units } from "./createUnits";
import { ReceiptView } from "./ReceiptView";

interface SaveDialogProps {
  readonly form: SaveForm;
  readonly receipt: Receipt;
  readonly record: RecordAction;
  readonly route: ReviewRoute;
  readonly sides: Sides;
  readonly units: Units;
  readonly onDone: () => void;
}

function SaveFooter(props: { readonly dialog: SaveDialogProps }) {
  return (
    <Show
      when={props.dialog.receipt.recordedLine() === undefined}
      fallback={
        <Button
          variant="primary"
          disabled={props.dialog.receipt.sendLine() === "sending"}
          data-review-record-done
          onClick={props.dialog.onDone}
        >
          {m.common_done()}
        </Button>
      }
    >
      <Button variant="tertiary" onClick={() => props.dialog.form.setRecordOpen(false)}>
        {m.common_cancel()}
      </Button>
      <Button
        variant="primary"
        icon={<Save />}
        loading={props.dialog.record.recording()}
        disabled={
          (props.dialog.form.unsaved().length === 0 && !props.dialog.sides.againstShared()) ||
          props.dialog.units.undecidedBoth() > 0 ||
          props.dialog.units.declineOnly()
        }
        data-review-record-confirm
        onClick={() => void props.dialog.record.record()}
      >
        {m.common_save()}
      </Button>
    </Show>
  );
}

function SaveReceipt(props: { readonly dialog: SaveDialogProps }) {
  return (
    <Show when={props.dialog.receipt.recordedLine()}>
      {(line) => (
        <div class="space-y-3" data-review-record-receipt>
          <ReceiptView line={line()} onAction={props.dialog.receipt.receiptAction} />
          <Show when={props.dialog.receipt.sendLine() === "sending"}>
            <div class="flex items-center gap-2 text-small text-on-surface-secondary">
              <span
                aria-hidden="true"
                class="size-4 animate-spin rounded-full border-2 border-on-surface-tertiary border-t-transparent"
              />
              {m.review_sending_to_the_shared_project()}
            </div>
          </Show>
          <Show when={props.dialog.receipt.sentLine()}>
            {(sent) => <ReceiptView line={sent()} onAction={props.dialog.receipt.receiptAction} />}
          </Show>
        </div>
      )}
    </Show>
  );
}

function DeclineForm(props: { readonly dialog: SaveDialogProps }) {
  return (
    <Show
      when={props.dialog.receipt.recordedLine() === undefined && props.dialog.units.declineOnly()}
    >
      <form
        class="space-y-3"
        data-review-decline-only
        onSubmit={(event) => {
          event.preventDefault();
          props.dialog.record.declineFromDialog();
        }}
      >
        <p class="text-small text-on-surface-secondary">{m.review_you_kept_none_of_the()}</p>
        <Show when={props.dialog.form.unsaved().length > 0}>
          <p class="text-smallest text-on-surface-tertiary">
            {m.review_edits_you_typed_here_stay()}
          </p>
        </Show>
        <div class="flex items-center gap-2">
          <Input
            wrapperClass="min-w-0 flex-1"
            placeholder={m.review_why_optional()}
            value={props.dialog.record.declineNote()}
            onInput={(event) => props.dialog.record.setDeclineNote(event.currentTarget.value)}
          />
          <Button type="submit" variant="secondary" loading={props.dialog.record.recording()}>
            {m.common_decline()}
          </Button>
        </div>
      </form>
    </Show>
  );
}

function SaveFields(props: { readonly dialog: SaveDialogProps }) {
  return (
    <Show
      when={props.dialog.receipt.recordedLine() === undefined && !props.dialog.units.declineOnly()}
    >
      <Show when={props.dialog.units.undecidedBoth() > 0}>
        <p class="pb-3 text-small text-on-surface-warning" data-review-undecided>
          {m.review_passages_changed_in_both_places_choice({
            count: props.dialog.units.undecidedBoth(),
          })}
        </p>
      </Show>
      <Show when={props.dialog.form.author() === undefined}>
        <label
          class="block pb-1 text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase"
          for="author-name"
        >
          {m.review_your_name_as_your_team()}
        </label>
        <Input
          id="author-name"
          wrapperClass="w-full pb-3"
          value={props.dialog.form.typedName()}
          onInput={(event) => props.dialog.form.setTypedName(event.currentTarget.value)}
        />
      </Show>
      <label
        class="block pb-1 text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase"
        for="commit-message"
      >
        {m.review_what_did_you_change()}
      </label>
      <Input
        id="commit-message"
        wrapperClass="w-full"
        placeholder={props.dialog.form.defaultMessage()}
        value={props.dialog.form.message()}
        onInput={(event) => props.dialog.form.setMessage(event.currentTarget.value)}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key !== "Enter" || event.isComposing) return;
          event.preventDefault();
          if (props.dialog.form.unsaved().length > 0 || props.dialog.sides.againstShared())
            void props.dialog.record.record();
        }}
      />
      <p class="pt-1 text-smallest text-on-surface-tertiary">
        {m.review_your_team_sees_this_and()}
      </p>
      <Show when={props.dialog.form.sends()}>
        <p class="pt-3 text-small text-on-surface-secondary" data-review-sends>
          {props.dialog.form.sendsLine()}
        </p>
      </Show>
      <Show when={props.dialog.route.pull() !== undefined}>
        <label class="flex items-start justify-between gap-3 pt-3" data-review-close-suggestion>
          <span>
            <span class="block text-small font-medium">
              {m.review_close_the_suggestion_as_brought()}
            </span>
            <span class="block text-smallest text-on-surface-tertiary">
              {m.review_turn_off_to_keep_it()}
            </span>
          </span>
          <Switch
            aria-label={m.review_close_the_suggestion_as_brought()}
            checked={props.dialog.form.closeOnSave()}
            onChange={props.dialog.form.setCloseOnSave}
          />
        </label>
      </Show>
    </Show>
  );
}

export function SaveDialog(props: SaveDialogProps) {
  return (
    <Dialog
      open={props.form.recordOpen()}
      onOpenChange={(open) => {
        if (open) props.form.setRecordOpen(true);
        else props.receipt.closeRecord();
      }}
      title={m.common_save()}
      description={
        props.receipt.recordedLine() === undefined ? props.form.saveDescription() : undefined
      }
      footer={<SaveFooter dialog={props} />}
    >
      <SaveReceipt dialog={props} />
      <DeclineForm dialog={props} />
      <SaveFields dialog={props} />
    </Dialog>
  );
}
