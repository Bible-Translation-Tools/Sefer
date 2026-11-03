import { createSignal } from "solid-js";

import { m } from "#app/paraglide/messages";

import { collaboration } from "../../../collaboration";
import { describe } from "../../../describe";
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

type SetSendLine = (line: ReceiptLine | "sending" | undefined) => void;

function lineOfSend(shell: Shell, outcome: SendOutcome): ReceiptLine | undefined {
  const project = shell.project();
  if (outcome.kind === "detached") return undefined;
  const copy = sendOutcomeCopy(outcome, syncWatch.sync(project?.root)?.state);
  if (outcome.kind === "sent" && outcome.toCopy === true) {
    const waiting = collaboration.facts(project?.root)?.mine?.kind === "waiting";
    return waiting
      ? {
          ...copy,
          detail: m.review_your_open_suggestion_now_includes(),
        }
      : {
          ...copy,
          detail: m.review_offer_them_to_the_shared(),
          action: "offer",
        };
  }
  const action = sendAction(outcome);
  return { ...copy, ...(action === undefined ? {} : { action }) };
}

function offerChanges(
  services: Services,
  project: NonNullable<ReturnType<Shell["project"]>>,
  setSendLine: SetSendLine,
): void {
  setSendLine("sending");
  void suggestMyChanges(services, project)
    .then(() =>
      setSendLine({
        tone: "success",
        title: m.review_offered_to_the_shared_project(),
        detail: m.review_the_projects_editors_will_see(),
      }),
    )
    .catch((cause: unknown) => {
      const needed = reviewNeeded(cause);
      const said = needed === undefined ? undefined : offerRefusalCopy(needed);
      setSendLine(
        needed !== undefined && said !== undefined
          ? {
              tone: "warning",
              title: m.review_not_offered_yet_why({ why: said.title }),
              detail: said.message,
              action: needed.copy ? "copy" : "see",
            }
          : {
              tone: "error",
              title: m.review_could_not_offer_your_changes(),
              detail: describe(cause),
              action: "offer",
            },
      );
    })
    .finally(() => void collaboration.refresh(services, project));
}

function createReceiptAction(
  inputs: ReceiptInputs,
  closeRecord: () => void,
  follow: (sending: Promise<SendOutcome> | undefined) => void,
  setSendLine: SetSendLine,
) {
  const { shell, services, navigate } = inputs;
  const { seeShared, seeCopy } = inputs.sides;
  return (action: ReceiptAction): void => {
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
        offerChanges(services, project, setSendLine);
        return;
    }
  };
}

export function createReceipt(inputs: ReceiptInputs) {
  const { shell } = inputs;
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

  const follow = (sending: Promise<SendOutcome> | undefined): void => {
    if (sending === undefined) return;
    setSendLine("sending");
    void sending.then((outcome) => setSendLine(lineOfSend(shell, outcome)));
  };

  return {
    recordedLine,
    setRecordedLine,
    sendLine,
    setSendLine,
    sentLine,
    closeRecord,
    lineOfSend: (outcome: SendOutcome): ReceiptLine | undefined => lineOfSend(shell, outcome),
    follow,
    receiptAction: createReceiptAction(inputs, closeRecord, follow, setSendLine),
  };
}

export type Receipt = ReturnType<typeof createReceipt>;
