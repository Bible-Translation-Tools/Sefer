import { Effect } from "effect";
import { createSignal, untrack } from "solid-js";

import { collaboration } from "../../../collaboration";
import { describe } from "../../../describe";
import { t } from "../../../i18n";
import type { Navigate, Shell } from "../../../ProjectContext";
import { recordVersion } from "../../../recordVersion";
import type { Services } from "../../../services";
import { acceptSuggestion, declineSuggestion } from "../../../suggestions";
import { sendAfterSave, settleWithShared } from "../../../syncActions";
import { setAuthorName } from "../../../syncSettings";
import { forgetWriterWork, takeWriterWork, writerWatch } from "../../../writerWatch";
import { combineTrouble } from "../../cloud/copy";
import { toasts } from "../../primitives";
import { bookName } from "../../workspace/books";
import { metadataOf } from "../../workspace/project";
import type { Decisions } from "./createDecisions";
import type { Receipt } from "./createReceipt";
import type { ReviewRoute } from "./createReviewRoute";
import type { SaveForm } from "./createSaveForm";
import type { Sides } from "./createSides";
import type { Units } from "./createUnits";
import type { Writes } from "./createWrites";
import { refusedDetail, settledMessage } from "./helpers";

export interface RecordActionInputs {
  readonly shell: Shell;
  readonly services: Services;
  readonly navigate: Navigate;
  readonly route: ReviewRoute;
  readonly sides: Sides;
  readonly decisions: Decisions;
  readonly units: Units;
  readonly writes: Writes;
  readonly form: SaveForm;
  readonly receipt: Receipt;
}

type Project = NonNullable<ReturnType<Shell["project"]>>;
type SettleOutcome = Awaited<ReturnType<typeof settleWithShared>>;

interface RecordState {
  readonly recording: () => boolean;
  readonly setRecording: (value: boolean) => void;
}

interface Settling {
  readonly project: Project;
  readonly by: { name: string; email: string };
  readonly staticMessage: string;
  readonly staticNote: string;
  readonly copyReview: boolean;
}

function declineFromDialog(
  inputs: RecordActionInputs,
  state: RecordState,
  declineNote: () => string,
): void {
  const { shell, services, navigate } = inputs;
  const project = shell.project();
  const number = inputs.route.pull();
  if (project === undefined || number === undefined || state.recording()) return;
  const staticNote = declineNote();
  state.setRecording(true);
  declineSuggestion(services, project, { number }, staticNote)
    .then(() => {
      toasts.success({
        title: t("Declined"),
        message:
          staticNote.trim() === ""
            ? t("The suggestion is closed; its author sees it was not brought in.")
            : t("Its author can read your note."),
      });
      inputs.receipt.closeRecord();
      void collaboration.refresh(services, project);
      void navigate({ to: "/project/$slug/suggestions", params: { slug: shell.slug() } });
    })
    .catch((cause: unknown) =>
      toasts.error({ title: t("Could not decline it"), message: describe(cause) }),
    )
    .finally(() => state.setRecording(false));
}

function settleOptions(
  inputs: RecordActionInputs,
  copyReview: boolean,
): { theirs?: ReturnType<RecordActionInputs["route"]["theirsRef"]>; sendTo?: "origin" } {
  const { pull, theirsRef } = inputs.route;
  if (pull() !== undefined) return { theirs: theirsRef(), sendTo: "origin" };
  return copyReview ? { theirs: theirsRef() } : {};
}

function combinedLine(settling: Settling) {
  return {
    tone: "success" as const,
    title: settling.copyReview
      ? t("Combined with your copy on this device")
      : t("Combined with the shared project on this device"),
    detail: settling.staticMessage,
  };
}

function settledDone(inputs: RecordActionInputs): void {
  const { version, shared, common } = inputs.sides;
  inputs.form.setMessage("");
  inputs.decisions.startOver();
  version.refresh();
  shared.refresh();
  common.refresh();
}

function markTakenFor(
  inputs: RecordActionInputs,
  settling: Settling,
  accepted: ReturnType<ReviewRoute["pull"]>,
): (sent: boolean) => void {
  const { services } = inputs;
  const { project, staticNote } = settling;
  return (sent) => {
    if (accepted === undefined || !sent) return;
    acceptSuggestion(services, project, accepted, staticNote)
      .then(() => inputs.form.setBroughtIn(true))
      .catch((cause: unknown) =>
        toasts.error({
          title: t("Brought in, but the suggestion is still open on the shared project"),
          message: describe(cause),
        }),
      )
      .finally(() => void collaboration.refresh(services, project));
  };
}

