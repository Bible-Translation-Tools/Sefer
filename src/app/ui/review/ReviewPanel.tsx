/**
 * `/review` — ONE screen for "these two texts differ; which do I keep". The
 * model is `documentation/architecture/review.md`; what follows is what this
 * file has to keep true.
 *
 * **Both sides are sources, and neither is special.** The left picker and the
 * right picker are the SAME list (`sources.ts`). Left defaults to the editor
 * and right to the file because that is the comparison a reader wants nine
 * times in ten — not because the screen knows anything about them. The same
 * source on both sides is refused, because a text is never a review of itself.
 *
 * **The TARGET is whichever side can be written** (`CompareSource.canApply`).
 * When neither side can be, the screen says so in one line and offers no
 * Apply: offering a write with nowhere to put it would be pretending.
 *
 * **Decide, then apply.** A click on "Keep the editor's" or "Take the file's"
 * edits a `Map` and nothing else. Apply projects that map once, names the
 * books it is about to write, and writes them through `book.apply` — one apply
 * per book, so Undo takes back a book at a time. Revert is that, exactly; the
 * only concession the past sources get is that an undecided unit is not a
 * refusal (`applyPlan`'s `allowUndecided`), because reverting one verse must
 * not mean ruling on every other verse in the book first.
 *
 * **The unit is the engine's decision unit**, addressed by reference.
 * `diffSkeleton` is the engine's own diff and there is no second one. The
 * header says "engine diff", because a reviewer deciding what to keep is
 * entitled to know what aligned it, and a build whose artifact has no diff
 * door says so instead of showing an empty comparison.
 *
 * "Record a version" is the only thing in Sefer that writes a project file:
 * `saveAll` then `Git.commit`, in that order, as one action. It is offered
 * whenever the project is one of the two sides, because what it records is the
 * project's own unsaved work and not the comparison.
 */

import { useNavigate } from "@tanstack/solid-router";
import { Effect, Option, Result } from "effect";
import Check from "lucide-solid/icons/check";
import Code from "lucide-solid/icons/code";
import History from "lucide-solid/icons/history";
import LifeBuoy from "lucide-solid/icons/life-buoy";
import Save from "lucide-solid/icons/save";
import Scale from "lucide-solid/icons/scale";
import { For, Show, createEffect, createMemo, createSignal, untrack } from "solid-js";

import type { BookId } from "#core/book/book";
import {
  applyPlan,
  bookComparison,
  compareBooks,
  sourceRef,
  type BookComparison,
  type BookPlan,
  type CompareResult,
  type CompareSource,
  type Plan,
} from "#core/compare";
import { diffSkeleton, mergeWithDecisions, type SkeletonResult } from "#core/diff/skeleton";
import type { DecisionUnit, DiffSkeleton, MergeSide } from "#core/galley";
import { Observability } from "#core/observability";
import type { Restorable } from "#core/recovery/recovery";
import type { SourceStamp } from "#core/source/source";

import { describe, reasonOf } from "../../describe";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { unsavedChanges } from "../panels/changes";
import { ago, exact } from "../panels/format";
import { createRecordedVersion } from "../panels/recorded";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  PanelHeader,
  Select,
  Switch,
  toasts,
} from "../primitives";
import { bookName } from "../workspace/books";
import { metadataOf } from "../workspace/project";
import { textOf } from "./reading";
import { sourceChoices, type SourceChoice } from "./sources";
import { UnitCard } from "./UnitCard";

/** The author every Sefer commit carries until accounts reach this screen. */
const AUTHOR = { name: "Sefer", email: "sefer@localhost" } as const;

/** The sources that read live, so a keystroke moves the review under itself. */
const LIVE = new Set(["project", "disk"]);

/**
 * Decisions are keyed by book AND unit: a sid is unique only within a book.
 *
 * The separator is NUL, written as the escape `\0` and not as a raw control
 * byte: it is the one character that cannot occur in a book code or a sid, so
 * the key is unambiguous to split -- but a source file holding the byte itself
 * counts as binary, which makes `file` call it data and plain `grep` silently
 * find nothing in it. That cost this migration six missed call sites.
 */
const keyOf = (bookId: BookId, unitId: string): string => `${bookId}\0${unitId}`;

