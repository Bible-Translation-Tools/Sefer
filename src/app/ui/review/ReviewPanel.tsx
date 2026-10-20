import type { EditorBook } from "@sefer/editor";
import { trustedBy, type BookId } from "@sefer/text/book";
import { useNavigate, useSearch } from "@tanstack/solid-router";
import { Effect, Option, Result } from "effect";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import CircleCheck from "lucide-solid/icons/circle-check";
import CircleX from "lucide-solid/icons/circle-x";
import Info from "lucide-solid/icons/info";
import Save from "lucide-solid/icons/save";
import Scale from "lucide-solid/icons/scale";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";

import {
  bookComparison,
  compareBooks,
  type BookComparison,
  type CompareResult,
  type CompareSource,
} from "#core/compare";
import { diffSkeleton, type SkeletonResult } from "#core/diff/skeleton";
import type { DecisionUnit, MergeSide } from "#core/galley";
import type { Author } from "#core/git/git";
import { Observability } from "#core/observability";
import type { Restorable } from "#core/recovery/recovery";
import { bookFacts, type Diff } from "#core/sync/facts";

import { personAuthor } from "../../author";
import { collaboration } from "../../collaboration";
import { describe, reasonOf } from "../../describe";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { recordVersion } from "../../recordVersion";
import {
  acceptSuggestion,
  COPY_REVIEW,
  copyRef,
  declineSuggestion,
  fetchCopy,
  reviewNeeded,
  suggestionRef,
  suggestMyChanges,
} from "../../suggestions";
import { sendAfterSave, sendNow, settleWithShared, type SendOutcome } from "../../syncActions";
import { setAuthorName, syncPreferences } from "../../syncSettings";
import { syncWatch } from "../../syncWatch";
import { forgetWriterWork, takeWriterWork, writerWatch } from "../../writerWatch";
import {
  combineRefusal,
  combineTrouble,
  offerRefusalCopy,
  receiveRefusal,
  sendOutcomeCopy,
} from "../cloud/copy";
import { SyncLine } from "../cloud/SyncLine";
import { unsavedChanges } from "../panels/changes";
import { ago } from "../panels/format";
import { createRecordedVersion } from "../panels/recorded";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Input,
  Popover,
  Select,
  Switch,
  toasts,
  usePageLeading,
} from "../primitives";
import { RecoveryBanner } from "../recovery/RecoveryBanner";
import { BackToEditor } from "../workspace/BackToEditor";
import { bookName } from "../workspace/books";
import { ChangesHistorySidebar } from "../workspace/ChangesHistorySidebar";
import { metadataOf } from "../workspace/project";
import { claimSidebar } from "../workspace/sidebarSlot";
import { ReviewReader, type ReviewBook } from "./ReviewReader";
import { sourceChoices, type SourceChoice } from "./sources";
import { SuggestionLine } from "./SuggestionLine";

const TYPING_PAUSE_MS = 400;

const LIVE = new Set(["project", "disk"]);

const keyOf = (bookId: BookId, unitId: string): string => `${bookId}\0${unitId}`;

type SettleOutcome = Awaited<ReturnType<typeof settleWithShared>>;

const refusedDetail = (outcome: Extract<SettleOutcome, { kind: "refused" }>): string => {
  if (outcome.receive !== undefined) return receiveRefusal(outcome.receive, outcome.books ?? []);
  if (outcome.combine !== undefined) return combineRefusal(outcome.combine);
  if (outcome.state !== undefined) return combineTrouble(outcome.state);
  return outcome.description;
};

const settledMessage = (copyReview: boolean, settledNames: readonly string[]): string => {
  const books = settledNames.join(", ");
  if (copyReview) {
    return settledNames.length === 0
      ? t("Combined with your copy")
      : t("Combined {books} with your copy", { books });
  }
  return settledNames.length === 0
    ? t("Combined with the shared project")
    : t("Combined {books} with the shared project", { books });
};

const sendAction = (
  outcome: SendOutcome,
): "see" | "copy" | "retry" | "send" | "open" | undefined => {
  if (outcome.kind === "held") return "send";
  if (outcome.kind !== "refused") return undefined;
  if (outcome.reason === "Rejected") return outcome.toCopy === true ? "copy" : "see";
  if (outcome.reason === "Unauthorized") return "open";
  return "retry";
};

