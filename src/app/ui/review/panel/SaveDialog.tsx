import Save from "lucide-solid/icons/save";
import { Show } from "solid-js";

import { t } from "../../../i18n";
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
          {t("Done")}
        </Button>
      }
    >
      <Button variant="tertiary" onClick={() => props.dialog.form.setRecordOpen(false)}>
        {t("Cancel")}
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
        {t("Save")}
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
              {t("Sending to the shared project…")}
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
        <p class="text-small text-on-surface-secondary">
          {t(
            "You kept none of the suggested changes, so there is nothing to bring in. Decline the suggestion instead; its author reads your note.",
          )}
        </p>
        <Show when={props.dialog.form.unsaved().length > 0}>
          <p class="text-smallest text-on-surface-tertiary">
            {t("Edits you typed here stay unsaved; save them from Changes afterwards.")}
          </p>
        </Show>
        <div class="flex items-center gap-2">
          <Input
            wrapperClass="min-w-0 flex-1"
            placeholder={t("Why? (optional)")}
            value={props.dialog.record.declineNote()}
            onInput={(event) => props.dialog.record.setDeclineNote(event.currentTarget.value)}
          />
          <Button type="submit" variant="secondary" loading={props.dialog.record.recording()}>
            {t("Decline")}
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
          {t(
            "{count} passage(s) changed in both places still need a choice: keep yours or take the shared project's.",
            { count: props.dialog.units.undecidedBoth() },
          )}
        </p>
      </Show>
      <Show when={props.dialog.form.author() === undefined}>
        <label
          class="block pb-1 text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase"
          for="author-name"
        >
          {t("Your name, as your team knows you")}
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
        {t("What did you change?")}
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
        {t("Your team sees this, and so will you later.")}
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
              {t("Close the suggestion as brought in")}
            </span>
            <span class="block text-smallest text-on-surface-tertiary">
              {t("Turn off to keep it open — when you are taking part of it now and more later.")}
            </span>
          </span>
          <Switch
            aria-label={t("Close the suggestion as brought in")}
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
        props.form.setRecordOpen(open);
        if (!open) {
          props.receipt.setRecordedLine(undefined);
          props.receipt.setSendLine(undefined);
        }
      }}
      title={t("Save")}
      description={props.form.saveDescription()}
      footer={<SaveFooter dialog={props} />}
    >
      <SaveReceipt dialog={props} />
      <DeclineForm dialog={props} />
      <SaveFields dialog={props} />
    </Dialog>
  );
}