export function ReviewPanel() {
  const shell = useShell();
  const navigate = useNavigate();
  const { services } = shell;
  const version = createRecordedVersion(shell);

  const [leftId, setLeftId] = createSignal("project", { name: "reviewLeftKind" });
  const [rightId, setRightId] = createSignal("disk", { name: "reviewRightKind" });
  const [leftPicked, setLeftPicked] = createSignal<CompareSource | undefined>(undefined, {
    name: "reviewLeftPicked",
  });
  const [rightPicked, setRightPicked] = createSignal<CompareSource | undefined>(undefined, {
    name: "reviewRightPicked",
  });
  const [result, setResult] = createSignal<CompareResult | undefined>(undefined, {
    name: "reviewResult",
  });
  const [decisions, setDecisions] = createSignal<ReadonlyMap<string, MergeSide>>(new Map(), {
    name: "reviewDecisions",
  });
  const [selected, setSelected] = createSignal<BookId | undefined>(undefined, {
    name: "reviewBook",
  });
  const [markup, setMarkup] = createSignal(false, { name: "reviewMarkup" });
  const [message, setMessage] = createSignal("", { name: "reviewMessage" });
  const [busy, setBusy] = createSignal("", { name: "reviewBusy" });
  const [note, setNote] = createSignal("", { name: "reviewNote" });
  const [receipt, setReceipt] = createSignal("", { name: "reviewReceipt" });
  const [confirming, setConfirming] = createSignal(false, { name: "reviewConfirming" });
  const [recording, setRecording] = createSignal(false, { name: "reviewRecording" });
  const [journals, setJournals] = createSignal<readonly Restorable[]>([], {
    name: "reviewJournals",
  });

  const choices = (): readonly SourceChoice[] =>
    sourceChoices({
      services,
      project: shell.project(),
      baselineOf: (book) => services.save.baseline(book),
      recorded: version.recorded(),
    });

  const choiceOf = (id: string): SourceChoice | undefined =>
    choices().find((choice) => choice.id === id);

  /**
   * One side, resolved. A kind with an `immediate` is minted fresh on every
   * read — the project and the disk sources read live, and a stale object
   * would describe the project as it was when the picker last moved.
   */
  const sourceFor = (id: string, picked: CompareSource | undefined): CompareSource | undefined => {
    const choice = choiceOf(id);
    if (choice === undefined) return undefined;
    return choice.immediate === undefined ? picked : choice.immediate();
  };

  const left = (): CompareSource | undefined => sourceFor(leftId(), leftPicked());
  const right = (): CompareSource | undefined => sourceFor(rightId(), rightPicked());

  const leftShort = (): string => choiceOf(leftId())?.shortLabel ?? t("this side");
  const rightShort = (): string => choiceOf(rightId())?.shortLabel ?? t("the other side");
  const leftLabel = (): string => left()?.label ?? choiceOf(leftId())?.label ?? "";
  const rightLabel = (): string => right()?.label ?? choiceOf(rightId())?.label ?? "";

  /**
   * The side being written: the one that says it can be. Only the open project
   * says so, and the same source cannot sit on both sides, so this is never
   * ambiguous.
   */
  const target = (): "left" | "right" | undefined =>
    left()?.canApply === true ? "left" : right()?.canApply === true ? "right" : undefined;

  /**
   * Whether an undecided unit is a refusal. It is not, for a review against the
   * reader's own past — see the header.
   */
  const againstPast = (): boolean => {
    const other = target() === "left" ? rightId() : leftId();
    return other === "disk" || other === "recorded";
  };

  const live = (): boolean => LIVE.has(leftId()) || LIVE.has(rightId());

  /**
   * Every open book's revision, as one key.
   *
   * Both effects below mean the same thing by "something moved": the text of
   * some book in the project did. This screen is one of the few that honestly
   * wants all of them — a comparison spans the project and so does a recovery
   * scan — so it reads every row rather than pretending otherwise.
   *
   * It is still narrower than the counter it replaces, which also fired on
   * every publication, every seat change and every save in the application.
   */
  const revisions = (): string => {
    const project = shell.project();
    if (project === undefined) return "";
    return project.books.map((book) => shell.stampOf(book.id)?.revision ?? -1).join(",");
  };

  // --- the comparison ------------------------------------------------------

  /**
   * One pass. Coalesced rather than queued: a burst of ticks while somebody
   * types must cost one comparison after the burst, not one per keystroke, and
   * a comparison that arrived late must not overwrite a newer one.
   */
  let running = false;
  let again = false;
  const runCompare = (): void => {
    const a = left();
    const b = right();
    if (a === undefined || b === undefined || a.id === b.id) {
      setResult(undefined);
      return;
    }
    if (running) {
      again = true;
      return;
    }
    running = true;
    void services
      .run(compareBooks(a, b))
      .then((found) => {
        running = false;
        setNote("");
        setResult(found);
        setSelected((held) =>
          held !== undefined && found.books.some((book) => book.bookId === held && !book.identical)
            ? held
            : (found.books.find((book) => !book.identical)?.bookId ?? found.books[0]?.bookId),
        );
        if (again) {
          again = false;
          runCompare();
        }
      })
      .catch((cause: unknown) => {
        running = false;
        again = false;
        setNote(describe(cause));
      });
  };

  /**
   * Re-take the comparison when the sides change, and — while either side
   * reads live — whenever a book's text moves, so typing shows up here
   * without a button. A comparison is still a snapshot; this simply takes a
   * new one.
   */
  createEffect(
    () =>
      `${leftId()}:${rightId()}:${leftPicked()?.id ?? ""}:${rightPicked()?.id ?? ""}:${
        live() ? revisions() : ""
      }:${version.recorded().head ?? ""}`,
    () => {
      // The compute above IS the dependency list. Everything this reads is a
      // one-time snapshot of the state that key already describes, so
      // `untrack` says so — a read in an effect's effect-phase that is not a
      // dependency is what STRICT_READ_UNTRACKED exists to catch, and it
      // cannot tell a deliberate snapshot from a mistake without being told.
      untrack(runCompare);
    },
  );

  const pick = (side: "left" | "right", id: string): void => {
    const choice = choiceOf(id);
    if (side === "left") {
      setLeftId(id);
      setLeftPicked(undefined);
    } else {
      setRightId(id);
      setRightPicked(undefined);
    }
    setDecisions(new Map());
    setReceipt("");
    if (choice?.pick === undefined) return;
    setBusy(t("Reading…"));
    void choice
      .pick()
      .then((source) => {
        setBusy("");
        if (source === undefined) return;
        if (side === "left") setLeftPicked(source);
        else setRightPicked(source);
      })
      .catch((cause: unknown) => {
        setBusy("");
        setNote(describe(cause));
      });
  };

  // --- the units -----------------------------------------------------------

  const changed = (): readonly BookComparison[] =>
    result()?.books.filter((book) => !book.identical) ?? [];

  const current = (): BookComparison | undefined => {
    const found = result();
    const bookId = selected();
    return found === undefined || bookId === undefined ? undefined : bookComparison(found, bookId);
  };

  /**
   * Every changed book's decision units, computed once per comparison.
   *
   * A decision changes no skeleton, so nothing the reader clicks should
   * re-diff anything. This is the one place that asks the engine for them;
   * the selected book's skeleton and the plan both read from it.
   * (`diffSkeleton`'s own cache holds four entries, so reading every changed
   * book through it on each render re-diffed all of them once a comparison
   * had more than four.)
   */
  const skeletons = createMemo(
    (): ReadonlyMap<BookId, SkeletonResult> => {
      const held = new Map<BookId, SkeletonResult>();
      for (const book of result()?.books ?? []) {
        if (book.identical || book.leftText === undefined || book.rightText === undefined) continue;
        held.set(
          book.bookId,
          diffSkeleton(services.galley, book.bookId, book.rightText, book.leftText),
        );
      }
      return held;
    },
    { name: "reviewSkeletons" },
  );

  /**
   * The selected book's diff, or the reason there is none.
   *
   * An identical book is not in `skeletons` — it has nothing to plan — but the
   * screen still shows its (empty) diff, so it is asked for directly.
   *
   * `baseline` is the RIGHT side and `current` the LEFT, which is the engine's
   * own vocabulary and the reason the buttons read "Keep the editor's" / "Take
   * the file's" rather than naming a side of the wire.
   */
  const selectedSkeleton = createMemo(
    (): SkeletonResult | undefined => {
      const book = current();
      if (book === undefined || book.leftText === undefined || book.rightText === undefined)
        return undefined;
      return (
        skeletons().get(book.bookId) ??
        diffSkeleton(services.galley, book.bookId, book.rightText, book.leftText)
      );
    },
    { name: "reviewSkeleton" },
  );

  /** The selected book's decision units. */
  const skeleton = (): DiffSkeleton | undefined => {
    const found = selectedSkeleton();
    return found !== undefined && Result.isSuccess(found) ? found.success : undefined;
  };

  /**
   * The engine has no diff door — which means the artifact in this build is
   * not the pinned build. Said in as many words, because the
   * alternative is a screen that looks like it found no differences.
   */
  const diffRefusal = (): string | undefined => {
    const found = selectedSkeleton();
    return found !== undefined && Result.isFailure(found) ? found.failure.description : undefined;
  };

  const units = (): readonly DecisionUnit[] =>
    skeleton()?.units.filter((unit) => unit.status !== "unchanged") ?? [];

  const decisionFor = (bookId: BookId, unitId: string): MergeSide | undefined =>
    decisions().get(keyOf(bookId, unitId));

  const decide = (bookId: BookId, unitId: string, side: MergeSide | undefined): void => {
    setDecisions((held) => {
      const next = new Map(held);
      if (side === undefined) next.delete(keyOf(bookId, unitId));
      else next.set(keyOf(bookId, unitId), side);
      return next;
    });
  };

  /**
   * The bulk stamp, over the book on screen. A snapshot on purpose: the stamp
   * is about the units as they were when the button was pressed.
   */
  const stamp = (side: MergeSide | undefined): void => {
    const staticBook = current();
    const staticUnits = units();
    if (staticBook === undefined) return;
    setDecisions((held) => {
      const next = new Map(held);
      for (const unit of staticUnits) {
        const key = keyOf(staticBook.bookId, unit.id);
        if (side === undefined) next.delete(key);
        else next.set(key, side);
      }
      return next;
    });
  };

  /** How many of this book's units have been ruled on, and how many there are. */
  const totals = () => {
    const book = current();
    if (book === undefined) return { total: 0, decided: 0, taken: 0 };
    let decided = 0;
    let taken = 0;
    for (const unit of units()) {
      const held = decisionFor(book.bookId, unit.id);
      if (held === undefined) continue;
      decided += 1;
      if (held === (target() === "left" ? "baseline" : "current")) taken += 1;
    }
    return { total: units().length, decided, taken };
  };

  /** Every book with at least one decision, across the whole review. */
  const decidedBooks = (): readonly BookId[] => {
    const seen = new Set<BookId>();
    for (const key of decisions().keys()) {
      const bookId = key.split("\0")[0];
      if (bookId !== undefined) seen.add(bookId);
    }
    return [...seen];
  };

  // --- apply ---------------------------------------------------------------

  /**
   * The decision map as what would be written.
   *
   * A memo: the Apply button, its confirmation and Apply itself all read it,
   * and it changes only when the comparison, the target or a decision does.
   * The unit is the engine's, not a line hunk: the merged text comes from
   * `mergeWithDecisions`, which prefers the engine's own merge. `applyPlan`
   * does the writing and owns every refusal — `ReadOnly`, `Incomplete`, `Unsupported` and
   * `Stale` — so the screen cannot disagree with what the write will do.
   */
  const currentPlan = createMemo(
    (): Plan | undefined => {
      const found = result();
      const side = target();
      if (found === undefined || side === undefined) return undefined;
      const fallback: MergeSide = side === "left" ? "current" : "baseline";
      const touched = new Set(decidedBooks());
      const books: BookPlan[] = [];
      let undecided = 0;

      for (const book of found.books) {
        const targetText = side === "left" ? book.leftText : book.rightText;
        if (book.identical || book.leftText === undefined || book.rightText === undefined) {
          books.push({
            bookId: book.bookId,
            operation: targetText === undefined ? "keep" : "keep",
            text: targetText,
            targetText,
            undecided: 0,
          });
          continue;
        }
        // A book whose diff the engine will not produce is a book this screen
        // cannot plan a write for. The whole plan goes, rather than that book
        // quietly becoming a "keep": a partial plan is a write nobody asked for.
        const found = skeletons().get(book.bookId);
        if (found === undefined || Result.isFailure(found)) return undefined;
        const skeletonOf = found.success;
        if (!touched.has(book.bookId)) {
          // Nothing was said about this book, so nothing happens to it. Its
          // units still count as undecided for the completeness rule.
          const open = skeletonOf.units.filter((unit) => unit.status !== "unchanged").length;
          undecided += open;
          books.push({
            bookId: book.bookId,
            operation: "keep",
            text: targetText,
            targetText,
            undecided: open,
          });
          continue;
        }
        const map = new Map<string, MergeSide>();
        for (const unit of skeletonOf.units) {
          const held = decisionFor(book.bookId, unit.id);
          if (held !== undefined) map.set(unit.id, held);
        }
        const open = skeletonOf.units.filter(
          (unit) => unit.status !== "unchanged" && !map.has(unit.id),
        ).length;
        undecided += open;
        const merged = mergeWithDecisions(
          services.galley,
          book.rightText,
          book.leftText,
          map,
          fallback,
        );
        if (Result.isFailure(merged)) return undefined;
        books.push({
          bookId: book.bookId,
          operation: merged.success === targetText ? "keep" : "write",
          text: merged.success,
          targetText,
          undecided: open,
        });
      }

      const targetSource = side === "left" ? left() : right();
      return {
        target: targetSource === undefined ? found.left : sourceRef(targetSource),
        books,
        writes: books.filter((book) => book.operation !== "keep"),
        undecided,
        complete: undecided === 0,
      };
    },
    { name: "reviewPlan" },
  );

  const apply = (): void => {
    const side = target();
    const projected = currentPlan();
    const into = side === "left" ? left() : right();
    if (into === undefined || projected === undefined) return;
    setConfirming(false);
    setBusy(t("Applying…"));
    const toast = toasts.progress({ title: t("Applying") });
    const operation = services.composition.observability.operation("review.apply", {
      "review.writes": projected.writes.length,
      "review.undecided": projected.undecided,
      "review.target": side ?? "unknown",
    });
    const close = operation.span("review.apply.work", undefined, {
      "review.writes": projected.writes.length,
    });
    let settled = false;
    const finish = (
      verdict: "passed" | "refused",
      attrs: Readonly<Record<string, string | number | boolean>>,
    ): void => {
      if (settled) return;
      settled = true;
      close(attrs);
      operation.end(verdict, attrs);
    };
    void services
      .run(
        Effect.provideService(
          applyPlan(projected, into, { allowUndecided: againstPast() }),
          Observability,
          operation,
        ),
      )
      .then((report) => {
        finish("passed", {
          "review.written": report.written.length,
          "review.unchanged": report.unchanged,
        });
        setBusy("");
        setDecisions(new Map());
        shell.changed({ kind: "book.apply", books: report.written });
        const written =
          report.written.length === 0
            ? t("Nothing needed writing")
            : t("Written: {books}", { books: report.written.join(", ") });
        toasts.update(toast, { title: t("Applied"), message: written, tone: "success" });
        setReceipt(written);
        runCompare();
      })
      .catch((cause: unknown) => {
        setBusy("");
        const described = describe(cause);
        finish("refused", { "review.reason": reasonOf(cause) ?? "unknown" });
        setNote(described);
        toasts.update(toast, { title: t("Apply refused"), message: described, tone: "error" });
      });
  };

  // --- record a version ----------------------------------------------------

  const unsaved = () => unsavedChanges(shell);

  const defaultMessage = (): string =>
    t("Edit {count} book(s)", { count: Math.max(unsaved().length, 1) });

  const record = async (): Promise<void> => {
    const project = shell.project();
    const review = unsaved();
    if (project === undefined || recording() || review.length === 0) return;
    setRecording(true);
    const notice = toasts.progress({ title: t("Recording…") });

    const saved = await services.run(Effect.result(services.save.saveAll(project.books)));
    if (Result.isFailure(saved)) {
      toasts.update(notice, {
        tone: "error",
        title: t("Could not write to disk"),
        message: describe(saved.failure),
        autoClose: false,
      });
      setRecording(false);
      return;
    }
    // The files hold this text and no version holds the files: that is
    // `onDisk`, exactly. Saying it here rather than bumping a counter is what
    // keeps the early return below from leaving the markers wrong.
    shell.noteWritten(
      review.map((book) => book.bookId),
      false,
    );

    const receipts: { readonly path: string; readonly stamp: SourceStamp }[] = [];
    for (const book of review) {
      const baseline = services.save.baseline(book.book);
      if (Option.isNone(baseline)) continue;
      receipts.push({ path: baseline.value.path, stamp: baseline.value.stamp });
    }
    if (receipts.length === 0) {
      toasts.update(notice, { title: t("Nothing to record"), tone: "info" });
      setRecording(false);
      return;
    }

    const staticMessage = message().trim() === "" ? defaultMessage() : message().trim();
    const recorded = await services.run(
      Effect.result(
        Effect.gen(function* () {
          const repo = yield* services.git.init(project.root);
          return yield* services.git.commit(repo, receipts, staticMessage, AUTHOR);
        }),
      ),
    );
    if (Result.isFailure(recorded)) {
      shell.noteWritten(
        review.map((book) => book.bookId),
        false,
      );
      toasts.update(notice, {
        tone: "error",
        autoClose: false,
        title: t("On disk, but not recorded"),
        message: describe(recorded.failure),
      });
    } else {
      shell.noteWritten(
        review.map((book) => book.bookId),
        true,
      );
      toasts.update(notice, {
        tone: "success",
        title: t("Recorded {count} book(s) as {hash}", {
          count: receipts.length,
          hash: recorded.success.slice(0, 7),
        }),
        message: staticMessage,
      });
      setMessage("");
      version.refresh();
    }
    setRecording(false);
  };

  // --- recovery ------------------------------------------------------------

  const reload = (): void => {
    const project = shell.project();
    if (project === undefined) return;
    void services
      .run(
        services.recovery.pending((bookId: BookId) => {
          const book = project.book(bookId);
          return book === undefined ? Option.none() : services.save.baseline(book);
        }),
      )
      .then((found) => {
        setJournals(found.filter((entry) => entry.projectId === project.id));
      });
  };

  createEffect(
    // A backup is written as the reader types, so the pending list moves when
    // a book's text does — and, unlike the counter, at no other time.
    revisions,
    () => {
      // Same as the compare effect above: a snapshot, not a dependency.
      untrack(reload);
    },
  );

  /** When the working-state backup last wrote something, over every journal. */
  const lastBackup = (): number | undefined => {
    let latest: number | undefined;
    for (const journal of journals())
      for (const entry of journal.entries)
        if (latest === undefined || entry.at > latest) latest = entry.at;
    return latest;
  };

  /**
   * The journals worth OFFERING back: one for a book nobody reopened. A journal
   * for a book this session already has open is the live backup of what is on
   * screen, and restoring it would replay edits the editor is already showing.
   */
  const recovered = (): readonly Restorable[] =>
    journals().filter((journal) => services.seated(journal.bookId) === undefined);

  const restore = (journal: Restorable): void => {
    const project = shell.project();
    if (project === undefined) return;
    void services
      .run(
        Effect.result(
          Effect.gen(function* () {
            const book = yield* project.instantiate(journal.bookId);
            yield* services.save.adopt(book);
            return yield* services.recovery.restore(journal.id, (bookId) =>
              services.seated(bookId),
            );
          }),
        ),
      )
      .then((done) => {
        if (Result.isFailure(done)) {
          toasts.error({
            title: t("Could not restore {book}", { book: journal.bookId }),
            message: describe(done.failure),
          });
          return;
        }
        toasts.success({
          title: t("Restored {book}", { book: journal.bookId }),
          message: t(
            "The work is in the editor. It is not a recorded version until you record one.",
          ),
        });
        shell.changed({ kind: "journal.restore", books: [journal.bookId] });
      });
  };

  const discard = (journal: Restorable): void => {
    void services.run(Effect.result(services.recovery.discard(journal.id))).then((done) => {
      if (Result.isFailure(done)) {
        toasts.error({ title: t("Could not discard"), message: describe(done.failure) });
        return;
      }
      toasts.info({ title: t("Discarded the backup for {book}", { book: journal.bookId }) });
      // Nothing about any BOOK changed, so there is no event to report: the
      // only thing that moved is the list this screen just took an item off.
      reload();
    });
  };

  // --- render --------------------------------------------------------------

  const nameOf = (bookId: BookId): string => bookName(bookId, metadataOf(shell.project()));

  const bookLabel = (book: BookComparison): string => {
    if (book.presence === "left")
      return t("{book} — only in {source}", { book: nameOf(book.bookId), source: leftShort() });
    if (book.presence === "right")
      return t("{book} — only in {source}", { book: nameOf(book.bookId), source: rightShort() });
    return nameOf(book.bookId);
  };

  function Picker(props: { readonly side: "left" | "right" }) {
    const id = () => (props.side === "left" ? leftId() : rightId());
    const other = () => (props.side === "left" ? rightId() : leftId());
    const picked = () => (props.side === "left" ? leftPicked() : rightPicked());
    const choice = () => choiceOf(id());
    return (
      <div class="space-y-1">
        <span class="text-smallest font-medium text-on-surface-tertiary">
          {props.side === "left" ? t("This side") : t("Against")}
        </span>
        <div class="flex items-center gap-2">
          <Select
            size="sm"
            wrapperClass="min-w-0"
            data-review-side={props.side}
            aria-label={props.side === "left" ? t("The left side") : t("The right side")}
            value={id()}
            onChange={(event) => pick(props.side, event.currentTarget.value)}
          >
            <For each={choices()}>
              {(entry) => (
                <option value={entry.id} disabled={!entry.available || entry.id === other()}>
                  {entry.label}
                </option>
              )}
            </For>
          </Select>
          <Show when={choice()?.pick !== undefined}>
            <Button size="sm" onClick={() => pick(props.side, id())}>
              {picked() === undefined ? t("Choose…") : t("Change…")}
            </Button>
          </Show>
        </div>
        <p class="text-smallest text-on-surface-tertiary">
          {picked()?.label ?? choice()?.explainer ?? ""}
        </p>
      </div>
    );
  }

  return (
    <main class="min-w-0 space-y-4 p-6" data-review>
      <PanelHeader
        title={t("Review")}
        subtitle={t(
          "Two copies, a decision per difference, one write. Taking the other side's version and applying it is exactly what Revert means.",
        )}
        actions={
          <>
            <Code size={13} class="text-on-surface-tertiary" aria-hidden="true" />
            <Switch
              id="review-markup"
              checked={markup()}
              onChange={setMarkup}
              label={t("Show USFM markup")}
            />
            <Button
              icon={<History size={14} />}
              onClick={() =>
                void navigate({
                  to: "/project/$slug/history",
                  params: { slug: shell.slug() },
                  search: {},
                })
              }
            >
              {t("History")}
            </Button>
          </>
        }
      />

      <Show
        when={shell.project()}
        fallback={<EmptyState icon={<Scale size={22} />} title={t("Open a project first.")} />}
      >
        <Show when={recovered().length > 0}>
          <Card class="space-y-3 border-brand/40" aria-label={t("Recovered work")}>
            <PanelHeader
              level={3}
              title={
                <span class="flex items-center gap-2">
                  <LifeBuoy size={16} class="text-brand" aria-hidden="true" />
                  {t("Recovered work")}
                </span>
              }
              subtitle={t(
                "Sefer found a working-state backup from an earlier session that was never recorded. Restoring puts it back in the editor, where it stays unsaved until you record a version.",
              )}
            />
            <ul class="divide-y divide-surface-border">
              <For each={recovered()}>
                {(journal) => (
                  <li class="flex flex-wrap items-center gap-2 py-2">
                    <strong class="text-small font-semibold">{journal.bookId}</strong>
                    <code class="min-w-0 truncate font-mono text-smallest text-on-surface-tertiary">
                      {journal.path}
                    </code>
                    <Badge>{t("{count} edit(s)", { count: journal.entries.length })}</Badge>
                    <Button
                      size="sm"
                      variant="tertiary"
                      class="ms-auto"
                      onClick={() => discard(journal)}
                    >
                      {t("Discard")}
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => restore(journal)}>
                      {t("Restore")}
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Card>
        </Show>

        <Card class="space-y-3">
          <div class="grid gap-3 sm:grid-cols-2">
            <Picker side="left" />
            <Picker side="right" />
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <Show when={busy() !== ""}>
              <span class="text-smallest text-on-surface-tertiary">{busy()}</span>
            </Show>
            <Show when={note() !== ""}>
              <span class="text-smallest text-on-surface-secondary" data-review-note>
                {note()}
              </span>
            </Show>
            <Show when={target() === undefined}>
              <p class="text-smallest text-on-surface-secondary" data-review-readonly>
                {t("Neither side is this project — reading only.")}
              </p>
            </Show>
            <Show when={leftId() === rightId()}>
              <p class="text-smallest text-on-surface-secondary">
                {t("Pick two different sides: a text is not a review of itself.")}
              </p>
            </Show>
            <Show when={skeleton()}>
              <Badge tone="brand" data-review-engine="engine">
                {t("engine diff")}
              </Badge>
            </Show>
            <Show when={diffRefusal()}>
              {(reason) => (
                <p
                  class="text-smallest text-on-surface-error"
                  data-review-engine="missing"
                  title={reason()}
                >
                  {t("This build's engine has no diff door, so nothing can be compared.")}
                </p>
              )}
            </Show>
          </div>
        </Card>

        <Show
          when={result()}
          fallback={
            <Card>
              <EmptyState title={t("Nothing to review yet.")} />
            </Card>
          }
        >
          {(found) => (
            <>
              <Card class="flex flex-wrap items-center gap-2" data-review-summary>
                <Badge tone="brand" data-review-changed={found().changedBooks}>
                  {t("{count} book(s) differ", { count: found().changedBooks })}
                </Badge>
                <span class="text-small text-on-surface-secondary" data-review-decided>
                  {t("{decided} decided of {total} in this book", {
                    decided: totals().decided,
                    total: totals().total,
                  })}
                </span>
                <Show when={target() !== undefined && units().length > 0}>
                  <div class="ms-auto flex flex-wrap items-center gap-1">
                    <Button size="sm" variant="tertiary" onClick={() => stamp("current")}>
                      {t("Keep all of {source}'s", { source: leftShort() })}
                    </Button>
                    <Button size="sm" variant="tertiary" onClick={() => stamp("baseline")}>
                      {t("Take all of {source}'s", { source: rightShort() })}
                    </Button>
                    <Button size="sm" variant="tertiary" onClick={() => stamp(undefined)}>
                      {t("Clear")}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      data-review-apply
                      disabled={
                        (currentPlan()?.writes.length ?? 0) === 0 ||
                        busy() !== "" ||
                        (!againstPast() && currentPlan()?.complete !== true)
                      }
                      onClick={() => setConfirming(true)}
                    >
                      {t("Apply to this project")}
                    </Button>
                  </div>
                </Show>
              </Card>

              <Show when={receipt() !== ""}>
                <p class="text-small text-on-surface-success" data-review-receipt>
                  {receipt()}
                </p>
              </Show>

              <Show when={target() !== undefined}>
                <Card class="flex flex-wrap items-end gap-3" aria-label={t("Record a version")}>
                  <div class="min-w-0 flex-1 space-y-1">
                    <label
                      class="block text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase"
                      for="commit-message"
                    >
                      {t("Message")}
                    </label>
                    <Input
                      id="commit-message"
                      wrapperClass="w-full"
                      placeholder={defaultMessage()}
                      value={message()}
                      onInput={(event) => setMessage(event.currentTarget.value)}
                      onKeyDown={(event: KeyboardEvent) => {
                        if (event.key !== "Enter" || event.isComposing) return;
                        event.preventDefault();
                        if (unsaved().length > 0) void record();
                      }}
                    />
                  </div>
                  <Button
                    variant="primary"
                    icon={<Save size={14} />}
                    data-review-record
                    loading={recording()}
                    disabled={unsaved().length === 0}
                    onClick={() => void record()}
                  >
                    {t("Record a version")}
                  </Button>
                  <p class="w-full text-smallest text-on-surface-tertiary">
                    {t(
                      "{count} book(s) are not in their files yet. Nothing is written on a timer: this button writes the files and records the version together.",
                      { count: unsaved().length },
                    )}
                    <Show when={lastBackup()}>
                      {(at) => (
                        <span title={exact(at())} data-backup="last">
                          {" "}
                          {t("Working-state backup: {when}", { when: ago(at()) })}
                        </span>
                      )}
                    </Show>
                  </p>
                </Card>
              </Show>

              <div class="min-w-0 space-y-2" data-review-units={units().length}>
                <label class="flex flex-wrap items-center gap-2">
                  <span class="text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase">
                    {t("Book")}
                  </span>
                  <Select
                    size="sm"
                    wrapperClass="min-w-0"
                    data-review-books={changed().length}
                    aria-label={t("Which book to review")}
                    value={selected() ?? ""}
                    onChange={(event) => setSelected(event.currentTarget.value)}
                  >
                    <For each={changed()}>
                      {(book) => <option value={book.bookId}>{bookLabel(book)}</option>}
                    </For>
                  </Select>
                </label>

                {/* `changed()` and not `current()`: the book picker offers
                    only the books that differ, so when none does there is
                    nothing selected and the clean answer is the whole screen's
                    answer, not one book's. */}
                <Show
                  when={changed().length > 0 ? current() : undefined}
                  fallback={
                    <Card>
                      <EmptyState
                        icon={<Check size={20} />}
                        title={t("No differences.")}
                        description={t("Both sides hold exactly the same books and text.")}
                      />
                    </Card>
                  }
                >
                  {(book) => (
                    <Show
                      when={book().presence === "both"}
                      fallback={
                        <Card>
                          <EmptyState
                            title={t("{book} is on one side only.", {
                              book: nameOf(book().bookId),
                            })}
                            description={t(
                              "A project's book set is fixed when it opens, so Review cannot add or remove a book yet.",
                            )}
                          />
                        </Card>
                      }
                    >
                      <ul class="space-y-2">
                        {/* A markup-only unit is shown as SOURCE whatever the
                            toggle says: its two readings are identical by
                            definition, so the reading would be the same
                            paragraph twice with the badge as the only clue
                            that anything changed. The one view in which the
                            change exists is the one it is shown in. */}
                        <For each={units()}>
                          {(unit) => (
                            <li>
                              <UnitCard
                                unit={unit}
                                decision={decisionFor(book().bookId, unit.id)}
                                currentText={textOf(
                                  services.galley,
                                  book().leftText ?? "",
                                  unit.current,
                                  markup() || unit.isUsfmStructureChange,
                                )}
                                baselineText={textOf(
                                  services.galley,
                                  book().rightText ?? "",
                                  unit.baseline,
                                  markup() || unit.isUsfmStructureChange,
                                )}
                                currentLabel={leftLabel()}
                                baselineLabel={rightLabel()}
                                currentShort={leftShort()}
                                baselineShort={rightShort()}
                                decidable={target() !== undefined}
                                markup={markup() || unit.isUsfmStructureChange}
                                onDecide={(side) => decide(book().bookId, unit.id, side)}
                              />
                            </li>
                          )}
                        </For>
                        <Show when={units().length === 0}>
                          <Card>
                            <EmptyState
                              icon={<Check size={20} />}
                              title={t("Nothing differs in {book}.", {
                                book: nameOf(book().bookId),
                              })}
                            />
                          </Card>
                        </Show>
                      </ul>
                    </Show>
                  )}
                </Show>
              </div>

              <Dialog
                open={confirming()}
                onOpenChange={setConfirming}
                title={t("Apply to this project")}
                description={t("These books will be written. Each one is a single Undo step.")}
                footer={
                  <>
                    <Button variant="tertiary" onClick={() => setConfirming(false)}>
                      {t("Cancel")}
                    </Button>
                    <Button variant="primary" onClick={apply} data-review-confirm>
                      {t("Apply")}
                    </Button>
                  </>
                }
              >
                <ul class="space-y-1">
                  <For each={currentPlan()?.writes ?? []}>
                    {(book) => (
                      <li class="flex items-center gap-2 text-small">
                        <Badge tone="warning" size="sm">
                          {t("rewritten")}
                        </Badge>
                        <span class="font-medium">{nameOf(book.bookId)}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </Dialog>
            </>
          )}
        </Show>
      </Show>
    </main>
  );
}