function reportReceived(
  inputs: RecordActionInputs,
  settling: Settling,
  outcome: Extract<SettleOutcome, { kind: "received" }>,
  markTaken: (sent: boolean) => void,
): void {
  const { shell } = inputs;
  const { project } = settling;
  const { setRecordedLine, follow } = inputs.receipt;
  switch (outcome.recorded.kind) {
    case "recorded":
    case "nothing":
      shell.noteWritten(
        project.books.map((book) => book.id),
        true,
      );
      setRecordedLine(combinedLine(settling));
      follow(outcome.sending);
      void outcome.sending?.then((sent) => markTaken(sent.kind === "sent"));
      settledDone(inputs);
      break;
    case "not-recorded":
      shell.noteWritten(outcome.recorded.books, false);
      setRecordedLine({
        tone: "error",
        title: t("Updates received; your decisions are on disk, but not recorded"),
        detail: describe(outcome.recorded.error),
      });
      settledDone(inputs);
      break;
    case "not-written":
      setRecordedLine({
        tone: "error",
        title: t("Updates received; your decisions could not be written"),
        detail: describe(outcome.recorded.error),
      });
      settledDone(inputs);
      break;
  }
}

function reportSettled(
  inputs: RecordActionInputs,
  settling: Settling,
  outcome: SettleOutcome,
  markTaken: (sent: boolean) => void,
): void {
  const { setRecordedLine, setSendLine, lineOfSend } = inputs.receipt;
  switch (outcome.kind) {
    case "refused":
      setRecordedLine({
        tone: "error",
        title: t("Not combined"),
        detail: refusedDetail(outcome),
      });
      break;
    case "combined":
      inputs.shell.noteWritten(
        settling.project.books.map((book) => book.id),
        true,
      );
      setRecordedLine(combinedLine(settling));
      markTaken(outcome.sent);
      setSendLine(
        outcome.sent
          ? lineOfSend(outcome.to === "copy" ? { kind: "sent", toCopy: true } : { kind: "sent" })
          : {
              tone: "warning",
              title: t("Saved here. Not sent yet"),
              detail: combineTrouble("recorded"),
              action: "retry",
            },
      );
      settledDone(inputs);
      break;
    case "received":
      reportReceived(inputs, settling, outcome, markTaken);
      break;
  }
}

async function recordAgainstShared(inputs: RecordActionInputs, settling: Settling): Promise<void> {
  const { services } = inputs;
  const { reviewBooks, preset } = inputs.units;
  const { decisionFor } = inputs.decisions;
  for (const book of reviewBooks()) {
    const taking = book.skeleton.units.filter(
      (unit) =>
        unit.status !== "unchanged" &&
        decisionFor(book.bookId, unit.id) === undefined &&
        preset(book.bookId, unit) === "baseline",
    );
    if (taking.length > 0) inputs.writes.writeNow(book.bookId, taking, "baseline");
  }
  const settled = new Set(reviewBooks().map((book) => book.bookId));
  const outcome = await settleWithShared(
    services,
    settling.project,
    settling.by,
    settling.staticMessage,
    settled,
    settleOptions(inputs, settling.copyReview),
  );
  const accepted = untrack(inputs.form.closeOnSave) ? inputs.route.pull() : undefined;
  reportSettled(inputs, settling, outcome, markTakenFor(inputs, settling, accepted));
}

function reportRecorded(
  inputs: RecordActionInputs,
  project: Project,
  staticMessage: string,
  outcome: Awaited<ReturnType<typeof recordVersion>>,
): void {
  const { shell, services } = inputs;
  const { setRecordedLine, follow } = inputs.receipt;
  switch (outcome.kind) {
    case "nothing":
      setRecordedLine({ tone: "muted", title: t("Nothing to record") });
      break;
    case "not-written":
      setRecordedLine({
        tone: "error",
        title: t("Could not write to disk"),
        detail: describe(outcome.error),
      });
      break;
    case "not-recorded":
      shell.noteWritten(outcome.books, false);
      setRecordedLine({
        tone: "error",
        title: t("On disk, but not recorded"),
        detail: describe(outcome.error),
      });
      break;
    case "recorded":
      shell.noteWritten(outcome.books, true);
      setRecordedLine({
        tone: "success",
        title: t("Recorded {count} book(s) on this device", { count: outcome.receipts }),
        detail: `${staticMessage} · ${outcome.commit.slice(0, 7)}`,
      });
      inputs.form.setMessage("");
      inputs.sides.version.refresh();
      follow(sendAfterSave(services, project));
      break;
  }
}

