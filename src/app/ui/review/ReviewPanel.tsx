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
import ChevronDown from "lucide-solid/icons/chevron-down";
import Eraser from "lucide-solid/icons/eraser";
import History from "lucide-solid/icons/history";
import LifeBuoy from "lucide-solid/icons/life-buoy";
import MoreVertical from "lucide-solid/icons/more-vertical";
import Save from "lucide-solid/icons/save";
import Scale from "lucide-solid/icons/scale";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";

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
import type { EditorBook } from "#editor/index";

import { describe, reasonOf } from "../../describe";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { unsavedChanges } from "../panels/changes";
import { ago, exact } from "../panels/format";
import { createRecordedVersion } from "../panels/recorded";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  Popover,
  Select,
  toasts,
} from "../primitives";
import { bookName } from "../workspace/books";
import { metadataOf } from "../workspace/project";
import { ReviewReader, type ReviewBook, type ReviewMode } from "./ReviewReader";
import { sourceChoices, type SourceChoice } from "./sources";

/** The author every Sefer commit carries until accounts reach this screen. */
const AUTHOR = { name: "Sefer", email: "sefer@localhost" } as const;

/** How long typing pauses before the review compares again: the cards' pause. */
const TYPING_PAUSE_MS = 400;

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
  const [recordOpen, setRecordOpen] = createSignal(false, { name: "reviewRecordOpen" });
  const [sourcesOpen, setSourcesOpen] = createSignal(false, { name: "reviewSourcesOpen" });
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

  /** Every changed book's decision units, one engine diff each. */
  const skeletonsOf = (found: CompareResult): ReadonlyMap<BookId, SkeletonResult> => {
    const held = new Map<BookId, SkeletonResult>();
    for (const book of found.books) {
      if (book.identical || book.leftText === undefined || book.rightText === undefined) continue;
      held.set(
        book.bookId,
        diffSkeleton(services.galley, book.bookId, book.rightText, book.leftText),
      );
    }
    return held;
  };

  /**
   * The units the last comparison took, for the result it took them for. A
   * plain variable, not a signal: `result` is the signal, and this is only
   * what `skeletons` reads when it runs for that same result.
   */
  let computed:
    | {
        readonly result: CompareResult;
        readonly skeletons: ReadonlyMap<BookId, SkeletonResult>;
      }
    | undefined;

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
    // One comparison, one record: what it cost and how big the answer was.
    // The sides by KIND only — a picked folder's label is somebody's path.
    const comparing = services.composition.observability.operation("review.compare", {
      "review.left": leftId(),
      "review.right": rightId(),
      "review.live": live(),
    });
    const compared = comparing.span("review.books");
    void services
      .run(Effect.provideService(compareBooks(a, b), Observability, comparing))
      .then((found) => {
        compared({ "review.books": found.books.length });
        running = false;
        // The engine's decision units, taken here rather than on first read
        // so the comparison's record carries them; `skeletons` below reads
        // this and diffs nothing twice.
        const units = comparing.span("review.units");
        const held = skeletonsOf(found);
        let unitCount = 0;
        let refusedBooks = 0;
        for (const skeleton of held.values()) {
          if (Result.isFailure(skeleton)) refusedBooks += 1;
          else
            unitCount += skeleton.success.units.filter(
              (unit) => unit.status !== "unchanged",
            ).length;
        }
        units({ "review.unit_books": held.size });
        comparing.end(refusedBooks > 0 ? "refused" : "passed", {
          "review.books": found.books.length,
          "review.changed": found.changedBooks,
          "review.left_only": found.leftOnly,
          "review.right_only": found.rightOnly,
          "review.unit_books": held.size,
          "review.units": unitCount,
          "review.refused_books": refusedBooks,
        });
        computed = { result: found, skeletons: held };
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
        compared();
        // A side that could not be read is the comparison refusing, in its
        // own vocabulary; anything without a reason is the alarm.
        const reason = reasonOf(cause);
        comparing.end(reason === undefined ? "failed" : "refused", {
          "review.reason": reason ?? "unknown",
        });
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
  let lastSides: string | undefined;
  let typing: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (typing !== undefined) clearTimeout(typing);
  });
  createEffect(
    () => ({
      sides: `${leftId()}:${rightId()}:${leftPicked()?.id ?? ""}:${rightPicked()?.id ?? ""}:${
        version.recorded().head ?? ""
      }`,
      text: live() ? revisions() : "",
    }),
    ({ sides }) => {
      // The compute above IS the dependency list; what this reads is a
      // one-time snapshot of the state that key describes, so `untrack` says so.
      //
      // New SIDES compare at once. A book's text moving — typing, in a card or
      // the editor — compares at a pause, batched: one comparison per burst
      // rather than per keystroke, the way every card re-takes its results.
      // The engine's diff is cached by text, so that one comparison re-diffs
      // only the book that moved.
      if (typing !== undefined) clearTimeout(typing);
      if (sides !== lastSides) {
        lastSides = sides;
        untrack(runCompare);
        return;
      }
      typing = setTimeout(() => {
        typing = undefined;
        untrack(runCompare);
      }, TYPING_PAUSE_MS);
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
  /**
   * A card is being edited. The edit that makes the last book identical is
   * still under way in its card, so the reader stays until Done — the card
   * held there as "No longer a change" — and only then says "No differences."
   */
  const [cardEditing, setCardEditing] = createSignal(false, { name: "reviewCardEditing" });

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
      const found = result();
      if (found === undefined) return new Map();
      // The comparison took them already, inside its own record; a result
      // that did not come through `runCompare` is diffed here as before.
      return computed?.result === found ? computed.skeletons : skeletonsOf(found);
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

  const decisionFor = (bookId: BookId, unitId: string): MergeSide | undefined =>
    decisions().get(keyOf(bookId, unitId));

  /**
   * One decision, or many at once — a card's or a book's. A snapshot on
   * purpose: a bulk decision is about the units as they were when the button
   * was pressed.
   */
  const decide = (
    bookId: BookId,
    staticUnits: readonly DecisionUnit[],
    side: MergeSide | undefined,
  ): void => {
    setDecisions((held) => {
      const next = new Map(held);
      for (const unit of staticUnits) {
        const key = keyOf(bookId, unit.id);
        if (side === undefined) next.delete(key);
        else next.set(key, side);
      }
      return next;
    });
  };

  /**
   * Every book both sides hold and the engine diffed, as the reading draws
   * it. A book the engine refused is not here; `diffRefusal` says why.
   */
  const reviewBooks = createMemo(
    (): readonly ReviewBook[] => {
      const out: ReviewBook[] = [];
      for (const book of changed()) {
        if (book.leftText === undefined || book.rightText === undefined) continue;
        const found = skeletons().get(book.bookId);
        if (found === undefined || Result.isFailure(found)) continue;
        out.push({
          bookId: book.bookId,
          name: nameOf(book.bookId),
          currentText: book.leftText,
          baselineText: book.rightText,
          skeleton: found.success,
        });
      }
      return out;
    },
    { name: "reviewBooks" },
  );

  /** How many units have been ruled on across the whole review, of how many. */
  const totals = () => {
    let total = 0;
    let decided = 0;
    for (const book of reviewBooks())
      for (const unit of book.skeleton.units) {
        const held = decisionFor(book.bookId, unit.id);
        // A taken unit in Result mode is unchanged now, and still counts.
        if (unit.status === "unchanged" && held === undefined) continue;
        total += 1;
        if (held !== undefined) decided += 1;
      }
    return { total, decided };
  };

  // --- result mode -------------------------------------------------------------

  /**
   * `result` writes each decision into the target as it is made, and the
   * current pane is the target itself: editable, because it is the working
   * text. Only when that is what the left side is — the project, in the
   * editor. Everything else about the review stays: the file is still written
   * only by Record a version, and each take is one Undo step.
   */
  const [mode, setMode] = createSignal<ReviewMode>("compare", { name: "reviewMode" });
  const resultAvailable = (): boolean => target() === "left" && leftId() === "project";
  const resultMode = (): boolean => mode() === "result" && resultAvailable();

  /**
   * The target's text for a book when the review first wrote into it, so a
   * take can be put back: merging the ORIGINAL's unit into the live text is
   * exactly "undo that one", whatever else was written since.
   */
  const originals = new Map<BookId, string>();

  const writeNow = (
    bookId: BookId,
    staticUnits: readonly DecisionUnit[],
    side: MergeSide | undefined,
  ): void => {
    const project = shell.project();
    const into = left();
    const other = reviewBooks().find((book) => book.bookId === bookId);
    const live = project?.book(bookId)?.source().text;
    if (into?.apply === undefined || other === undefined || live === undefined) return;
    const taking = side === "baseline";
    const putBack = staticUnits.filter((unit) => decisionFor(bookId, unit.id) === "baseline");
    const op = services.composition.observability.operation("review.diff.take", {
      "review.book": bookId,
      "review.units": staticUnits.length,
      "review.side": side ?? "clear",
    });
    let merged: Result.Result<string, unknown> | undefined;
    if (taking) {
      if (!originals.has(bookId)) originals.set(bookId, live);
      merged = mergeWithDecisions(
        services.galley,
        other.baselineText,
        live,
        new Map(staticUnits.map((unit) => [unit.id, "baseline" as const])),
        "current",
      );
    } else if (putBack.length > 0) {
      const original = originals.get(bookId);
      if (original !== undefined)
        merged = mergeWithDecisions(
          services.galley,
          original,
          live,
          new Map(putBack.map((unit) => [unit.id, "baseline" as const])),
          "current",
        );
    }
    decide(bookId, staticUnits, side);
    if (merged === undefined) {
      op.end("passed", { "review.wrote": false });
      return;
    }
    if (Result.isFailure(merged)) {
      op.end("refused", { "review.reason": "merge" });
      return;
    }
    const text = merged.success;
    void services
      .run(Effect.result(Effect.provideService(into.apply(bookId, text), Observability, op)))
      .then((done) => {
        op.end(Result.isSuccess(done) ? "passed" : "refused", { "review.wrote": true });
        if (Result.isFailure(done)) setNote(describe(done.failure));
        shell.changed({ kind: "book.apply", books: [bookId] });
      });
  };

  const decideAny = (
    bookId: BookId,
    staticUnits: readonly DecisionUnit[],
    side: MergeSide | undefined,
  ): void => {
    if (resultMode()) writeNow(bookId, staticUnits, side);
    else decide(bookId, staticUnits, side);
  };

  const seatBook = async (bookId: BookId): Promise<EditorBook | undefined> => {
    const project = shell.project();
    if (project === undefined) return undefined;
    const opened = await services.run(Effect.result(project.instantiate(bookId)));
    if (Result.isFailure(opened)) return undefined;
    return services.seated(bookId);
  };

  /** Books only one side holds: Review cannot add or remove a book yet. */
  const oneSided = (): readonly BookComparison[] =>
    changed().filter((book) => book.presence !== "both");

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
      // oxlint-disable-next-line solid/reactivity -- a promise continuation: runs once, when Apply settles
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
   * The journals worth OFFERING back: an earlier session's, whether or not its
   * book is open now. This session's own journal is the live backup of what is
   * on screen, and restoring it would replay edits the editor already shows.
   * (Not "a book nobody reopened": the book a session lands on is always
   * reopened, and its unsaved work was hidden, then overwritten by the first
   * keystroke.)
   */
  const recovered = (): readonly Restorable[] =>
    journals().filter((journal) => !journal.thisSession);

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

  /** The sources, said once: "In the editor ⇄ On disk". */
  const sourcesLabel = (): string => `${leftLabel()} ⇄ ${rightLabel()}`;

  return (
    <main class="flex h-full min-w-0 flex-col gap-2 px-4 pt-3 pb-2" data-review>
      <Show
        when={shell.project()}
        fallback={<EmptyState icon={<Scale size={22} />} title={t("Open a project first.")} />}
      >
        {/* ONE row of chrome. What is compared is a chip that opens the two
            pickers; how far along the review is, is a count; the one write is
            the primary button. Everything else is in the menu — the reading
            below is what this screen is for. */}
        <header class="flex min-w-0 flex-wrap items-center gap-2 pe-12" data-review-header>
          <h1 class="text-h3 font-semibold text-on-surface-primary">{t("Review")}</h1>
          <Popover
            label={t("What is compared")}
            align="start"
            class="w-[min(560px,90vw)]"
            open={sourcesOpen()}
            onOpenChange={setSourcesOpen}
            trigger={
              <Button size="sm" variant="secondary" data-review-sources title={sourcesLabel()}>
                <span class="max-w-[40ch] truncate">{sourcesLabel()}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </Button>
            }
          >
            <div class="space-y-3">
              <div class="grid gap-3 sm:grid-cols-2">
                <Picker side="left" />
                <Picker side="right" />
              </div>
              <Show when={leftId() === rightId()}>
                <p class="text-smallest text-on-surface-secondary">
                  {t("Pick two different sides: a text is not a review of itself.")}
                </p>
              </Show>
              <p class="text-smallest text-on-surface-tertiary">
                {t(
                  "A decision per difference, one write. Taking the other side's version and applying it is exactly what Revert means.",
                )}
              </p>
            </div>
          </Popover>
          <Show when={result()}>
            {(found) => (
              <span class="text-small text-on-surface-secondary tabular-nums" data-review-decided>
                <span data-review-changed={found().changedBooks}>
                  {t("{count} book(s) differ", { count: found().changedBooks })}
                </span>
                <Show when={totals().total > 0}>
                  {" · "}
                  {t("{decided} of {total} decided", {
                    decided: totals().decided,
                    total: totals().total,
                  })}
                </Show>
              </span>
            )}
          </Show>
          <Show when={target() === undefined && result() !== undefined}>
            <Badge tone="muted" data-review-readonly>
              {t("Reading only")}
            </Badge>
          </Show>
          <Show when={busy() !== ""}>
            <span class="text-smallest text-on-surface-tertiary">{busy()}</span>
          </Show>
          <Show when={note() !== ""}>
            <span class="min-w-0 truncate text-smallest text-on-surface-error" data-review-note>
              {note()}
            </span>
          </Show>
          <Show when={diffRefusal()}>
            {(reason) => (
              <span
                class="text-smallest text-on-surface-error"
                data-review-engine="missing"
                title={reason()}
              >
                {t("This build's engine has no diff door, so nothing can be compared.")}
              </span>
            )}
          </Show>

          <div class="ms-auto flex items-center gap-1.5">
            <Show when={receipt() !== ""}>
              <span class="text-smallest text-on-surface-success" data-review-receipt>
                {receipt()}
              </span>
            </Show>
            <Show when={target() !== undefined}>
              <Button
                size="sm"
                variant="secondary"
                icon={<Save size={14} />}
                data-review-record
                disabled={unsaved().length === 0}
                title={t("{count} book(s) are not in their files yet.", {
                  count: unsaved().length,
                })}
                onClick={() => setRecordOpen(true)}
              >
                {t("Record a version…")}
              </Button>
              <Show
                when={!resultMode()}
                fallback={
                  <Badge tone="brand" data-review-result>
                    {t("Each decision is written into the editor, one Undo step each")}
                  </Badge>
                }
              >
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
              </Show>
            </Show>
            <Menu
              label={t("Review actions")}
              side="bottom"
              align="end"
              class="w-60"
              trigger={
                <IconButton
                  size="sm"
                  label={t("More review actions")}
                  icon={<MoreVertical size={16} />}
                />
              }
            >
              <MenuItem
                icon={<Eraser size={14} aria-hidden="true" />}
                disabled={decisions().size === 0}
                onSelect={() => setDecisions(new Map())}
              >
                {t("Clear every decision")}
              </MenuItem>
              <MenuItem
                icon={<History size={14} aria-hidden="true" />}
                onSelect={() =>
                  void navigate({
                    to: "/project/$slug/history",
                    params: { slug: shell.slug() },
                    search: {},
                  })
                }
              >
                {t("History")}
              </MenuItem>
              <Show when={skeleton()}>
                <MenuSeparator />
                <p
                  class="px-3 pb-2 text-smallest text-on-surface-tertiary"
                  data-review-engine="engine"
                >
                  {t("Differences are the engine's: by verse, then by word.")}
                  <Show when={lastBackup()}>
                    {(at) => (
                      <span title={exact(at())} data-backup="last">
                        {" "}
                        {t("Working-state backup: {when}", { when: ago(at()) })}
                      </span>
                    )}
                  </Show>
                </p>
              </Show>
            </Menu>
          </div>
        </header>

        {/* Only when there is some: a backup nobody reopened, one line each. */}
        <Show when={recovered().length > 0}>
          <div
            class="flex flex-wrap items-center gap-2 rounded-md border border-brand/40 bg-brand-light/40 px-3 py-1.5"
            aria-label={t("Recovered work")}
          >
            <LifeBuoy size={14} class="text-brand" aria-hidden="true" />
            <span class="text-small font-medium">{t("Recovered work")}</span>
            <span class="text-smallest text-on-surface-secondary">
              {t("from an earlier session, never recorded:")}
            </span>
            <For each={recovered()}>
              {(journal) => (
                <span class="flex items-center gap-1" title={journal.path}>
                  <strong class="text-small">{journal.bookId}</strong>
                  <span class="text-smallest text-on-surface-tertiary">
                    {t("{count} edit(s)", { count: journal.entries.length })}
                  </span>
                  <Button size="sm" variant="primary" onClick={() => restore(journal)}>
                    {t("Restore")}
                  </Button>
                  <Button size="sm" variant="tertiary" onClick={() => discard(journal)}>
                    {t("Discard")}
                  </Button>
                </span>
              )}
            </For>
          </div>
        </Show>

        <Show when={result()} fallback={<EmptyState title={t("Nothing to review yet.")} />}>
          <Show
            when={changed().length > 0 || cardEditing()}
            fallback={
              <EmptyState
                icon={<Check size={20} />}
                title={t("No differences.")}
                description={t("Both sides hold exactly the same books and text.")}
              />
            }
          >
            <Show when={oneSided().length > 0}>
              <p class="text-smallest text-on-surface-secondary" data-review-one-sided>
                {t(
                  "Only one side holds {books}. A project's book set is fixed when it opens, so Review cannot add or remove a book yet.",
                  { books: oneSided().map(bookLabel).join(", ") },
                )}
              </p>
            </Show>
            <div class="flex min-h-0 flex-1 flex-col" data-review-units={totals().total}>
              <ReviewReader
                books={reviewBooks()}
                decision={decisionFor}
                decide={decideAny}
                decidable={target() !== undefined}
                usfm={markup()}
                onUsfm={setMarkup}
                currentLabel={leftLabel()}
                baselineLabel={rightLabel()}
                currentShort={leftShort()}
                baselineShort={rightShort()}
                selected={selected()}
                onSelect={setSelected}
                mode={resultMode() ? "result" : "compare"}
                onMode={(next) => {
                  setMode(next);
                  // The two modes mean different things by a decision: in
                  // Result a take is already written. Starting clean keeps a
                  // map from one being read as the other.
                  setDecisions(new Map());
                  originals.clear();
                }}
                resultAvailable={resultAvailable()}
                seat={seatBook}
                onEdited={(bookId) => shell.changed({ kind: "book.apply", books: [bookId] })}
                onEditing={setCardEditing}
              />
            </div>
          </Show>
        </Show>

        <Dialog
          open={recordOpen()}
          onOpenChange={setRecordOpen}
          title={t("Record a version")}
          description={t(
            "{count} book(s) are not in their files yet. Nothing is written on a timer: this writes the files and records the version together.",
            { count: unsaved().length },
          )}
          footer={
            <>
              <Button variant="tertiary" onClick={() => setRecordOpen(false)}>
                {t("Cancel")}
              </Button>
              <Button
                variant="primary"
                icon={<Save size={14} />}
                loading={recording()}
                disabled={unsaved().length === 0}
                data-review-record-confirm
                onClick={() => void record().then(() => setRecordOpen(false))}
              >
                {t("Record a version")}
              </Button>
            </>
          }
        >
          <label
            class="block pb-1 text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase"
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
              if (unsaved().length > 0) void record().then(() => setRecordOpen(false));
            }}
          />
        </Dialog>

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
      </Show>
    </main>
  );
}
