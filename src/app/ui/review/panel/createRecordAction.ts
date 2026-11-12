import { Effect } from "effect";
import { createSignal, untrack } from "solid-js";

import { m } from "#app/paraglide/messages";

import { collaboration } from "../../../collaboration";
import { describe } from "../../../describe";
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

interface Settling {
  readonly project: Project;
  readonly by: { name: string; email: string };
  readonly staticMessage: string;
  readonly staticNote: string;
  readonly copyReview: boolean;
}

function declineFromDialog(inputs: RecordActionInputs, declineNote: () => string): void {
  const { shell, services, navigate } = inputs;
  const project = shell.project();
  const number = inputs.route.pull();
  if (project === undefined || number === undefined || inputs.receipt.inFlight()) return;
  const staticNote = declineNote();
  inputs.receipt.start();
  declineSuggestion(services, project, { number }, staticNote)
    .then(() => {
      toasts.success({
        title: m.common_declined(),
        message:
          staticNote.trim() === ""
            ? m.review_the_suggestion_is_closed_its()
            : m.review_its_author_can_read_your(),
      });
      inputs.receipt.closeRecord();
      void collaboration.refresh(services, project);
      void navigate({ to: "/project/$slug/suggestions", params: { slug: shell.slug() } });
    })
    .catch((cause: unknown) =>
      toasts.error({ title: m.review_could_not_decline_it(), message: describe(cause) }),
    )
    .finally(() => inputs.receipt.stopped());
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
      ? m.review_combined_with_your_copy_on()
      : m.review_combined_with_the_shared_project(),
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
          title: m.review_brought_in_but_the_suggestion(),
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
        title: m.review_updates_received_your_decisions_are(),
        detail: describe(outcome.recorded.error),
      });
      settledDone(inputs);
      break;
    case "not-written":
      setRecordedLine({
        tone: "error",
        title: m.review_updates_received_your_decisions_could(),
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
        title: m.review_not_combined(),
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
              title: m.review_saved_here_not_sent_yet(),
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
      setRecordedLine({ tone: "muted", title: m.review_nothing_to_record() });
      break;
    case "not-written":
      setRecordedLine({
        tone: "error",
        title: m.review_could_not_write_to_disk(),
        detail: describe(outcome.error),
      });
      break;
    case "not-recorded":
      shell.noteWritten(outcome.books, false);
      setRecordedLine({
        tone: "error",
        title: m.review_on_disk_but_not_recorded(),
        detail: describe(outcome.error),
      });
      break;
    case "recorded":
      shell.noteWritten(outcome.books, true);
      setRecordedLine({
        tone: "success",
        title: m.review_recorded_count_books_on_this_device({ count: outcome.receipts }),
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
              title: m.review_could_not_mark_the_writer(),
              message: describe(cause),
            });
            return undefined;
          });
  const writerMessage =
    writerBooks.length === 0 || typedMessage !== ""
      ? staticMessage
      : m.review_reviewed_writer_work_books({
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

async function record(inputs: RecordActionInputs): Promise<void> {
  const { shell, services } = inputs;
  const { againstShared, againstWriter } = inputs.sides;
  const { reviewBooks, undecidedBoth } = inputs.units;
  const { message, typedName, author, setAuthor, unsaved, defaultMessage } = inputs.form;
  const project = shell.project();
  const review = unsaved();
  if (project === undefined || inputs.receipt.inFlight()) return;
  if (review.length === 0 && !inputs.form.namesQueued() && !againstShared() && !againstWriter())
    return;
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
      title: m.review_add_your_name_first(),
      message: m.review_it_goes_with_every_version(),
    });
    return;
  }
  // Before the first await, so a second press finds a run already in flight.
  inputs.receipt.start();
  try {
    if (author() === undefined) {
      await services.run(Effect.ignore(setAuthorName(services.settings, typed)));
      setAuthor(by);
    }
    if (againstShared() && undecidedBoth() > 0) {
      toasts.error({
        title: m.review_choose_a_side_first(),
        message: m.review_passages_changed_in_both_places({
          count: undecidedBoth(),
        }),
      });
      return;
    }
    const context = { project, by, staticMessage, staticNote, copyReview };
    if (againstShared()) await recordAgainstShared(inputs, context);
    else await recordPlain(inputs, context, review, typedMessage);
  } catch (cause) {
    inputs.receipt.setRecordedLine({
      tone: "error",
      title: m.review_could_not_record_this_version(),
      detail: describe(cause),
    });
  } finally {
    // Only a run that ended with no receipt is still recording here.
    inputs.receipt.stopped();
  }
}

export function createRecordAction(inputs: RecordActionInputs) {
  const [declineNote, setDeclineNote] = createSignal("", { name: "reviewDeclineOnlyNote" });

  return {
    recording: inputs.receipt.recording,
    declineNote,
    setDeclineNote,
    declineFromDialog: (): void => declineFromDialog(inputs, declineNote),
    record: (): Promise<void> => record(inputs),
  };
}

export type RecordAction = ReturnType<typeof createRecordAction>;
