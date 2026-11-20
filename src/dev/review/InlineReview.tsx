import type { JSX } from "@solidjs/web";
import type { BookId } from "@wycliffeassociates/sefer-text/book";
import Braces from "lucide-solid/icons/braces";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Undo2 from "lucide-solid/icons/undo-2";
import X from "lucide-solid/icons/x";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";

import { designStandIn } from "#app/designStandIn";
import { BookDiff, changed, replacements, type BookDiffApi } from "#app/ui/diff";
import { createCardViews } from "#app/ui/multibuffer/cardViews";
import { Button, EmptyState, cx } from "#app/ui/primitives";
import { createPrepared } from "#app/ui/review/reader/createPrepared";
import { createSeats } from "#app/ui/review/reader/createSeats";
import type { ReviewBook } from "#app/ui/review/reader/types";
import type { PanelModel } from "#app/ui/review/ReviewPanel";
import type { Analysis, DecisionUnit, MergeSide } from "#core/galley";

/**
 * DESIGN EXPLORATION: Review drawn the way Google Docs and Notion draw
 * suggested edits. The same comparison and the same decisions as Review —
 * one card per changed verse, Accept keeps what happened since the last
 * version, Reject puts back what was there — presented as the text with its
 * changes in place and a card per change beside it. Reached from Review's
 * design panel, Layout: inline. Nothing here is copy for translation yet.
 */

interface Item {
  /** One per card: a verse both sides changed is two cards, one per side. */
  readonly key: string;
  readonly book: ReviewBook;
  readonly unit: DecisionUnit;
  readonly reference: string;
  /** The side Accept chooses: the editor's for a change made here, the other side's for one from there. */
  readonly accept: MergeSide;
  /** Who made the change: this editor's person, or the other side's. */
  readonly from: string;
  /** Both sides changed this verse: Accept takes theirs, Reject keeps the editor's. */
  readonly both: boolean;
  /**
   * What the change does, read while it still differed. Deciding it can make the
   * verse the same on both sides, and a description read then would say nothing
   * changed ("Formatting").
   */
  readonly editor: What;
  /** A change the normal view cannot show: only markup moved. */
  readonly usfmOnly: boolean;
}

type Outcome = "accepted" | "rejected" | undefined;

interface Point {
  readonly x: number;
  readonly y: number;
}

const other = (side: MergeSide): MergeSide => (side === "current" ? "baseline" : "current");

const referenceOf = (book: ReviewBook, unit: DecisionUnit): string => {
  const at = unit.currentAddr ?? unit.baselineAddr;
  if (at === undefined || at.kind === "frontMatter") return book.name;
  if (at.kind === "chapterOpen") return `${book.name} ${at.chapter}`;
  const verses = at.last > at.first ? `${at.first}–${at.last}` : `${at.first}`;
  return `${book.name} ${at.chapter}:${verses}`;
};

/** Plain words for a card: USFM markers out, unless the reader asked to see USFM. */
const words = (text: string, usfm: boolean): string =>
  usfm
    ? text.trim()
    : text
        .replace(/\\[a-z0-9-]+\*?\s?/giu, "")
        .replace(/\s+/gu, " ")
        .trim();

/** Runs that touch read as one phrase; a gap between them reads as "…". */
const joined = (
  runs: readonly { readonly from: number; readonly to: number; readonly text: string }[],
): string => {
  let out = "";
  let end: number | undefined;
  for (const run of runs) {
    out +=
      end === undefined || run.from <= end
        ? run.text
        : run.from === end + 1
          ? ` ${run.text}`
          : ` … ${run.text}`;
    end = run.to;
  }
  return out;
};

interface Part {
  readonly removed: string;
  readonly added: string;
}

interface What extends Part {
  readonly verb: "Add" | "Delete" | "Replace" | "Formatting";
  /** Each tracked change in the verse, in reading order: "love" → "dearly" pairs with itself, not with the verse's other words. */
  readonly parts: readonly Part[];
}

const partVerb = (part: Part): "Add" | "Delete" | "Replace" =>
  part.removed === "" ? "Add" : part.added === "" ? "Delete" : "Replace";

/** Taking the other person's words turns the diff around: theirs come in, the editor's go. */
const whatOf = (item: Item): What => {
  const what = item.editor;
  if (item.accept === "current") return what;
  const verb = what.verb === "Add" ? "Delete" : what.verb === "Delete" ? "Add" : what.verb;
  return {
    verb,
    removed: what.added,
    added: what.removed,
    parts: what.parts.map((part) => ({ removed: part.added, added: part.removed })),
  };
};

