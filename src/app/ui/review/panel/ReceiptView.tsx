import CircleCheck from "lucide-solid/icons/circle-check";
import CircleX from "lucide-solid/icons/circle-x";
import Info from "lucide-solid/icons/info";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import { Show } from "solid-js";

import { t } from "../../../i18n";
import { Button } from "../../primitives";
import type { ReceiptAction, ReceiptLine } from "./helpers";

export function ReceiptView(props: {
  readonly line: ReceiptLine;
  readonly onAction: (action: ReceiptAction) => void;
}) {
  const glyph = () => {
    switch (props.line.tone) {
      case "success":
        return <CircleCheck size={18} class="text-on-surface-success" />;
      case "warning":
        return <TriangleAlert size={18} class="text-on-surface-warning" />;
      case "error":
        return <CircleX size={18} class="text-on-surface-error" />;
      case "muted":
        return <Info size={18} class="text-on-surface-tertiary" />;
    }
  };
  const label = (action: ReceiptAction): string => {
    switch (action) {
      case "see":
        return t("Compare the changes");
      case "copy":
        return t("Compare with your copy");
      case "retry":
        return t("Try sending again");
      case "send":
        return t("Send now");
      case "open":
        return t("Set up sharing");
      case "offer":
        return t("Offer these changes");
    }
  };
  return (
    <div class="flex items-start gap-2" data-receipt-tone={props.line.tone}>
      <span aria-hidden="true" class="mt-0.5 inline-flex">
        {glyph()}
      </span>
      <div class="min-w-0 flex-1 space-y-1">
        <p class="text-small font-medium text-on-surface-primary">{props.line.title}</p>
        <Show when={props.line.detail}>
          {(detail) => <p class="text-small text-on-surface-secondary">{detail()}</p>}
        </Show>
        <Show when={props.line.action}>
          {(action) => (
            <Button
              size="sm"
              variant={
                action() === "see" || action() === "copy" || action() === "offer"
                  ? "primary"
                  : "secondary"
              }
              data-receipt-action={action()}
              onClick={() => props.onAction(action())}
            >
              {label(action())}
            </Button>
          )}
        </Show>
      </div>
    </div>
  );
}
