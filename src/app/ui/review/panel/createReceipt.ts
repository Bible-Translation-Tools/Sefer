import { createSignal } from "solid-js";

import { collaboration } from "../../../collaboration";
import { describe } from "../../../describe";
import { t } from "../../../i18n";
import type { Navigate, Shell } from "../../../ProjectContext";
import type { Services } from "../../../services";
import { reviewNeeded, suggestMyChanges } from "../../../suggestions";
import { sendNow, type SendOutcome } from "../../../syncActions";
import { syncWatch } from "../../../syncWatch";
import { offerRefusalCopy, sendOutcomeCopy } from "../../cloud/copy";
import type { SaveForm } from "./createSaveForm";
import type { Sides } from "./createSides";
import { sendAction, type ReceiptAction, type ReceiptLine } from "./helpers";

export interface ReceiptInputs {
  readonly shell: Shell;
  readonly services: Services;
  readonly navigate: Navigate;
  readonly sides: Sides;
  readonly form: SaveForm;
}

export function createReceipt(inputs: ReceiptInputs) {
  const { shell, services, navigate } = inputs;
  const { seeShared, seeCopy } = inputs.sides;
  const { setRecordOpen } = inputs.form;
  const [recordedLine, setRecordedLine] = createSignal<ReceiptLine | undefined>(undefined, {
    name: "reviewRecordedLine",
  });
  const [sendLine, setSendLine] = createSignal<ReceiptLine | "sending" | undefined>(undefined, {
    name: "reviewSendLine",
  });

  const closeRecord = (): void => {
    setRecordOpen(false);
    setRecordedLine(undefined);
    setSendLine(undefined);
  };

  const sentLine = (): ReceiptLine | undefined => {
    const held = sendLine();
    return held === "sending" ? undefined : held;
  };

  const lineOfSend = (outcome: SendOutcome): ReceiptLine | undefined => {
    const project = shell.project();
    if (outcome.kind === "detached") return undefined;
    const copy = sendOutcomeCopy(outcome, syncWatch.sync(project?.root)?.state);
    if (outcome.kind === "sent" && outcome.toCopy === true) {
      const waiting = collaboration.facts(project?.root)?.mine?.kind === "waiting";
      return waiting
        ? {
            ...copy,
            detail: t("Your open suggestion now includes these changes."),
          }
        : {
            ...copy,
            detail: t("Offer them to the shared project when they are ready."),
            action: "offer",
          };
    }
    const action = sendAction(outcome);
    return { ...copy, ...(action === undefined ? {} : { action }) };
  };

  const follow = (sending: Promise<SendOutcome> | undefined): void => {
    if (sending === undefined) return;
    setSendLine("sending");
    void sending.then((outcome) => setSendLine(lineOfSend(outcome)));
  };

  const receiptAction = (action: ReceiptAction): void => {
    const project = shell.project();
    if (project === undefined) return;
    switch (action) {
      case "see":
        closeRecord();
        seeShared();
        return;
      case "copy":
        closeRecord();
        seeCopy();
        return;
      case "open":
        closeRecord();
        void navigate({ to: "/project/$slug/settings", params: { slug: shell.slug() } });
        return;
      case "retry":
      case "send":
        follow(sendNow(services, project));
        return;
      case "offer":
        setSendLine("sending");
        void suggestMyChanges(services, project)
          .then(() =>
            setSendLine({
              tone: "success",
              title: t("Offered to the shared project"),
              detail: t(
                "The project's editors will see your changes. Later sends add to the same suggestion.",
              ),
            }),
          )
          .catch((cause: unknown) => {
            const needed = reviewNeeded(cause);
            const said = needed === undefined ? undefined : offerRefusalCopy(needed);
            setSendLine(
              needed !== undefined && said !== undefined
                ? {
                    tone: "warning",
                    title: t("Not offered yet: {why}", { why: said.title }),
                    detail: said.message,
                    action: needed.copy ? "copy" : "see",
                  }
                : {
                    tone: "error",
                    title: t("Could not offer your changes"),
                    detail: describe(cause),
                    action: "offer",
                  },
            );
          })
          .finally(() => void collaboration.refresh(services, project));
        return;
    }
  };

  return {
    recordedLine,
    setRecordedLine,
    sendLine,
    setSendLine,
    sentLine,
    closeRecord,
    lineOfSend,
    follow,
    receiptAction,
  };
}

export type Receipt = ReturnType<typeof createReceipt>;