const editorWhat = (
  item: { readonly book: ReviewBook; readonly unit: DecisionUnit },
  usfm: boolean,
): What => {
  const { unit, book } = item;
  const visible = (what: string): boolean => what === "text" || (what === "markup" && usfm);
  if (unit.status === "added" && unit.current !== undefined)
    return {
      verb: "Add",
      removed: "",
      added: words(book.currentText.slice(unit.current.from, unit.current.to), usfm),
      parts: [],
    };
  if (unit.status === "deleted" && unit.baseline !== undefined)
    return {
      verb: "Delete",
      removed: words(book.baselineText.slice(unit.baseline.from, unit.baseline.to), usfm),
      added: "",
      parts: [],
    };
  const removed = words(
    joined(
      (unit.text?.baseline ?? []).filter(
        (run) => run.kind === "removed" && visible(run.what) && run.text.trim() !== "",
      ),
    ),
    usfm,
  );
  const added = words(
    joined(
      (unit.text?.current ?? []).filter(
        (run) => run.kind === "added" && visible(run.what) && run.text.trim() !== "",
      ),
    ),
    usfm,
  );
  const parts = replacements(unit, usfm)
    .map((part) => ({ removed: words(part.removed, usfm), added: words(part.added, usfm) }))
    .filter((part) => part.removed !== "" || part.added !== "");
  if (removed !== "" && added !== "") return { verb: "Replace", removed, added, parts };
  if (removed !== "") return { verb: "Delete", removed, added, parts };
  if (added !== "") return { verb: "Add", removed, added, parts };
  return { verb: "Formatting", removed, added, parts };
};

function createItems(panel: PanelModel) {
  const described = new Map<string, { readonly editor: What; readonly usfmOnly: boolean }>();
  const describe = (
    key: string,
    base: { readonly book: ReviewBook; readonly unit: DecisionUnit },
  ): { readonly editor: What; readonly usfmOnly: boolean } => {
    const held = described.get(key);
    if (held !== undefined && !changed(base.unit)) return held;
    const usfmOnly = editorWhat(base, false).verb === "Formatting";
    const fresh = { editor: editorWhat(base, usfmOnly), usfmOnly };
    described.set(key, fresh);
    return fresh;
  };
  return createMemo(
    (): readonly Item[] => {
      const out: Item[] = [];
      const theirs = designStandIn().author ?? panel.sides.rightShort();
      const mine = designStandIn().editor ?? "You";
      for (const book of panel.units.readerBooks()) {
        for (const unit of book.skeleton.units) {
          if (book.hidden?.has(unit.id) === true) continue;
          const decided = untrack(() => panel.decisions.decisionFor(book.bookId, unit.id));
          if (!changed(unit) && decided === undefined) continue;
          const reference = referenceOf(book, unit);
          const origin = panel.units.originOf(book.bookId, [unit]);
          const key = `${book.bookId} ${unit.id}`;
          const base = { book, unit, reference, key, ...describe(key, { book, unit }) };
          // One card per verse, so one decision per card: a verse both sides
          // changed is theirs to Accept, or the editor's to keep with Reject.
          if (origin === "both" || origin === "there")
            out.push({ ...base, accept: "baseline", from: theirs, both: origin === "both" });
          else out.push({ ...base, accept: "current", from: mine, both: false });
        }
      }
      return out;
    },
    { name: "inlineReviewItems" },
  );
}

function Quoted(props: { readonly text: string; readonly tone: "removed" | "added" }) {
  return (
    <span
      class={cx(
        "break-words",
        props.tone === "removed" ? "text-on-surface-tertiary line-through" : "text-brand",
      )}
    >
      “{props.text}”
    </span>
  );
}

function WhatHappened(props: { readonly what: What }) {
  return (
    <Show when={props.what.parts.length < 2} fallback={<PartsHappened parts={props.what.parts} />}>
      <OneChange what={props.what} />
    </Show>
  );
}

/** A verse with several tracked changes: one line each, where they stand in the verse. */
function PartsHappened(props: { readonly parts: readonly Part[] }) {
  return (
    <ul class="space-y-1 text-small text-on-surface-secondary" data-inline-parts>
      <For each={props.parts}>
        {(part) => (
          <li>
            <Show when={partVerb(part) === "Replace"}>
              <Quoted text={part.removed} tone="removed" /> →{" "}
              <Quoted text={part.added} tone="added" />
            </Show>
            <Show when={partVerb(part) === "Delete"}>
              Delete <Quoted text={part.removed} tone="removed" />
            </Show>
            <Show when={partVerb(part) === "Add"}>
              Add <Quoted text={part.added} tone="added" />
            </Show>
          </li>
        )}
      </For>
    </ul>
  );
}

function OneChange(props: { readonly what: What }) {
  return (
    <div class="space-y-1 text-small text-on-surface-secondary">
      <Show when={props.what.verb === "Replace"}>
        <p>
          Replace <Quoted text={props.what.removed} tone="removed" />
        </p>
        <p>
          With <Quoted text={props.what.added} tone="added" />
        </p>
      </Show>
      <Show when={props.what.verb === "Delete"}>
        <p>
          Delete <Quoted text={props.what.removed} tone="removed" />
        </p>
      </Show>
      <Show when={props.what.verb === "Add"}>
        <p>
          Add <Quoted text={props.what.added} tone="added" />
        </p>
      </Show>
      <Show when={props.what.verb === "Formatting"}>
        <p>Formatting changed</p>
      </Show>
    </div>
  );
}

