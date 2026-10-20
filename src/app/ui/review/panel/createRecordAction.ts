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

export function createRecordAction(inputs: RecordActionInputs) {
  const { shell, services, navigate } = inputs;
  const { pull, fromCopy, theirsRef } = inputs.route;
  const { version, shared, common, againstShared, againstWriter } = inputs.sides;
  const { startOver, decisionFor } = inputs.decisions;
  const { reviewBooks, preset, undecidedBoth } = inputs.units;
  const { writeNow } = inputs.writes;
  const { message, setMessage, author, setAuthor, typedName, setBroughtIn, closeOnSave } =
    inputs.form;
  const { unsaved, defaultMessage } = inputs.form;
  const { setRecordedLine, setSendLine, closeRecord, lineOfSend, follow } = inputs.receipt;
  const [recording, setRecording] = createSignal(false, { name: "reviewRecording" });
  const [declineNote, setDeclineNote] = createSignal("", { name: "reviewDeclineOnlyNote" });

  const declineFromDialog = (): void => {
    const project = shell.project();
    const number = pull();
    if (project === undefined || number === undefined || recording()) return;
    const staticNote = declineNote();
    setRecording(true);
    declineSuggestion(services, project, { number }, staticNote)
      .then(() => {
        toasts.success({
          title: t("Declined"),
          message:
            staticNote.trim() === ""
              ? t("The suggestion is closed; its author sees it was not brought in.")
              : t("Its author can read your note."),
        });
        closeRecord();
        void collaboration.refresh(services, project);
        void navigate({ to: "/project/$slug/suggestions", params: { slug: shell.slug() } });
      })
      .catch((cause: unknown) =>
        toasts.error({ title: t("Could not decline it"), message: describe(cause) }),
      )
      .finally(() => setRecording(false));
  };

  const settleOptions = (
    copyReview: boolean,
  ): { theirs?: ReturnType<typeof theirsRef>; sendTo?: "origin" } => {
    if (pull() !== undefined) return { theirs: theirsRef(), sendTo: "origin" };
    return copyReview ? { theirs: theirsRef() } : {};
  };

  const record = async (): Promise<void> => {
    const project = shell.project();
    const review = unsaved();
    if (project === undefined || recording()) return;
    if (review.length === 0 && !againstShared() && !againstWriter()) return;
    const typedMessage = message().trim();
    const staticNote = typedMessage;
    const settledNames = reviewBooks().map((book) => bookName(book.bookId, metadataOf(project)));
    const copyReview = fromCopy();
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
    setRecording(true);
    setRecordedLine(undefined);
    setSendLine(undefined);
    if (againstShared()) {
      for (const book of reviewBooks()) {
        const taking = book.skeleton.units.filter(
          (unit) =>
            unit.status !== "unchanged" &&
            decisionFor(book.bookId, unit.id) === undefined &&
            preset(book.bookId, unit) === "baseline",
        );
        if (taking.length > 0) writeNow(book.bookId, taking, "baseline");
      }
      const settled = new Set(reviewBooks().map((book) => book.bookId));
      const outcome = await settleWithShared(
        services,
        project,
        by,
        staticMessage,
        settled,
        settleOptions(copyReview),
      );
      const accepted = untrack(closeOnSave) ? pull() : undefined;
      const markTaken = (sent: boolean): void => {
        if (accepted === undefined || !sent) return;
        acceptSuggestion(services, project, accepted, staticNote)
          .then(() => setBroughtIn(true))
          .catch((cause: unknown) =>
            toasts.error({
              title: t("Brought in, but the suggestion is still open on the shared project"),
              message: describe(cause),
            }),
          )
          .finally(() => void collaboration.refresh(services, project));
      };
      const done = (): void => {
        setMessage("");
        startOver();
        version.refresh();
        shared.refresh();
        common.refresh();
      };
      switch (outcome.kind) {
        case "refused":
          setRecordedLine({
            tone: "error",
            title: t("Not combined"),
            detail: refusedDetail(outcome),
          });
          break;
        case "combined":
          shell.noteWritten(
            project.books.map((book) => book.id),
            true,
          );
          setRecordedLine({
            tone: "success",
            title: copyReview
              ? t("Combined with your copy on this device")
              : t("Combined with the shared project on this device"),
            detail: staticMessage,
          });
          markTaken(outcome.sent);
          setSendLine(
            outcome.sent
              ? lineOfSend(
                  outcome.to === "copy" ? { kind: "sent", toCopy: true } : { kind: "sent" },
                )
              : {
                  tone: "warning",
                  title: t("Saved here. Not sent yet"),
                  detail: combineTrouble("recorded"),
                  action: "retry",
                },
          );
          done();
          break;
        case "received":
          switch (outcome.recorded.kind) {
            case "recorded":
            case "nothing":
              shell.noteWritten(
                project.books.map((book) => book.id),
                true,
              );
              setRecordedLine({
                tone: "success",
                title: copyReview
                  ? t("Combined with your copy on this device")
                  : t("Combined with the shared project on this device"),
                detail: staticMessage,
              });
              follow(outcome.sending);
              void outcome.sending?.then((sent) => markTaken(sent.kind === "sent"));
              done();
              break;
            case "not-recorded":
              shell.noteWritten(outcome.recorded.books, false);
              setRecordedLine({
                tone: "error",
                title: t("Updates received; your decisions are on disk, but not recorded"),
                detail: describe(outcome.recorded.error),
              });
              done();
              break;
            case "not-written":
              setRecordedLine({
                tone: "error",
                title: t("Updates received; your decisions could not be written"),
                detail: describe(outcome.recorded.error),
              });
              done();
              break;
          }
          break;
      }
      setRecording(false);
      return;
    }
    const books = review.map((entry) => entry.book);
    const writerBooks = againstWriter()
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
        setMessage("");
        version.refresh();
        follow(sendAfterSave(services, project));
        break;
    }
    setRecording(false);
  };

  return { recording, declineNote, setDeclineNote, declineFromDialog, record };
}

export type RecordAction = ReturnType<typeof createRecordAction>;