export function ReviewPanel() {
  const shell = useShell();
  const pageLeading = usePageLeading();
  const navigate = useNavigate();
  const { services } = shell;
  // SAFETY: `strict: false` gives the union of every route's search; both fields are read as `unknown` and narrowed, never trusted.
  const search = useSearch({ strict: false }) as () => {
    readonly against?: unknown;
    readonly pull?: unknown;
    readonly copy?: unknown;
  };
  const pull = (): number | undefined => {
    const held = untrack(() => search().pull);
    return typeof held === "number" ? held : undefined;
  };
  const fromCopy = (): boolean => search().copy === 1;
  const theirsRef = (): string | undefined => {
    const number = pull();
    if (number !== undefined) return suggestionRef(number);
    if (!fromCopy()) return undefined;
    const branch = untrack(() => syncWatch.facts(shell.project()?.root)?.reading.branch);
    return branch === undefined ? undefined : copyRef(branch);
  };
  const againstShared = (): boolean => rightId() === "shared" || leftId() === "shared";
  onCleanup(
    claimSidebar(() => (
      <ChangesHistorySidebar active="changes" changes={0}>
        <p class="px-6 pt-3 text-small text-on-surface-tertiary">{t("Nothing differs.")}</p>
      </ChangesHistorySidebar>
    )),
  );
  const version = createRecordedVersion(shell);
  const shared = createRecordedVersion(shell, "shared", theirsRef);
  const common = createRecordedVersion(shell, "base", theirsRef);

  const [leftId, setLeftId] = createSignal("project", { name: "reviewLeftKind" });
  const initialRightId = (): string => {
    const against = untrack(() => search().against);
    if (against === "shared") return "shared";
    return against === "writer" ? "writer" : "disk";
  };
  const [rightId, setRightId] = createSignal(initialRightId(), { name: "reviewRightKind" });
  const againstWriter = (): boolean => rightId() === "writer" || leftId() === "writer";
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
  const markup = (): boolean => shell.mode() === "usfm";
  const setMarkup = (on: boolean): void => shell.setMode(on ? "usfm" : "default");
  const [message, setMessage] = createSignal("", { name: "reviewMessage" });
  const [busy, setBusy] = createSignal("", { name: "reviewBusy" });
  const [note, setNote] = createSignal("", { name: "reviewNote" });
  const [receipt, setReceipt] = createSignal("", { name: "reviewReceipt" });
  const [recording, setRecording] = createSignal(false, { name: "reviewRecording" });
  const [recordOpen, setRecordOpen] = createSignal(false, { name: "reviewRecordOpen" });
  const [author, setAuthor] = createSignal<Author | undefined>(undefined, { name: "reviewAuthor" });
  const [typedName, setTypedName] = createSignal("", { name: "reviewAuthorName" });
  const [sends, setSends] = createSignal(false, { name: "reviewSends" });
  const [broughtIn, setBroughtIn] = createSignal(false, { name: "reviewBroughtIn" });
  const [closeOnSave, setCloseOnSave] = createSignal(true, { name: "reviewCloseSuggestion" });
  const sendsLine = (): string => {
    const facts = collaboration.facts(shell.project()?.root);
    const copy = facts?.mode === "copy";
    const name = facts?.sendsTo;
    if (name === undefined)
      return copy
        ? t("This also sends your changes to your copy.")
        : t("This also sends your changes to the shared project.");
    return copy
      ? t("This also sends your changes to your copy, {name}.", { name })
      : t("This also sends your changes to the shared project, {name}.", { name });
  };
  const openRecord = (): void => {
    setRecordOpen(true);
    void services.run(personAuthor()).then((found) => setAuthor(Option.getOrUndefined(found)));
    const project = shell.project();
    if (project === undefined) return;
    void services
      .run(
        Effect.orElseSucceed(
          Effect.flatMap(services.git.open(project.root), (repo) => services.remote.origin(repo)),
          () => Option.none<string>(),
        ),
      )
      .then((origin) =>
        setSends(
          Option.isSome(origin) && syncPreferences(services.settings, project.root).sendOnSave,
        ),
      );
  };
  const [sourcesOpen, setSourcesOpen] = createSignal(false, { name: "reviewSourcesOpen" });
  const [journals, setJournals] = createSignal<readonly Restorable[]>([], {
    name: "reviewJournals",
  });

  const writerSide = () => {
    const project = shell.project();
    const work = writerWatch.facts(project?.root).work;
    if (project === undefined || work.length === 0) return undefined;
    const owners = [...new Set(work.map((each) => each.owner))];
    const texts = new Map<BookId, { text: string; stamp: { revision: number; length: number } }>();
    for (const book of project.books) {
      const text = book.source().text;
      texts.set(book.id, { text, stamp: { revision: 0, length: text.length } });
    }
    for (const each of work)
      texts.set(each.book, {
        text: each.proposal,
        stamp: { revision: 0, length: each.proposal.length },
      });
    return {
      label: t("From Writer ({owners})", { owners: owners.join(", ") }),
      texts: { head: `writer:${work.map((each) => each.head.slice(0, 7)).join("+")}`, texts },
    };
  };

  const sharedLabelWords = (): string | undefined => {
    if (pull() !== undefined) return t("The suggested changes");
    return fromCopy() ? t("Your copy") : undefined;
  };
  const sharedExplainerWords = (): string | undefined => {
    if (pull() !== undefined)
      return t("What the suggestion offers: its author's copy, as they last sent it.");
    return fromCopy() ? t("Your copy, as another of your devices last sent it.") : undefined;
  };

  const choices = (): readonly SourceChoice[] =>
    sourceChoices({
      services,
      project: shell.project(),
      baselineOf: (book) => services.save.baseline(book),
      recorded: version.recorded(),
      shared: shared.recorded(),
      sharedLabel: sharedLabelWords(),
      sharedExplainer: sharedExplainerWords(),
      writer: writerSide(),
    });

  const choiceOf = (id: string): SourceChoice | undefined =>
    choices().find((choice) => choice.id === id);

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

  const target = (): "left" | "right" | undefined => {
    if (left()?.canApply === true) return "left";
    return right()?.canApply === true ? "right" : undefined;
  };

  const live = (): boolean => LIVE.has(leftId()) || LIVE.has(rightId());

  const waitingFor = (): string | undefined => {
    for (const id of [leftId(), rightId()]) {
      const pending =
        (id === "shared" && !shared.recorded().read) ||
        (id === "recorded" && !version.recorded().read);
      if (pending) return choiceOf(id)?.shortLabel ?? t("the other side");
    }
    return undefined;
  };
  const [comparing, setComparing] = createSignal(false, { name: "reviewComparing" });

  const revisions = (): string => {
    const project = shell.project();
    if (project === undefined) return "";
    return project.books.map((book) => shell.stampOf(book.id)?.revision ?? -1).join(",");
  };

  let running = false;
  let again = false;

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
        diffSkeleton(services.galley, book.bookId, book.rightText, book.leftText, {
          unchanged: decidedIn(book.bookId),
        }),
      );
    }
    return held;
  };

  let computed:
    | {
        readonly result: CompareResult;
        readonly skeletons: ReadonlyMap<BookId, SkeletonResult>;
      }
    | undefined;

  const runCompare = (): void => {
    const a = left();
    const b = right();
    if (a === undefined || b === undefined || a.id === b.id || waitingFor() !== undefined) {
      setResult(undefined);
      return;
    }
    if (running) {
      again = true;
      return;
    }
    running = true;
    setComparing(true);
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
        setComparing(false);
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
        const reason = reasonOf(cause);
        comparing.end(reason === undefined ? "failed" : "refused", {
          "review.reason": reason ?? "unknown",
        });
        running = false;
        again = false;
        setComparing(false);
        setNote(describe(cause));
      });
  };

  let lastSides: string | undefined;
  let typing: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (typing !== undefined) clearTimeout(typing);
  });
  createEffect(
    () => ({
      sides: `${leftId()}:${rightId()}:${leftPicked()?.id ?? ""}:${rightPicked()?.id ?? ""}:${
        version.recorded().head ?? ""
      }:${shared.recorded().head ?? ""}:${version.recorded().read}:${shared.recorded().read}`,
      text: live() ? revisions() : "",
    }),
    ({ sides }) => {
      // Untracked on purpose: a one-time read, not a dependency (Solid 2: STRICT_READ_UNTRACKED).
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

  const startOver = (): void => {
    setDecisions(new Map());
    originals.clear();
    setReceipt("");
    setShowChoices(false);
  };

  const pick = (side: "left" | "right", id: string): void => {
    const choice = choiceOf(id);
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

  const changed = (): readonly BookComparison[] => {
    decisions();
    return result()?.books.filter(inReview) ?? [];
  };
  const [cardEditing, setCardEditing] = createSignal(false, { name: "reviewCardEditing" });

  const settled = (): boolean => {
    const found = result();
    return (
      found !== undefined &&
      found.changedBooks === 0 &&
      decisions().size > 0 &&
      !cardEditing() &&
      undecidedBoth() === 0
    );
  };
  const [showChoices, setShowChoices] = createSignal(false, { name: "reviewShowChoices" });

  const current = (): BookComparison | undefined => {
    const found = result();
    const bookId = selected();
    return found === undefined || bookId === undefined ? undefined : bookComparison(found, bookId);
  };

  const skeletons = createMemo(
    (): ReadonlyMap<BookId, SkeletonResult> => {
      const found = result();
      if (found === undefined) return new Map();
      return computed?.result === found ? computed.skeletons : skeletonsOf(found);
    },
    { name: "reviewSkeletons" },
  );

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

  const diffRefusal = (): string | undefined => {
    const found = selectedSkeleton();
    return found !== undefined && Result.isFailure(found) ? found.failure.description : undefined;
  };

  const decisionFor = (bookId: BookId, unitId: string): MergeSide | undefined =>
    decisions().get(keyOf(bookId, unitId));

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

  const changedSince = createMemo(
    (): ReadonlyMap<
      BookId,
      { readonly here: ReadonlySet<string>; readonly there: ReadonlySet<string> }
    > => {
      const out = new Map<BookId, { here: ReadonlySet<string>; there: ReadonlySet<string> }>();
      if (!againstShared()) return out;
      const base = common.recorded();
      const editorOnLeft = rightId() === "shared";
      const diff: Diff = (before, after) => {
        const found = services.galley.diff(before, after);
        return Result.isSuccess(found) ? found.success : undefined;
      };
      for (const book of reviewBooks()) {
        const ancestor = base.texts.get(book.bookId)?.text;
        if (ancestor === undefined) continue;
        const facts = bookFacts(
          {
            bookId: book.bookId,
            path: "",
            base: ancestor,
            mine: editorOnLeft ? book.currentText : book.baselineText,
            theirs: editorOnLeft ? book.baselineText : book.currentText,
          },
          diff,
        );
        out.set(book.bookId, { here: new Set(facts.mine.refs), there: new Set(facts.theirs.refs) });
      }
      return out;
    },
    { name: "reviewChangedSince" },
  );

  const originOf = (
    bookId: BookId,
    units: readonly DecisionUnit[],
  ): "there" | "here" | "both" | undefined => {
    const sides = changedSince().get(bookId);
    if (sides === undefined) return undefined;
    let here = false;
    let there = false;
    for (const unit of units)
      for (const sid of [unit.currentAddr?.sid, unit.baselineAddr?.sid]) {
        if (sid === undefined) continue;
        if (sides.here.has(sid)) here = true;
        if (sides.there.has(sid)) there = true;
      }
    if (here && there) return "both";
    if (here) return "here";
    if (there) return "there";
    return undefined;
  };

  const mineOnly = createMemo(
    (): ReadonlyMap<BookId, ReadonlySet<string>> => {
      const out = new Map<BookId, ReadonlySet<string>>();
      if (pull() === undefined) return out;
      for (const book of reviewBooks()) {
        const ids = new Set<string>();
        for (const unit of book.skeleton.units)
          if (unit.status !== "unchanged" && originOf(book.bookId, [unit]) === "here")
            ids.add(unit.id);
        if (ids.size > 0) out.set(book.bookId, ids);
      }
      return out;
    },
    { name: "reviewMineOnly" },
  );
  const mineOnlyCount = (): number =>
    [...mineOnly().values()].reduce((sum, ids) => sum + ids.size, 0);
  const [showMine, setShowMine] = createSignal(false, { name: "reviewShowMine" });

  const readerBooks = createMemo(
    (): readonly ReviewBook[] => {
      const books = reviewBooks();
      const hide = mineOnly();
      if (showMine() || hide.size === 0) return books;
      return books.map((book) => {
        const hidden = hide.get(book.bookId);
        return hidden === undefined ? book : { ...book, hidden };
      });
    },
    { name: "reviewReaderBooks" },
  );

  const offeredCount = (): number => {
    let count = 0;
    for (const book of reviewBooks())
      for (const unit of book.skeleton.units) if (unit.status !== "unchanged") count += 1;
    return count - mineOnlyCount();
  };

  const preset = (bookId: BookId, unit: DecisionUnit): MergeSide | undefined => {
    if (!againstShared()) return undefined;
    const origin = originOf(bookId, [unit]);
    if (origin === "there") return "baseline";
    return origin === "here" ? "current" : undefined;
  };

  const effectiveFor = (bookId: BookId, unitId: string): MergeSide | undefined => {
    const held = decisionFor(bookId, unitId);
    if (held !== undefined || !againstShared()) return held;
    const unit = reviewBooks()
      .find((book) => book.bookId === bookId)
      ?.skeleton.units.find((entry) => entry.id === unitId);
    return unit === undefined ? undefined : preset(bookId, unit);
  };

  const suggestionTally = (): { readonly offered: number; readonly taken: number } => {
    let offered = 0;
    let taken = 0;
    if (pull() === undefined) return { offered, taken };
    for (const side of decisions().values()) {
      offered += 1;
      if (side === "baseline") taken += 1;
    }
    for (const book of reviewBooks())
      for (const unit of book.skeleton.units) {
        if (unit.status === "unchanged" || decisionFor(book.bookId, unit.id) !== undefined)
          continue;
        offered += 1;
        if (preset(book.bookId, unit) === "baseline") taken += 1;
      }
    return { offered, taken };
  };
  const declineOnly = (): boolean => {
    const tally = suggestionTally();
    return tally.offered > 0 && tally.taken === 0;
  };
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

  const undecidedBoth = (): number => {
    if (!againstShared()) return 0;
    let count = 0;
    for (const book of reviewBooks())
      for (const unit of book.skeleton.units)
        if (
          unit.status !== "unchanged" &&
          decisionFor(book.bookId, unit.id) === undefined &&
          preset(book.bookId, unit) === undefined
        )
          count += 1;
    return count;
  };

  const totals = () => {
    let total = 0;
    let decided = 0;
    for (const book of reviewBooks())
      for (const unit of book.skeleton.units) {
        const held = effectiveFor(book.bookId, unit.id);
        if (unit.status === "unchanged" && held === undefined) continue;
        total += 1;
        if (held !== undefined) decided += 1;
      }
    return { total, decided };
  };

  const editable = (): boolean => target() === "left" && leftId() === "project";

  const originals = new Map<BookId, string>();

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
    const operation = services.composition.observability.operation("review.diff.take", {
      "review.book": bookId,
      "review.units": staticUnits.length,
      "review.side": side ?? "clear",
    });
    const from = taking ? other.baselineText : originals.get(bookId);
    const chosen = taking ? staticUnits : putBack;
    if (taking && !originals.has(bookId)) originals.set(bookId, live);
    decide(bookId, staticUnits, side);
    if (from === undefined || chosen.length === 0) {
      operation.end("passed", { "review.wrote": false });
      return;
    }
    const merged = services.galley.merge(
      from,
      live,
      new Map(chosen.map((unit) => [unit.id, "baseline" as const])),
      "current",
    );
    if (Result.isFailure(merged)) {
      operation.end("refused", { "review.reason": "merge" });
      setNote(merged.failure.description);
      return;
    }
    const splices = services.galley.mergeSplices(live, merged.success, new Map(), "current");
    if (Result.isFailure(splices)) {
      operation.end("refused", { "review.reason": "merge" });
      setNote(splices.failure.description);
      return;
    }
    if (splices.success.length === 0) {
      operation.end("passed", { "review.wrote": false });
      return;
    }
    const applied = book.apply(splices.success, "compare", trustedBy("compare"));
    operation.end(Result.isSuccess(applied) ? "passed" : "refused", {
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
    if (!editable()) return;
    const putBackPreset =
      side === undefined &&
      staticUnits.length > 0 &&
      staticUnits.every(
        (unit) => decisionFor(bookId, unit.id) === undefined && preset(bookId, unit) === "baseline",
      );
    writeNow(bookId, staticUnits, putBackPreset ? "current" : side);
  };

  const seatBook = async (bookId: BookId): Promise<EditorBook | undefined> => {
    const project = shell.project();
    if (project === undefined) return undefined;
    const opened = await services.run(Effect.result(project.instantiate(bookId)));
    if (Result.isFailure(opened)) return undefined;
    return services.seated(bookId);
  };

  const oneSided = (): readonly BookComparison[] =>
    changed().filter((book) => book.presence !== "both");

  const emptySide = (): string | undefined => {
    const books = result()?.books ?? [];
    if (books.length === 0) return undefined;
    if (books.every((book) => book.presence === "left")) return rightLabel();
    if (books.every((book) => book.presence === "right")) return leftLabel();
    return undefined;
  };

  const unsaved = () => unsavedChanges(shell);

  const defaultMessage = (): string => {
    const names = unsaved().map((book) => bookName(book.bookId, metadataOf(shell.project())));
    return names.length === 0 ? t("Edited") : t("Edited {books}", { books: names.join(", ") });
  };

  const decidedDescription = (): string => {
    if (againstShared())
      return t(
        "The editor now reads as you chose. Save to finish: it keeps your choices and joins your work with the shared project's.",
      );
    return unsaved().length > 0
      ? t("Both sides now read the same. Save to keep it.")
      : t("Both sides now read the same. Nothing is left to save.");
  };

  const settleOptions = (
    copyReview: boolean,
  ): { theirs?: ReturnType<typeof theirsRef>; sendTo?: "origin" } => {
    if (pull() !== undefined) return { theirs: theirsRef(), sendTo: "origin" };
    return copyReview ? { theirs: theirsRef() } : {};
  };

  const saveDescription = (): string => {
    if (!againstShared())
      return t("Your changes in {count} book(s) are written and kept as a version.", {
        count: unsaved().length,
      });
    return fromCopy()
      ? t(
          "The project's text is kept as you left it here: your choices, and anything you edited. A passage only your copy changed, that you didn't choose for, comes in. Its versions stay in the history either way, and this one goes on top, so the next send is an ordinary one.",
        )
      : t(
          "The project's text is kept as you left it here: your choices, and anything you edited. A passage only the shared project changed, that you didn't choose for, comes in. Everything else it changed arrives too, as one version.",
        );
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

  interface ReceiptLine {
    readonly tone: "success" | "warning" | "error" | "muted";
    readonly title: string;
    readonly detail?: string;
    readonly action?: "see" | "copy" | "retry" | "send" | "open" | "offer";
  }
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

  const receiptAction = (action: NonNullable<ReceiptLine["action"]>): void => {
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

  const seeCopy = (): void => {
    const project = shell.project();
    if (untrack(fromCopy) && untrack(() => search().against) === "shared") {
      if (project !== undefined) void fetchCopy(services, project).then(seeShared);
      return;
    }
    void navigate({
      to: "/project/$slug/review",
      params: { slug: shell.slug() },
      search: COPY_REVIEW,
    });
  };

  const seeShared = (): void => {
    shared.refresh();
    common.refresh();
    if (rightId() !== "shared" && leftId() !== "shared") pick("right", "shared");
  };

  let wasCopy = untrack(fromCopy);
  createEffect(
    () => `${String(search().against)}:${String(search().copy)}`,
    () => {
      const nowCopy = untrack(fromCopy);
      if (nowCopy !== wasCopy) untrack(startOver);
      wasCopy = nowCopy;
      const against = untrack(() => search().against);
      if (against === "shared") untrack(seeShared);
      if (against === "writer" && untrack(rightId) !== "writer" && untrack(leftId) !== "writer")
        untrack(() => pick("right", "writer"));
    },
  );

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

  createEffect(revisions, () => {
    untrack(reload);
  });

  const lastBackup = (): number | undefined => {
    let latest: number | undefined;
    for (const journal of journals())
      for (const entry of journal.entries)
        if (latest === undefined || entry.at > latest) latest = entry.at;
    return latest;
  };

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
          {props.side === "left" ? t("To") : t("From")}
        </span>
        <div class="flex items-center gap-2">
          <Select
            size="sm"
            wrapperClass="min-w-0"
            data-review-side={props.side}
            aria-label={props.side === "left" ? t("Compare to") : t("Compare from")}
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

  const sourcesLabel = (): string => `${rightLabel()} → ${leftLabel()}`;

  return (
    <main class="flex h-full min-w-0 flex-col gap-2 px-4 pt-3 pb-2" data-review>
      <Show
        when={shell.project()}
        fallback={<EmptyState icon={<Scale size={22} />} title={t("Open a project first.")} />}
      >
        <header class="flex min-h-12 min-w-0 flex-wrap items-center gap-2" data-review-header>
          {pageLeading()}
          <Popover
            label={t("What is compared")}
            align="start"
            class="w-[min(560px,90vw)]"
            open={sourcesOpen()}
            onOpenChange={setSourcesOpen}
            trigger={
              <button
                type="button"
                data-review-sources
                title={t("Change what is compared")}
                class="-mx-1.5 inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-start transition-colors hover:bg-button-tertiary-surface-hover"
              >
                <h1 class="min-w-0 truncate text-h3 font-semibold text-on-surface-primary">
                  {sourcesLabel()}
                </h1>
                <ChevronDown
                  size={18}
                  aria-hidden="true"
                  class="shrink-0 text-on-surface-tertiary"
                />
              </button>
            }
          >
            <div class="space-y-3">
              <div class="grid gap-3 sm:grid-cols-2">
                <Picker side="right" />
                <Picker side="left" />
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
                variant="primary"
                icon={<Save />}
                data-review-record
                disabled={unsaved().length === 0 && !againstShared()}
                title={
                  lastBackup() === undefined
                    ? t("Write and keep a version")
                    : t("Write and keep a version. Your work was last backed up {when}.", {
                        when: ago(lastBackup() ?? 0),
                      })
                }
                onClick={openRecord}
              >
                {t("Save")}
              </Button>
            </Show>
            <BackToEditor quiet />
          </div>
        </header>

        <SyncLine
          comparison={
            result() === undefined
              ? undefined
              : {
                  changes: totals().total,
                  books: result()?.changedBooks ?? 0,
                  decided: totals().decided,
                }
          }
          onSee={seeShared}
          seeing={againstShared()}
          onSeeWriter={() => pick("right", "writer")}
          seeingWriter={againstWriter()}
        />

        <Show when={pull()}>{(number) => <SuggestionLine number={number()} />}</Show>
        <Show when={pull() !== undefined && mineOnlyCount() > 0}>
          <p
            class="flex flex-wrap items-center gap-2 text-smallest text-on-surface-secondary"
            data-review-mine-only={mineOnlyCount()}
          >
            {t(
              "Your editor also has {count} change(s) that are not in this suggestion. They stay as they are.",
              { count: mineOnlyCount() },
            )}
            <Button size="sm" variant="tertiary" onClick={() => setShowMine((on) => !on)}>
              {showMine() ? t("Hide them") : t("Show them")}
            </Button>
          </p>
        </Show>

        <RecoveryBanner />

        <Show
          when={result()}
          fallback={
            <Show
              when={waitingFor() ?? (comparing() ? t("both sides") : undefined)}
              fallback={<EmptyState title={t("Nothing to review yet.")} />}
            >
              {(what) => (
                <div
                  class="flex items-center justify-center gap-2 py-10 text-small text-on-surface-secondary"
                  role="status"
                  data-review-waiting
                >
                  <span
                    aria-hidden="true"
                    class="size-4 animate-spin rounded-full border-2 border-on-surface-tertiary border-t-transparent"
                  />
                  {t("Reading {source}…", { source: what() })}
                </div>
              )}
            </Show>
          }
        >
          <Show
            when={changed().length > 0 || cardEditing()}
            fallback={
              <Show
                when={pull() !== undefined}
                fallback={
                  <EmptyState
                    icon={<Check size={20} />}
                    title={t("No differences.")}
                    description={t("Both sides hold exactly the same books and text.")}
                  />
                }
              >
                <SuggestionHere />
              </Show>
            }
          >
            <Show
              when={pull() !== undefined && !showMine() && offeredCount() === 0 && !cardEditing()}
            >
              <SuggestionHere />
            </Show>
            <Show when={oneSided().length > 0}>
              <p class="text-smallest text-on-surface-secondary" data-review-one-sided>
                <Show
                  when={emptySide()}
                  fallback={t(
                    "Only one side holds {books}. A project's book set is fixed when it opens, so Review cannot add or remove a book yet.",
                    {
                      books:
                        oneSided().length > 6
                          ? t("{count} books", { count: oneSided().length })
                          : oneSided().map(bookLabel).join(", "),
                    },
                  )}
                >
                  {(side) => t("{source} holds no books yet.", { source: side() })}
                </Show>
              </p>
            </Show>
            <Show when={settled() && showChoices()}>
              <p class="flex items-center gap-2 text-smallest text-on-surface-secondary">
                <Check size={14} aria-hidden="true" class="text-on-surface-success" />
                {t("Every change is decided.")}
                <Button size="sm" variant="tertiary" onClick={() => setShowChoices(false)}>
                  {t("Hide my choices")}
                </Button>
              </p>
            </Show>

            <Show when={settled() && !showChoices()}>
              <EmptyState
                icon={<Check size={20} />}
                title={t("Every change is decided")}
                description={decidedDescription()}
                action={
                  <div class="flex flex-wrap justify-center gap-2" data-review-settled>
                    <Show
                      when={target() !== undefined && (againstShared() || unsaved().length > 0)}
                    >
                      <Button variant="primary" icon={<Save />} onClick={openRecord}>
                        {t("Save")}
                      </Button>
                    </Show>
                    <Button variant="tertiary" onClick={() => setShowChoices(true)}>
                      {t("Show my choices")}
                    </Button>
                  </div>
                }
              />
            </Show>
            <div
              class={["flex min-h-0 flex-1 flex-col", { hidden: settled() && !showChoices() }]}
              data-review-units={totals().total}
            >
              <ReviewReader
                books={readerBooks()}
                originOf={originOf}
                decision={effectiveFor}
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
          onOpenChange={(open) => {
            setRecordOpen(open);
            if (!open) {
              setRecordedLine(undefined);
              setSendLine(undefined);
            }
          }}
          title={t("Save")}
          description={saveDescription()}
          footer={
            <Show
              when={recordedLine() === undefined}
              fallback={
                <Button
                  variant="primary"
                  disabled={sendLine() === "sending"}
                  data-review-record-done
                  onClick={() => {
                    closeRecord();
                    if (broughtIn()) {
                      setBroughtIn(false);
                      void navigate({
                        to: "/project/$slug/suggestions",
                        params: { slug: shell.slug() },
                      });
                    }
                  }}
                >
                  {t("Done")}
                </Button>
              }
            >
              <Button variant="tertiary" onClick={() => setRecordOpen(false)}>
                {t("Cancel")}
              </Button>
              <Button
                variant="primary"
                icon={<Save />}
                loading={recording()}
                disabled={
                  (unsaved().length === 0 && !againstShared()) ||
                  undecidedBoth() > 0 ||
                  declineOnly()
                }
                data-review-record-confirm
                onClick={() => void record()}
              >
                {t("Save")}
              </Button>
            </Show>
          }
        >
          <Show when={recordedLine()}>
            {(line) => (
              <div class="space-y-3" data-review-record-receipt>
                <Receipt line={line()} onAction={receiptAction} />
                <Show when={sendLine() === "sending"}>
                  <div class="flex items-center gap-2 text-small text-on-surface-secondary">
                    <span
                      aria-hidden="true"
                      class="size-4 animate-spin rounded-full border-2 border-on-surface-tertiary border-t-transparent"
                    />
                    {t("Sending to the shared project…")}
                  </div>
                </Show>
                <Show when={sentLine()}>
                  {(sent) => <Receipt line={sent()} onAction={receiptAction} />}
                </Show>
              </div>
            )}
          </Show>
          <Show when={recordedLine() === undefined && declineOnly()}>
            <form
              class="space-y-3"
              data-review-decline-only
              onSubmit={(event) => {
                event.preventDefault();
                declineFromDialog();
              }}
            >
              <p class="text-small text-on-surface-secondary">
                {t(
                  "You kept none of the suggested changes, so there is nothing to bring in. Decline the suggestion instead; its author reads your note.",
                )}
              </p>
              <Show when={unsaved().length > 0}>
                <p class="text-smallest text-on-surface-tertiary">
                  {t("Edits you typed here stay unsaved; save them from Changes afterwards.")}
                </p>
              </Show>
              <div class="flex items-center gap-2">
                <Input
                  wrapperClass="min-w-0 flex-1"
                  placeholder={t("Why? (optional)")}
                  value={declineNote()}
                  onInput={(event) => setDeclineNote(event.currentTarget.value)}
                />
                <Button type="submit" variant="secondary" loading={recording()}>
                  {t("Decline")}
                </Button>
              </div>
            </form>
          </Show>
          <Show when={recordedLine() === undefined && !declineOnly()}>
            <Show when={undecidedBoth() > 0}>
              <p class="pb-3 text-small text-on-surface-warning" data-review-undecided>
                {t(
                  "{count} passage(s) changed in both places still need a choice: keep yours or take the shared project's.",
                  { count: undecidedBoth() },
                )}
              </p>
            </Show>
            <Show when={author() === undefined}>
              <label
                class="block pb-1 text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase"
                for="author-name"
              >
                {t("Your name, as your team knows you")}
              </label>
              <Input
                id="author-name"
                wrapperClass="w-full pb-3"
                value={typedName()}
                onInput={(event) => setTypedName(event.currentTarget.value)}
              />
            </Show>
            <label
              class="block pb-1 text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase"
              for="commit-message"
            >
              {t("What did you change?")}
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
                if (unsaved().length > 0 || againstShared()) void record();
              }}
            />
            <p class="pt-1 text-smallest text-on-surface-tertiary">
              {t("Your team sees this, and so will you later.")}
            </p>
            <Show when={sends()}>
              <p class="pt-3 text-small text-on-surface-secondary" data-review-sends>
                {sendsLine()}
              </p>
            </Show>
            <Show when={pull() !== undefined}>
              <label
                class="flex items-start justify-between gap-3 pt-3"
                data-review-close-suggestion
              >
                <span>
                  <span class="block text-small font-medium">
                    {t("Close the suggestion as brought in")}
                  </span>
                  <span class="block text-smallest text-on-surface-tertiary">
                    {t(
                      "Turn off to keep it open — when you are taking part of it now and more later.",
                    )}
                  </span>
                </span>
                <Switch
                  aria-label={t("Close the suggestion as brought in")}
                  checked={closeOnSave()}
                  onChange={setCloseOnSave}
                />
              </label>
            </Show>
          </Show>
        </Dialog>
      </Show>
    </main>
  );
}

function Receipt(props: {
  readonly line: {
    readonly tone: "success" | "warning" | "error" | "muted";
    readonly title: string;
    readonly detail?: string;
    readonly action?: "see" | "copy" | "retry" | "send" | "open" | "offer";
  };
  readonly onAction: (action: "see" | "copy" | "retry" | "send" | "open" | "offer") => void;
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
  const label = (action: "see" | "copy" | "retry" | "send" | "open" | "offer"): string => {
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

function SuggestionHere() {
  return (
    <EmptyState
      icon={<Check size={20} />}
      title={t("Everything this suggestion offers is already in your editor.")}
      description={t(
        "You may have written it here, or taken it already. Save brings it into the shared project and closes the suggestion.",
      )}
    />
  );
}