function CardHead(props: {
  readonly item: Item;
  readonly end?: JSX.Element;
  /** The text shows USFM now; the badge on a markup-only change turns it on and off. */
  readonly usfm: boolean;
  readonly onToggleUsfm: () => void;
}) {
  return (
    <div class="flex min-w-0 items-center gap-2">
      <span
        aria-hidden="true"
        class="grid size-8 shrink-0 place-items-center rounded-full bg-surface-secondary text-smallest font-semibold text-on-surface-secondary uppercase"
      >
        {props.item.from.slice(0, 1)}
      </span>
      <span class="min-w-0 truncate text-small font-semibold text-on-surface-primary">
        {props.item.from}
      </span>
      <span class="min-w-0 flex-1 truncate text-small text-on-surface-secondary">
        {props.item.reference}
      </span>
      <Show when={props.item.usfmOnly}>
        <button
          type="button"
          title={props.usfm ? "Hide USFM" : "Only visible in USFM: show it"}
          aria-label={props.usfm ? "Hide USFM" : "Show USFM"}
          aria-pressed={props.usfm ? "true" : "false"}
          class="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md bg-surface-secondary text-on-surface-secondary hover:text-on-surface-primary aria-pressed:bg-surface-tertiary"
          data-inline-usfm
          onClick={(event: MouseEvent) => {
            event.stopPropagation();
            props.onToggleUsfm();
          }}
        >
          <Braces size={14} aria-hidden="true" />
        </button>
      </Show>
      {props.end}
    </div>
  );
}

function PendingCard(props: {
  readonly item: Item;
  readonly what: What;
  readonly active: boolean;
  readonly editable: boolean;
  readonly onActivate: () => void;
  readonly onDecide: (outcome: "accepted" | "rejected") => void;
  /** A decided card in Completed: marked, with Undo in place of the choices. */
  readonly outcome?: Outcome;
  readonly onUndo?: () => void;
  readonly usfm: boolean;
  readonly onToggleUsfm: () => void;
}) {
  const decided = (): boolean => props.outcome !== undefined;
  return (
    <div
      role="button"
      tabindex={0}
      data-inline-card={props.item.key}
      data-active={props.active ? "" : undefined}
      class="cursor-pointer space-y-3 rounded-xl bg-surface-primary p-4 transition-[box-shadow,opacity] data-active:shadow-medium not-data-active:opacity-60 not-data-active:hover:opacity-100"
      onClick={() => props.onActivate()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onActivate();
        }
      }}
    >
      <CardHead
        item={props.item}
        usfm={props.usfm}
        onToggleUsfm={props.onToggleUsfm}
        end={
          <Show when={props.outcome}>
            {(outcome) => (
              <span
                class={cx(
                  "flex shrink-0 items-center gap-1 text-small font-semibold",
                  outcome() === "accepted" ? "text-brand" : "text-on-surface-error",
                )}
                data-inline-outcome={outcome()}
              >
                <Show when={outcome() === "accepted"} fallback={<X size={16} aria-hidden="true" />}>
                  <Check size={16} aria-hidden="true" />
                </Show>
                {outcome() === "accepted" ? "Accepted" : "Rejected"}
              </span>
            )}
          </Show>
        }
      />
      <WhatHappened what={props.what} />
      <Show when={props.item.both}>
        <p class="text-smallest text-on-surface-tertiary" data-inline-both>
          You changed this verse too. Reject keeps your version.
        </p>
      </Show>
      <Show when={decided() && props.active && props.editable}>
        <Button
          size="md"
          variant="secondary"
          icon={<Undo2 />}
          class="w-full"
          data-inline-undo
          onClick={(event: MouseEvent) => {
            event.stopPropagation();
            props.onUndo?.();
          }}
        >
          Undo
        </Button>
      </Show>
      <Show when={!decided() && props.active && props.editable}>
        <div class="grid grid-cols-2 gap-2">
          <Button
            size="md"
            variant="secondary"
            icon={<Check />}
            data-inline-accept
            onClick={(event: MouseEvent) => {
              event.stopPropagation();
              props.onDecide("accepted");
            }}
          >
            Accept
          </Button>
          <Button
            size="md"
            variant="secondary"
            icon={<X />}
            data-inline-reject
            onClick={(event: MouseEvent) => {
              event.stopPropagation();
              props.onDecide("rejected");
            }}
          >
            Reject
          </Button>
        </div>
      </Show>
    </div>
  );
}

/** Decided cards, folded away at the end of the list: the same cards, marked. */
/** The Completed toggle beside Save and Cancel: decided cards fly into it. */
function CompletedToggle(props: {
  readonly count: number;
  readonly total: number;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={props.open ? "true" : "false"}
      class="ms-auto flex h-12 cursor-pointer items-center gap-2 rounded-lg px-3 text-[14px] font-medium text-on-surface-primary hover:bg-surface-primary"
      data-inline-completed-toggle
      onClick={() => props.onToggle()}
    >
      Completed
      <span class="text-on-surface-secondary tabular-nums" data-inline-completed-count>
        {props.count} / {props.total}
      </span>
      <ChevronDown
        size={20}
        aria-hidden="true"
        class={cx("text-on-surface-secondary transition-transform", props.open && "rotate-180")}
      />
    </button>
  );
}

/** Decided cards, shown under the toggle while it is open: the same cards, marked. */
function Completed(props: {
  readonly open: boolean;
  readonly done: readonly Item[];
  readonly outcomeOf: (item: Item) => Outcome;
  readonly activeKey: string | undefined;
  readonly editable: boolean;
  readonly onActivate: (item: Item) => void;
  readonly onUndo: (item: Item) => void;
  readonly usfm: boolean;
  readonly onToggleUsfm: () => void;
}) {
  return (
    <div class="flex flex-col gap-3 empty:hidden" data-inline-completed>
      <Show when={props.open}>
        <For each={props.done}>
          {(item) => (
            <PendingCard
              item={item}
              what={whatOf(item)}
              usfm={props.usfm}
              onToggleUsfm={props.onToggleUsfm}
              active={props.activeKey === item.key}
              editable={props.editable}
              outcome={props.outcomeOf(item)}
              onActivate={() => props.onActivate(item)}
              onDecide={() => {}}
              onUndo={() => props.onUndo(item)}
            />
          )}
        </For>
      </Show>
    </div>
  );
}

