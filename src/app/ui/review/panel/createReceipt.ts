import { createSignal } from "solid-js";

import { m } from "#app/paraglide/messages";
import { stepRecord, type RecordEvent, type RecordPhase } from "#core/save/recordPhase";

import { collaboration } from "../../../collaboration";
import { describe } from "../../../describe";
import type { Navigate, Shell } from "../../../ProjectContext";
import type { Services } from "../../../services";
import { reviewNeeded, suggestMyChanges } from "../../../suggestions";
import { sendNow, type SendOutcome } from "../../../syncActions";
import { syncWatch } from "../../../syncWatch";
import { offerRefusalCopy, sendOutcomeCopy } from "../../cloud/copy";
import { putOnline, suggestedName } from "../../cloud/PublishSection";
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
  if (outcome.kind === "detached") return project === undefined ? undefined : onlyHere(project);
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

function onlyHere(project: NonNullable<ReturnType<Shell["project"]>>): ReceiptLine {
  const signedIn = syncWatch.sync(project.root)?.reading.signedIn === true;
  return signedIn
    ? {
        tone: "muted",
        title: m.review_kept_on_this_device_only(),
        detail: m.review_put_it_online_to_keep({ name: suggestedName(project) }),
        action: "publish",
      }
    : {
        tone: "muted",
        title: m.review_kept_on_this_device_only(),
        detail: m.review_sign_in_to_wacs_to_keep(),
        action: "open",
      };
}

function publishHere(
  services: Services,
  project: NonNullable<ReturnType<Shell["project"]>>,
  setSendLine: SetSendLine,
): void {
  const name = suggestedName(project);
  setSendLine("sending");
  void putOnline(services, project, name)
    .then(() =>
      setSendLine({
        tone: "success",
        title: m.review_online_as_name({ name }),
        detail: m.review_it_is_in_your_wacs(),
      }),
    )
    .catch((cause: unknown) =>
      setSendLine({
        tone: "error",
        title: m.review_could_not_put_it_online(),
        detail: m.cloud_your_work_is_safe_on({
          description: describe(cause),
        }),
        action: "publish",
      }),
    );
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
              title: m.common_could_not_offer_your_changes(),
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
      case "publish":
        publishHere(services, project, setSendLine);
        return;
    }
  };
}

export function createReceipt(inputs: ReceiptInputs) {
  const { shell } = inputs;
  const { setRecordOpen } = inputs.form;
  // The one phase of a record: `src/core/save/recordPhase.ts`. Everything below reads it or sends to it.
  const [phase, setPhase] = createSignal<RecordPhase<ReceiptLine>>(
    { kind: "editing" },
    { name: "reviewRecordPhase" },
  );
  // The plain value is the truth and the signal draws it: Solid 2 batches writes, so a second
  // press in the same instant would still read the old signal.
  let now: RecordPhase<ReceiptLine> = { kind: "editing" };
  const send = (event: RecordEvent<ReceiptLine>): void => {
    now = stepRecord(now, event);
    setPhase(now);
  };

  const recording = (): boolean => phase().kind === "recording";
  const recordedLine = (): ReceiptLine | undefined => {
    const held = phase();
    return held.kind === "recorded" ? held.line : undefined;
  };
  const sendLine = (): ReceiptLine | "sending" | undefined => {
    const held = phase();
    return held.kind === "recorded" ? held.send : undefined;
  };
  const setRecordedLine = (line: ReceiptLine): void => send({ kind: "answered", line });
  const setSendLine: SetSendLine = (line) =>
    send(line === "sending" ? { kind: "sending" } : { kind: "sent", line });

  const closeRecord = (): void => {
    setRecordOpen(false);
    send({ kind: "close" });
  };

  const sentLine = (): ReceiptLine | undefined => {
    const held = sendLine();
    return held === "sending" ? undefined : held;
  };

  const follow = (sending: Promise<SendOutcome> | undefined): void => {
    if (sending === undefined) return;
    setSendLine("sending");
    void sending.then(
      (outcome) => setSendLine(lineOfSend(shell, outcome)),
      (cause: unknown) =>
        setSendLine({
          tone: "warning",
          title: m.review_saved_here_not_sent_yet(),
          detail: describe(cause),
          action: "retry",
        }),
    );
  };

  return {
    recording,
    /** Whether a run is in flight right now, for a guard; `recording` is the same for drawing. */
    inFlight: (): boolean => now.kind === "recording",
    start: (): void => send({ kind: "start" }),
    stopped: (): void => send({ kind: "stopped" }),
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
