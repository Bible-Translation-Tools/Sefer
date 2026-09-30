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
 * **Editability is a property of what is loaded.** The one side that can be
 * written is the working text (`CompareSource.canApply`: only the open
 * project says yes), and it always sits on the left — picking it on the right
 * swaps the sides. Then the review is the editor: every card edits the Book
 * itself on a double-click, as every card in Sefer does, and "Keep" / "Take"
 * writes into it at once, one Undo step each. When neither side can be
 * written (two folders, two versions) the review is for reading: no Edit, no
 * double-click, no decisions. There is no "decide, then apply" mode: a
 * decision somebody has to remember to apply later is a decision that gets
 * lost.
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
import MoreVertical from "lucide-solid/icons/more-vertical";
import Save from "lucide-solid/icons/save";
import Scale from "lucide-solid/icons/scale";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";

import { trustedBy, type BookId } from "#core/book/book";
import {
  bookComparison,
  compareBooks,
  type BookComparison,
  type CompareResult,
  type CompareSource,
} from "#core/compare";
import { diffSkeleton, type SkeletonResult } from "#core/diff/skeleton";
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
  usePageLeading,
} from "../primitives";
import { RecoveryBanner } from "../recovery/RecoveryBanner";
import { bookName } from "../workspace/books";
import { metadataOf } from "../workspace/project";
import { ReviewReader, type ReviewBook } from "./ReviewReader";
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
  const pageLeading = usePageLeading();
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
  /**
   * A book somebody decided in stays in the review though it now reads the
   * same on both sides: a take that made it identical keeps its card, with
   * "put back", rather than vanishing under the click.
   */
  const decidedIn = (bookId: BookId): boolean => {
    for (const key of untrack(decisions).keys()) if (key.startsWith(`${bookId}\0`)) return true;
    return false;
  };
  const inReview = (book: BookComparison): boolean => !book.identical || decidedIn(book.bookId);

  const skeletonsOf = (found: CompareResult): ReadonlyMap<BookId, SkeletonResult> => {
    const held = new Map<BookId, SkeletonResult>();
    for (const book of found.books) {
      if (!inReview(book) || book.leftText === undefined || book.rightText === undefined) continue;
      held.set(
        book.bookId,
        // The engine sends changed units only; a book somebody decided in
        // needs its unchanged ones too, because a take makes the unit read the
        // same on both sides and its card must stay, to put it back.
        diffSkeleton(services.galley, book.bookId, book.rightText, book.leftText, {
          unchanged: decidedIn(book.bookId),
        }),
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

  /**
   * A new comparison starts with no decisions. Takes already written stay in
   * the text — they are edits now, like any other, one Undo each — and the
   * texts recorded to put them back go too: they described the review that
   * ended, and a put back after the switch restored text from it.
   */
  const startOver = (): void => {
    setDecisions(new Map());
    originals.clear();
    setReceipt("");
  };

  const pick = (side: "left" | "right", id: string): void => {
    const choice = choiceOf(id);
    // The working text is the side that edits, and it sits on the left.
    if (side === "right" && id === "project") {
      const wasId = leftId();
      const wasPicked = leftPicked();
      setLeftId(id);
      setLeftPicked(undefined);
      setRightId(wasId);
      setRightPicked(wasPicked);
      startOver();
      return;
    }
    if (side === "left") {
      setLeftId(id);
      setLeftPicked(undefined);
    } else {
      setRightId(id);
      setRightPicked(undefined);
    }
    startOver();
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

  const changed = (): readonly BookComparison[] => {
    // Tracked here: a decision cleared lets an identical book go.
    decisions();
    return result()?.books.filter(inReview) ?? [];
  };
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
        diffSkeleton(services.galley, book.bookId, book.rightText, book.leftText, {
          unchanged: decidedIn(book.bookId),
        })
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
        // A taken unit in an editable review is unchanged now, and still counts.
        if (unit.status === "unchanged" && held === undefined) continue;
        total += 1;
        if (held !== undefined) decided += 1;
      }
    return { total, decided };
  };

  // --- writing into the working text ------------------------------------------

  /**
   * Whether this review edits: the left side is the working text. Each
   * decision is then written into it as it is made, and the current pane is
   * the Book itself. The file is still written only by Record a version.
   */
  const editable = (): boolean => target() === "left" && leftId() === "project";

  /**
   * The target's text for a book when the review first wrote into it, so a
   * take can be put back: merging the ORIGINAL's unit into the live text is
   * exactly "undo that one", whatever else was written since.
   */
  const originals = new Map<BookId, string>();

  /**
   * A decision written into the working text at once, as the engine's EDITS
   * over the live text: only the chosen units move, everything else keeps its
   * offsets, and it is one apply — one Undo step — through the one write path.
   */
  const writeNow = (
    bookId: BookId,
    staticUnits: readonly DecisionUnit[],
    side: MergeSide | undefined,
  ): void => {
    const book = shell.project()?.book(bookId);
    const other = reviewBooks().find((entry) => entry.bookId === bookId);
    const live = book?.source().text;
    if (book === undefined || other === undefined || live === undefined) return;
    const taking = side === "baseline";
    const putBack = staticUnits.filter((unit) => decisionFor(bookId, unit.id) === "baseline");
    const op = services.composition.observability.operation("review.diff.take", {
      "review.book": bookId,
      "review.units": staticUnits.length,
      "review.side": side ?? "clear",
    });
    // Where the chosen units come from: the other side for a take, the text
    // as the review first found it for a put back.
    const from = taking ? other.baselineText : originals.get(bookId);
    const chosen = taking ? staticUnits : putBack;
    if (taking && !originals.has(bookId)) originals.set(bookId, live);
    decide(bookId, staticUnits, side);
    if (from === undefined || chosen.length === 0) {
      op.end("passed", { "review.wrote": false });
      return;
    }
    // The unit ids are the review's, and the engine names a unit by its
    // CURRENT side's address — so the merge is taken with the live text as
    // the current side, exactly as the review's diff took it. (Diffed the
    // other way round, a verse bridged on one side — `\v 5` against
    // `\v 5-6` — got another id, and the take failed or found a different
    // unit.) Then the edits from the live text to that result, a diff that
    // names no unit.
    const merged = services.galley.merge(
      from,
      live,
      new Map(chosen.map((unit) => [unit.id, "baseline" as const])),
      "current",
    );
    if (Result.isFailure(merged)) {
      op.end("refused", { "review.reason": "merge" });
      setNote(merged.failure.description);
      return;
    }
    const splices = services.galley.mergeSplices(live, merged.success, new Map(), "current");
    if (Result.isFailure(splices)) {
      op.end("refused", { "review.reason": "merge" });
      setNote(splices.failure.description);
      return;
    }
    if (splices.success.length === 0) {
      op.end("passed", { "review.wrote": false });
      return;
    }
    const applied = book.apply(splices.success, "compare", trustedBy("compare"));
    op.end(Result.isSuccess(applied) ? "passed" : "refused", {
      "review.wrote": Result.isSuccess(applied),
      "review.splices": splices.success.length,
    });
    if (Result.isFailure(applied)) setNote(describe(applied.failure));
    shell.changed({ kind: "book.apply", books: [bookId] });
  };

  const decideAny = (
    bookId: BookId,
    staticUnits: readonly DecisionUnit[],
    side: MergeSide | undefined,
  ): void => {
    if (editable()) writeNow(bookId, staticUnits, side);
  };

  /**
   * "Clear every decision": in an editable review that means taking the takes
   * back, as each book's own Clear does — through `writeNow`, one Undo step
   * per book. Resetting the map alone left the takes written, their cards
   * gone, and only Undo to reach them.
   */
  const clearEverything = (): void => {
    if (!editable()) {
      setDecisions(new Map());
      return;
    }
    for (const book of reviewBooks()) {
      const decided = book.skeleton.units.filter(
        (unit) => decisionFor(book.bookId, unit.id) !== undefined,
      );
      if (decided.length > 0) writeNow(book.bookId, decided, undefined);
    }
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
          {pageLeading()}
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
                <ChevronDown aria-hidden="true" />
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
                icon={<Save />}
                data-review-record
                disabled={unsaved().length === 0}
                title={t("{count} book(s) are not in their files yet.", {
                  count: unsaved().length,
                })}
                onClick={() => setRecordOpen(true)}
              >
                {t("Record a version…")}
              </Button>
            </Show>
            <Menu
              label={t("Review actions")}
              side="bottom"
              align="end"
              class="w-60"
              trigger={
                <IconButton size="sm" label={t("More review actions")} icon={<MoreVertical />} />
              }
            >
              <MenuItem
                icon={<Eraser aria-hidden="true" />}
                disabled={decisions().size === 0}
                onSelect={clearEverything}
              >
                {t("Clear every decision")}
              </MenuItem>
              <MenuItem
                icon={<History aria-hidden="true" />}
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

        {/* An earlier session's unsaved work: the one prompt every project
            screen shows, answered once. Review keeps no list of its own. */}
        <RecoveryBanner />

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
                decidable={editable()}
                usfm={markup()}
                onUsfm={setMarkup}
                currentLabel={leftLabel()}
                baselineLabel={rightLabel()}
                currentShort={leftShort()}
                baselineShort={rightShort()}
                selected={selected()}
                onSelect={setSelected}
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
                icon={<Save />}
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
      </Show>
    </main>
  );
}