function createAnalysisOf(panel: PanelModel) {
  const analyzers = new Map<string, (text: string) => Analysis>();
  return (bookId: BookId, side: "current" | "baseline", text: string): Analysis => {
    const key = `${side}\0${bookId}`;
    let analyze = analyzers.get(key);
    if (analyze === undefined) {
      analyze = panel.shell.services.galley.memoize();
      analyzers.set(key, analyze);
    }
    return analyze(text);
  };
}

function TextPanel(props: {
  readonly panel: PanelModel;
  readonly book: ReviewBook | undefined;
  readonly active: Item | undefined;
  /** Bumped when a card is picked: only then does the text move to it. */
  readonly reveal: number;
  /** `onChange`: the click landed on a changed word itself, which alone opens the popup. */
  readonly onClickUnit: (bookId: BookId, unit: DecisionUnit, at: Point, onChange: boolean) => void;
  /** The pointer is over a decided change's underline: say what was decided. */
  readonly onHoverSettled: (bookId: BookId, unit: DecisionUnit, at: Point) => void;
  readonly onLeaveSettled: () => void;
  /** Scrolling the text moves the change away from anything pinned to it. */
  readonly onScroll: () => void;
  /** Drawn over the text, placed by the parent: the Accept / Reject popup. */
  readonly children?: JSX.Element;
}) {
  const panel = untrack(() => props.panel);
  const analysisOf = createAnalysisOf(panel);
  const prepared = createPrepared({
    books: () => (props.book === undefined ? [] : [props.book]),
    decidable: () => panel.writes.editable(),
    filter: () => "all",
    decision: (bookId, unitId) => panel.units.effectiveFor(bookId, unitId),
    views: createCardViews<never>("inlineReview"),
    analysisOf,
    label: (address) => untrack(() => panel.shell.location.label(address)),
    excerptSteps: () => 1,
    observability: panel.shell.services.composition.observability,
  });
  const liveFor = createSeats({
    wanted: () => (panel.writes.editable() ? props.book?.bookId : undefined),
    seat: (bookId) => panel.writes.seatBook(bookId),
    analysisOf,
  });
  const usfm = (): boolean => panel.shell.mode() === "usfm";

  let api: BookDiffApi | undefined;
  let host: HTMLDivElement | undefined;
  // A card picked shows its verse, unless the change is already on screen; the
  // first show of a book is BookDiff's `initial`.
  createEffect(
    () => props.reveal,
    () => {
      const item = untrack(() => props.active);
      if (item === undefined) return;
      requestAnimationFrame(() => {
        if (!onScreen(host)) api?.showUnit(item.unit);
      });
    },
  );

  // A reading measure of 45–75ch for the TEXT; the card hugs it plus Refine's 3rem a side
  // and 20px for the scrollbar,
  // so the card itself may run past 75ch. The card takes the scripture font and size only
  // so its `ch` is the text's `ch`; the editor and its children set their own type.
  return (
    <section
      class="relative flex min-h-0 w-full max-w-[calc(75ch+6rem+20px)] min-w-[calc(45ch+6rem+20px)] shrink flex-col overflow-hidden rounded-2xl bg-surface-primary font-[family-name:var(--font-scripture)] text-[length:var(--editor-font-size,18px)]"
      ref={(element: HTMLElement) => {
        // Scroll does not bubble; listen in the capture phase for the editor's scroller.
        element.addEventListener("scroll", () => props.onScroll(), { capture: true });
      }}
    >
      <Show when={prepared()[0]} fallback={<EmptyState title="Preparing…" />}>
        {(held) => (
          <div
            class={cx(
              "flex min-h-0 flex-1 flex-col",
              // The editor's stylesheet is unlayered, so these win only as !important.
              "[&_.cm-diff-added]:bg-transparent! [&_.cm-diff-added]:text-brand! [&_.cm-diff-added]:underline! [&_.cm-diff-added]:decoration-dotted! [&_.cm-diff-added]:underline-offset-4!",
              "[&_.cm-diff-removed]:bg-transparent! [&_.cm-diff-removed]:text-on-surface-tertiary! [&_.cm-diff-removed]:line-through!",
              "[&_.cm-diff-added.cm-diff-active]:decoration-solid! [&_.cm-diff-added.cm-diff-active]:decoration-2!",
              "[&_.cm-diff-settled]:underline [&_.cm-diff-settled]:decoration-on-surface-tertiary [&_.cm-diff-settled]:decoration-dotted [&_.cm-diff-settled]:underline-offset-4 [&_.cm-diff-ghost]:me-1 [&_.cm-diff-ghost]:select-none",
              // The word marks and the cards already say where each change is; no gutter bars.
              "[&_.cm-diff-bars]:hidden!",
              // No outline round the text: the card it sits in is the edge.
              "[&_.cm-diff-pane]:border-0!",
              // Refine's page padding (editor.css, `.cm-mode-regular .cm-content`), not the diff's 12px 16px.
              "[&_.cm-diff_.cm-content]:px-12! [&_.cm-diff_.cm-content]:pt-14! [&_.cm-diff_.cm-content]:pb-[30vh]!",
            )}
            data-inline-text
            ref={(element: HTMLDivElement) => {
              host = element;
            }}
            onMouseLeave={() => props.onLeaveSettled()}
            onMouseOver={(event: MouseEvent) => {
              const mark =
                event.target instanceof Element ? event.target.closest(".cm-diff-settled") : null;
              const section = host?.parentElement;
              const bookId = props.book?.bookId;
              if (mark === null) {
                props.onLeaveSettled();
                return;
              }
              if (section === null || section === undefined || bookId === undefined) return;
              const unit = api?.unitAt({ x: event.clientX, y: event.clientY });
              if (unit === undefined) return;
              const box = section.getBoundingClientRect();
              const at = mark.getBoundingClientRect();
              props.onHoverSettled(bookId, unit, {
                x: at.left - box.left + 64,
                y: at.top - box.top,
              });
            }}
            onClick={(event: MouseEvent) => {
              const unit = api?.unitAt({ x: event.clientX, y: event.clientY });
              const bookId = props.book?.bookId;
              const section = host?.parentElement;
              if (
                unit === undefined ||
                bookId === undefined ||
                section === undefined ||
                section === null
              )
                return;
              // The popup sits just above the clicked line, starting where the click was.
              const line =
                event.target instanceof Element ? event.target.closest(".cm-line") : null;
              const box = section.getBoundingClientRect();
              const top =
                line instanceof Element ? line.getBoundingClientRect().top : event.clientY;
              const onChange =
                event.target instanceof Element &&
                event.target.closest(".cm-diff-added, .cm-diff-removed") !== null;
              props.onClickUnit(
                bookId,
                unit,
                { x: event.clientX - box.left, y: top - box.top },
                onChange,
              );
            }}
          >
            <BookDiff
              class="min-h-0 flex-1"
              sides={held().sides}
              units={held().units}
              split={false}
              usfm={usfm()}
              controls={undefined}
              currentLabel=""
              baselineLabel=""
              observability={panel.shell.services.composition.observability}
              initial={props.active?.unit}
              live={props.book === undefined ? undefined : liveFor(props.book.bookId)}
              awaitLive={panel.writes.editable()}
              inlineRemoved
              hideLabel
              activeUnit={props.active?.unit.id}
              notes={(text) => (props.book === undefined ? [] : missingChapters(props.book, text))}
              settled={(unit) =>
                props.book !== undefined &&
                panel.decisions.decisionFor(props.book.bookId, unit.id) !== undefined
              }
              incoming={(unit) => {
                if (props.book === undefined) return false;
                const origin = panel.units.originOf(props.book.bookId, [unit]);
                return origin === "there" || origin === "both";
              }}
              ref={(given) => {
                api = given;
              }}
            />
          </div>
        )}
      </Show>
      {props.children}
    </section>
  );
}