async function recordPlain(
  inputs: RecordActionInputs,
  settling: Settling,
  review: ReturnType<SaveForm["unsaved"]>,
  typedMessage: string,
): Promise<void> {
  const { services } = inputs;
  const { project, by, staticMessage } = settling;
  const books = review.map((entry) => entry.book);
  const writerBooks = inputs.sides.againstWriter()
    ? writerWatch.facts(project.root).work.map((each) => each.book)
    : [];
  const writerFile =
    writerBooks.length === 0
      ? undefined
      : await services
          .run(takeWriterWork(services, project, writerBooks))
          .catch((cause: unknown) => {
            toasts.error({
              title: t("Could not mark the Writer work taken"),
              message: describe(cause),
            });
            return undefined;
          });
  const writerMessage =
    writerBooks.length === 0 || typedMessage !== ""
      ? staticMessage
      : t("Reviewed Writer work: {books}", {
          books: writerBooks.map((id) => bookName(id, metadataOf(project))).join(", "),
        });
  const outcome = await recordVersion(
    services,
    project,
    books,
    writerMessage,
    by,
    writerFile === undefined ? [] : [writerFile],
  );
  if (outcome.kind === "recorded" && writerBooks.length > 0)
    forgetWriterWork(project.root, writerBooks);
  reportRecorded(inputs, project, staticMessage, outcome);
}

async function record(inputs: RecordActionInputs, state: RecordState): Promise<void> {
  const { shell, services } = inputs;
  const { againstShared, againstWriter } = inputs.sides;
  const { reviewBooks, undecidedBoth } = inputs.units;
  const { message, typedName, author, setAuthor, unsaved, defaultMessage } = inputs.form;
  const project = shell.project();
  const review = unsaved();
  if (project === undefined || state.recording()) return;
  if (review.length === 0 && !againstShared() && !againstWriter()) return;
  const typedMessage = message().trim();
  const staticNote = typedMessage;
  const settledNames = reviewBooks().map((book) => bookName(book.bookId, metadataOf(project)));
  const copyReview = inputs.route.fromCopy();
  const settling = againstShared() ? settledMessage(copyReview, settledNames) : undefined;
  const staticMessage = typedMessage !== "" ? typedMessage : (settling ?? defaultMessage());
  const typed = typedName().trim();
  const by = author() ?? (typed === "" ? undefined : { name: typed, email: "" });
  if (by === undefined) {
    toasts.error({
      title: t("Add your name first"),
      message: t("It goes with every version you keep."),
    });
    return;
  }
  if (author() === undefined) {
    await services.run(Effect.ignore(setAuthorName(services.settings, typed)));
    setAuthor(by);
  }
  if (againstShared() && undecidedBoth() > 0) {
    toasts.error({
      title: t("Choose a side first"),
      message: t("{count} passage(s) changed in both places still need a choice.", {
        count: undecidedBoth(),
      }),
    });
    return;
  }
  state.setRecording(true);
  inputs.receipt.setRecordedLine(undefined);
  inputs.receipt.setSendLine(undefined);
  const context = { project, by, staticMessage, staticNote, copyReview };
  if (againstShared()) await recordAgainstShared(inputs, context);
  else await recordPlain(inputs, context, review, typedMessage);
  state.setRecording(false);
}

export function createRecordAction(inputs: RecordActionInputs) {
  const [recording, setRecording] = createSignal(false, { name: "reviewRecording" });
  const [declineNote, setDeclineNote] = createSignal("", { name: "reviewDeclineOnlyNote" });
  const state = { recording, setRecording };

  return {
    recording,
    declineNote,
    setDeclineNote,
    declineFromDialog: (): void => declineFromDialog(inputs, state, declineNote),
    record: (): Promise<void> => record(inputs, state),
  };
}

export type RecordAction = ReturnType<typeof createRecordAction>;