// Chapters per book, Protestant canon (USFM ids): what a whole book holds.
const CHAPTERS: Readonly<Record<string, number>> = Object.fromEntries(
  (
    "GEN 50 EXO 40 LEV 27 NUM 36 DEU 34 JOS 24 JDG 21 RUT 4 1SA 31 2SA 24 1KI 22 2KI 25 1CH 29 " +
    "2CH 36 EZR 10 NEH 13 EST 10 JOB 42 PSA 150 PRO 31 ECC 12 SNG 8 ISA 66 JER 52 LAM 5 EZK 48 " +
    "DAN 12 HOS 14 JOL 3 AMO 9 OBA 1 JON 4 MIC 7 NAM 3 HAB 3 ZEP 3 HAG 2 ZEC 14 MAL 4 MAT 28 " +
    "MRK 16 LUK 24 JHN 21 ACT 28 ROM 16 1CO 16 2CO 13 GAL 6 EPH 6 PHP 4 COL 4 1TH 5 2TH 3 1TI 6 " +
    "2TI 4 TIT 3 PHM 1 HEB 13 JAS 5 1PE 5 2PE 3 1JN 5 2JN 1 3JN 1 JUD 1 REV 22"
  )
    .split(" ")
    .flatMap((word, at, all) => (at % 2 === 0 ? [[word, Number(all[at + 1])]] : [])),
);

/**
 * A row for every run of chapters the text lacks or leaves empty, one row per
 * run: "Psalms 4–150 · No content available", before the next chapter there is.
 */
function missingChapters(
  book: ReviewBook,
  text: string,
): readonly { readonly at: number; readonly text: string }[] {
  const starts = new Map<number, number>();
  const filled = new Set<number>();
  const found = [...text.matchAll(/^\\c\s+(\d+)/gmu)];
  found.forEach((match, at) => {
    const chapter = Number(match[1]);
    const end = found[at + 1]?.index ?? text.length;
    if (!starts.has(chapter)) starts.set(chapter, match.index);
    if (/\\v\s/u.test(text.slice(match.index, end))) filled.add(chapter);
  });
  const last = Math.max(CHAPTERS[book.bookId] ?? 0, ...starts.keys());
  const rows: { at: number; text: string }[] = [];
  let run: number | undefined;
  for (let chapter = 1; chapter <= last + 1; chapter++) {
    const missing = chapter <= last && !filled.has(chapter);
    if (missing) {
      run ??= chapter;
      continue;
    }
    if (run === undefined) continue;
    const span = run === chapter - 1 ? `${run}` : `${run}–${chapter - 1}`;
    // Before the next chapter's marker, or after the text when the run reaches the end.
    const at = chapter <= last ? (starts.get(chapter) ?? text.length) : text.length;
    rows.push({ at, text: `${book.name} ${span} · No content available` });
    run = undefined;
  }
  return rows;
}

/** One choice in the dark popup over the text: md (48px, 14px, 20px icon), no border. */
function PopupChoice(props: {
  readonly icon: JSX.Element;
  readonly onClick: () => void;
  readonly children: JSX.Element;
}) {
  return (
    <button
      type="button"
      class="flex h-12 cursor-pointer items-center gap-2 rounded-lg px-4 font-medium hover:bg-white/10"
      onClick={() => props.onClick()}
    >
      {props.icon}
      {props.children}
    </button>
  );
}

/** Every mark of the active change sits inside the text's visible area. */
function onScreen(host: HTMLElement | undefined): boolean {
  // BookDiff keeps other books mounted out of sight; only the laid-out scroller counts.
  const scroller = [...(host?.querySelectorAll(".cm-scroller") ?? [])].find(
    (candidate) => candidate.clientHeight > 0,
  );
  const marks = scroller?.querySelectorAll(".cm-diff-active");
  if (scroller === undefined || marks === undefined || marks.length === 0) return false;
  const view = scroller.getBoundingClientRect();
  return [...marks].every((mark) => {
    const box = mark.getBoundingClientRect();
    return box.top >= view.top && box.bottom <= view.bottom;
  });
}

export function InlineReview(props: { readonly panel: PanelModel }): JSX.Element {
  const panel = untrack(() => props.panel);
  const items = createItems(panel);

  const outcomeOf = (item: Item): Outcome => {
    // Only an explicit choice counts: the engine's presets still wait for one here.
    const decided = panel.decisions.decisionFor(item.book.bookId, item.unit.id);
    if (decided === undefined) return undefined;
    return decided === item.accept ? "accepted" : "rejected";
  };
  const pending = (): readonly Item[] => items().filter((item) => outcomeOf(item) === undefined);
  const done = (): readonly Item[] => items().filter((item) => outcomeOf(item) !== undefined);
  // A card just decided stays in the list a moment longer, folding shut, so the
  // list closes up under the reader instead of jumping.
  const [folding, setFolding] = createSignal<ReadonlySet<string>>(new Set(), {
    name: "inlineClosing",
  });
  const [completedOpen, setCompletedOpen] = createSignal(false, { name: "inlineCompletedOpen" });
  /** A decided card's ghost flies up into the Completed toggle while the card folds shut. */
  const flyToCompleted = (key: string): void => {
    const card = document.querySelector<HTMLElement>(`[data-inline-card="${CSS.escape(key)}"]`);
    const target = document.querySelector<HTMLElement>("[data-inline-completed-toggle]");
    if (card === null || target === null) return;
    const from = card.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    if (!(ghost instanceof HTMLElement)) return;
    ghost.removeAttribute("data-inline-card");
    Object.assign(ghost.style, {
      position: "fixed",
      left: `${from.left}px`,
      top: `${from.top}px`,
      width: `${from.width}px`,
      margin: "0",
      zIndex: "50",
      pointerEvents: "none",
      transformOrigin: "top left",
    });
    document.body.append(ghost);
    const dx = to.left + to.width / 2 - from.left - (from.width * 0.15) / 2;
    const dy = to.top + to.height / 2 - from.top - (from.height * 0.15) / 2;
    const flight = ghost.animate(
      [
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.15)`, opacity: 0 },
      ],
      { duration: 380, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
    );
    flight.onfinish = () => {
      ghost.remove();
      target
        .querySelector("[data-inline-completed-count]")
        ?.animate([{ transform: "scale(1.4)" }, { transform: "scale(1)" }], { duration: 200 });
    };
  };
  const listed = (): readonly Item[] =>
    items().filter((item) => outcomeOf(item) === undefined || folding().has(item.key));
  const close = (key: string): void => {
    setFolding((was) => new Set(was).add(key));
    setTimeout(() => {
      setFolding((was) => {
        const next = new Set(was);
        next.delete(key);
        return next;
      });
    }, 220);
  };

  const [activeKey, setActiveKey] = createSignal<string | undefined>(undefined, {
    name: "inlineActive",
  });
  const [reveal, setReveal] = createSignal(0, { name: "inlineReveal" });
  /** Make a card active and bring its verse into view in the text. */
  // Scroll the list itself: `scrollIntoView` here would be cancelled by the
  // text's own scroll to the change, which runs in the same frame.
  const showCard = (key: string, wait = 0): void => {
    // After the picked card has rendered as active (it grows its buttons).
    setTimeout(() => {
      const card = document.querySelector<HTMLElement>(`[data-inline-card="${CSS.escape(key)}"]`);
      const list = card?.closest("aside");
      if (card === null || card === undefined || list === null || list === undefined) return;
      const box = list.getBoundingClientRect();
      const at = card.getBoundingClientRect();
      if (at.top >= box.top && at.bottom <= box.bottom) return;
      const delta = at.top < box.top ? at.top - box.top - 16 : at.bottom - box.bottom + 16;
      list.scrollBy({ top: delta, behavior: "smooth" });
    }, wait);
  };
  /** `wait`: let a decided card fold shut first, so the next one is measured where it lands. */
  const pick = (key: string | undefined, wait = 0): void => {
    const picked = items().find((item) => item.key === key);
    if (picked !== undefined) setShownBook(picked.book.bookId);
    setActiveKey(key);
    setReveal((count) => count + 1);
    if (key !== undefined) showCard(key, wait);
  };
  /** The book on show: it changes only when the person picks a card in another book or Next book. */
  const [shownBook, setShownBook] = createSignal<BookId | undefined>(undefined, {
    name: "inlineBook",
  });
  const bookId = (): BookId | undefined =>
    shownBook() ?? pending()[0]?.book.bookId ?? panel.units.readerBooks()[0]?.bookId;
  const pendingHere = (): readonly Item[] =>
    pending().filter((item) => item.book.bookId === bookId());
  const active = (): Item | undefined => {
    const key = activeKey();
    return items().find((item) => item.key === key) ?? pendingHere()[0];
  };
  const book = (): ReviewBook | undefined =>
    panel.units.readerBooks().find((entry) => entry.bookId === bookId()) ?? active()?.book;
  /** The first undecided card in the next book that has one, after this book in reading order. */
  const nextBook = (): Item | undefined => {
    const books = panel.units.readerBooks().map((entry) => entry.bookId);
    const at = books.indexOf(bookId() ?? books[0]);
    // This book's followers first, then round to the start.
    const order = [...books.slice(at + 1), ...books.slice(0, Math.max(at, 0))];
    for (const next of order) {
      const found = pending().find((item) => item.book.bookId === next);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  // The text stays in the mode the person chose: deciding never switches it. A
  // markup-only card's badge shows USFM on request, and leaving Review puts the
  // mode back as it was.
  const modeBefore = untrack(() => panel.shell.mode());
  const usfm = (): boolean => panel.shell.mode() === "usfm";
  const toggleUsfm = (): void => panel.shell.setMode(usfm() ? "default" : "usfm");
  onCleanup(() => panel.shell.setMode(modeBefore));

  /** `stay`: decided from the text itself, so the text keeps its place; only the card list moves. */
  const decide = (item: Item, outcome: "accepted" | "rejected" | undefined, stay = false): void => {
    const side =
      outcome === undefined ? undefined : outcome === "accepted" ? item.accept : other(item.accept);
    // The next undecided card in this book becomes the active one, as a
    // suggestion list moves on; another book waits for "Next book".
    const after = pending().filter((each) => each.book.bookId === item.book.bookId);
    const at = after.findIndex((each) => each.key === item.key);
    setPopup(undefined);
    if (outcome !== undefined) {
      flyToCompleted(item.key);
      close(item.key);
    }
    panel.writes.decideAny(item.book.bookId, [item.unit], side);
    const next = outcome !== undefined ? (after[at + 1]?.key ?? after[at - 1]?.key) : item.key;
    const wait = outcome === undefined ? 0 : 240;
    if (!stay) {
      pick(next, wait);
      return;
    }
    setActiveKey(next);
    if (next !== undefined) showCard(next, wait);
  };

  const [popup, setPopup] = createSignal<
    (Point & { readonly key: string; readonly settled?: boolean }) | undefined
  >(undefined, { name: "inlinePopup" });
  const popupItem = (): Item | undefined => {
    const held = popup();
    return held === undefined ? undefined : items().find((item) => item.key === held.key);
  };
  // A settled change's note is a tooltip: it leaves a moment after the pointer does.
  let closing: ReturnType<typeof setTimeout> | undefined;
  const closeSoon = (): void => {
    clearTimeout(closing);
    closing = setTimeout(() => setPopup(undefined), 300);
  };
  onCleanup(() => clearTimeout(closing));
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === "Escape") setPopup(undefined);
  };
  document.addEventListener("keydown", onEscape);
  onCleanup(() => document.removeEventListener("keydown", onEscape));

  const fromText = (bookId: BookId, unit: DecisionUnit, at: Point, onChange: boolean): void => {
    // A decided change stays as the text it settled on: clicking it in the text
    // does nothing; only its card in Completed shows the change again.
    const found = pending().find((item) => item.book.bookId === bookId && item.unit.id === unit.id);
    if (found === undefined) return;
    setActiveKey(found.key);
    showCard(found.key);
    setPopup(
      onChange && outcomeOf(found) === undefined && panel.writes.editable()
        ? { ...at, key: found.key }
        : undefined,
    );
  };

  return (
    <Show
      when={panel.compare.result()}
      fallback={
        <EmptyState title={panel.compare.comparing() ? "Comparing…" : "Nothing to review yet."} />
      }
    >
      <Show when={items().length > 0} fallback={<EmptyState title="No differences." />}>
        <div class="flex min-h-0 flex-1 justify-center gap-4 bg-surface-canvas" data-inline-review>
          <TextPanel
            panel={panel}
            book={book()}
            active={active()}
            reveal={reveal()}
            onClickUnit={fromText}
            onScroll={() => setPopup(undefined)}
            onLeaveSettled={() => {
              if (popup()?.settled === true) closeSoon();
            }}
            onHoverSettled={(bookId, unit, at) => {
              const found = done().find(
                (item) => item.book.bookId === bookId && item.unit.id === unit.id,
              );
              if (found === undefined) return;
              clearTimeout(closing);
              if (popup()?.key === found.key) return;
              setPopup({ ...at, key: found.key, settled: true });
            }}
          >
            <Show when={popupItem()}>
              {(item) => (
                <div
                  class="absolute z-10 flex -translate-y-full gap-1 rounded-xl bg-[var(--neutral-10)] p-1 font-[family-name:var(--font-ui)] text-[14px] text-white shadow-medium"
                  style={{
                    left: `clamp(8px, ${popup()?.x ?? 0}px - 4rem, 100% - 15rem)`,
                    top: `${(popup()?.y ?? 0) - 6}px`,
                  }}
                  data-inline-popup
                  onMouseEnter={() => clearTimeout(closing)}
                  onMouseLeave={() => {
                    if (popup()?.settled === true) closeSoon();
                  }}
                >
                  <Show
                    when={popup()?.settled !== true}
                    fallback={
                      <>
                        <span class="flex items-center gap-2 ps-3 pe-1 whitespace-nowrap text-white/80">
                          <Show
                            when={outcomeOf(item()) === "accepted"}
                            fallback={<X size={20} aria-hidden="true" />}
                          >
                            <Check size={20} aria-hidden="true" />
                          </Show>
                          {outcomeOf(item()) === "accepted" ? "Accepted" : "Rejected"} {item().from}
                          's change
                        </span>
                        <PopupChoice
                          icon={<Undo2 size={20} aria-hidden="true" />}
                          onClick={() => decide(item(), undefined, true)}
                        >
                          Undo
                        </PopupChoice>
                      </>
                    }
                  >
                    <PopupChoice
                      icon={<Check size={20} aria-hidden="true" />}
                      onClick={() => decide(item(), "accepted", true)}
                    >
                      Accept
                    </PopupChoice>
                    <PopupChoice
                      icon={<X size={20} aria-hidden="true" />}
                      onClick={() => decide(item(), "rejected", true)}
                    >
                      Reject
                    </PopupChoice>
                  </Show>
                </div>
              )}
            </Show>
          </TextPanel>

          {/* The scroller clips what overflows it, the cards' shadows too: 8px of room each side
              (and 4px on top), taken back with a negative margin so the cards stay put.
              The title, Save and Cancel stay at the top as the cards scroll. */}
          <aside class="-mx-2 flex min-h-0 w-[calc(min(380px,40vw)+1rem)] shrink-0 flex-col gap-3 overflow-y-auto px-2 pt-1 pb-4">
            {/* Sticky, so Save and Cancel are always in reach; the canvas behind it hides the cards passing under. */}
            <div class="sticky -top-1 z-10 -mx-2 -mt-1 flex flex-col gap-3 bg-surface-canvas px-3 pt-3 pb-2 [&_.ms-auto]:ms-0">
              {panel.header("title")}
              <div class="flex items-center gap-2 [&>div]:ms-0">
                {panel.header("actions", () => pending().length === 0)}
                <CompletedToggle
                  count={done().length}
                  total={items().length}
                  open={completedOpen()}
                  onToggle={() => setCompletedOpen((was) => !was)}
                />
              </div>
            </div>
            <Completed
              open={completedOpen()}
              done={done()}
              outcomeOf={outcomeOf}
              activeKey={activeKey()}
              editable={panel.writes.editable()}
              onActivate={(item) => pick(item.key)}
              onUndo={(item) => decide(item, undefined)}
              usfm={usfm()}
              onToggleUsfm={toggleUsfm}
            />
            {/* Keyed by card, so a decision does not remake every card (and lose the list's place). */}
            <For each={listed()} keyed={(item: Item) => item.key}>
              {(item) => (
                <div
                  class={cx(
                    "grid transition-[grid-template-rows,opacity,margin] duration-200 ease-out",
                    folding().has(item().key)
                      ? "-mb-3 grid-rows-[0fr] opacity-0"
                      : "grid-rows-[1fr]",
                  )}
                >
                  <div class={cx("min-h-0", folding().has(item().key) && "overflow-hidden")}>
                    <PendingCard
                      item={item()}
                      what={whatOf(item())}
                      usfm={usfm()}
                      onToggleUsfm={toggleUsfm}
                      active={!folding().has(item().key) && active()?.key === item().key}
                      editable={panel.writes.editable()}
                      onActivate={() => pick(item().key)}
                      onDecide={(outcome) => decide(item(), outcome)}
                    />
                  </div>
                </div>
              )}
            </For>
            <Show
              when={pendingHere().length === 0 && pending().length > 0 ? nextBook() : undefined}
            >
              {(next) => (
                <div
                  class="flex flex-col items-center gap-3 px-4 py-6 text-center"
                  data-inline-book-done
                >
                  <p class="text-small text-on-surface-secondary">
                    Every change in {book()?.name ?? ""} is decided.
                  </p>
                  <Button
                    size="md"
                    variant="primary"
                    data-inline-next-book
                    onClick={() => pick(next().key)}
                  >
                    Next book: {next().book.name}
                  </Button>
                </div>
              )}
            </Show>
            <Show when={pending().length === 0}>
              <p class="px-4 py-6 text-center text-small text-on-surface-secondary">
                Every change is decided. Save to keep them as a version.
              </p>
            </Show>
          </aside>
        </div>
      </Show>
    </Show>
  );
}
