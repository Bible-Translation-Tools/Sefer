/**
 * Reviewing a SUGGESTION: someone's own copy offered to the shared project,
 * one card per passage that differs.
 *
 * From the demo on 2026-10-07 (`planning/00-ideas/cloud-git-followups-2026-10-06.md`,
 * "Review layout"): today's card shows two texts with marks on both, and what
 * the project will say afterwards is just "the lower one". A reviewer has to
 * work out the result from two marked-up paragraphs and a pair of buttons.
 *
 * ## What this tries
 *
 *   * RESULT FIRST. Each card leads with the verse as it will be written,
 *     labelled "Will read", and puts the other side underneath, quieter, as
 *     "Instead of". Only the differing words are marked, and the words that
 *     will be read are never struck through.
 *   * STATE, NOT ACTION, in the card header: a segmented "Keep" with the two
 *     sides, plus Edit, in place of a take/keep button pair. The control says
 *     what is in force; pressing it changes that.
 *   * SIDES NAMED BY WHO WROTE THEM ("will-kelly-test's suggestion", "Your
 *     project"), so left and right stop mattering.
 *   * A HEADER THAT IS ONE SENTENCE: who, title, when. Not the suggestion's
 *     versions — the reader compares latest to latest and should not have to
 *     think in commits.
 *
 * Two further ideas from the same discussion ride along as toggles, so their
 * weight on the page can be judged: REMEMBERED DECLINES (a passage offering the
 * same text someone already declined shows collapsed) and the reviewer's own
 * UNSENT EDITS as one line rather than mixed into the diff.
 *
 * ## The data
 *
 * Real text, mock framing. The bench's BEFORE side stands in for the shared
 * project and its AFTER side (the editor's text) for the suggestion; the person,
 * title, time, declined passages and unsent count are invented here. Nothing is
 * written: decisions and edits live in this component.
 */

import { For, Show, createMemo, createSignal } from "solid-js";

import { Badge, Button, Card, SegmentedControl, cx } from "#app/ui/primitives";
import { textOf } from "#app/ui/review/reading";
import { readingRuns, unitReference, type DecisionUnit, type TextRun } from "#core/galley";

import type { Bench, Experiment, ExperimentProps } from "../experiment";
import { inOrder } from "../units";

/** Who offered it, and what it is called — invented, see the module note. */
const MOCK = {
  who: "will-kelly-test",
  title: "Changes suggested on 7 October 2026",
  when: "56 minutes ago",
  declinedOn: "7 October",
  unsent: 3,
} as const;

/** Every this-many changed passages, one is "declined before" when the toggle is on. */
const DECLINED_EVERY = 5;

/** Cards drawn before "show more": a whole book of draft differences is hundreds. */
const PAGE = 60;

type Side = "yours" | "theirs";

/** A decision, or an edit that replaces both sides with what the reviewer typed. */
type Decision =
  | { readonly kind: "keep"; readonly side: Side }
  | { readonly kind: "edit"; readonly text: string };

interface Names {
  readonly yours: string;
  readonly theirs: string;
  /** The one-word form for a segment. */
  readonly yoursShort: string;
  readonly theirsShort: string;
}

const namesFor = (style: string): Names =>
  style === "today"
    ? {
        yours: "In the editor",
        theirs: "The suggested changes",
        yoursShort: "Editor",
        theirsShort: "Suggested",
      }
    : {
        yours: "Your project",
        theirs: `${MOCK.who}'s suggestion`,
        yoursShort: "Yours",
        theirsShort: MOCK.who,
      };

/** The bench's BEFORE is the shared project ("yours"); its AFTER is the suggestion. */
const runsOf = (unit: DecisionUnit, side: Side): readonly TextRun[] | undefined => {
  const text = unit.text;
  if (text === undefined) return undefined;
  const runs = readingRuns(side === "yours" ? text.baseline : text.current);
  return runs.length === 0 ? undefined : runs;
};

const plainOf = (bench: Bench, unit: DecisionUnit, side: Side): string | undefined => {
  const text =
    side === "yours"
      ? textOf(bench.galley, bench.baselineText, unit.baseline, false)
      : textOf(bench.galley, bench.currentText, unit.current, false);
  return text === undefined || text.trim() === "" ? undefined : text;
};

/**
 * One side's reading, with the words that differ marked by ROLE rather than by
 * add/remove: the text that will be read gets a quiet tint and is never struck
 * through; the text it replaces is struck and greyed. The same word list reads
 * differently depending on which side won, which is the point.
 */
const Reading = (props: {
  readonly bench: Bench;
  readonly unit: DecisionUnit;
  readonly side: Side;
  readonly role: "result" | "instead" | "plain";
  readonly absent: string;
}) => {
  const marked = (run: TextRun): string => {
    if (run.kind === "unchanged") return "";
    if (props.role === "result") return "rounded-[2px] bg-brand-light text-brand-strong";
    if (props.role === "instead")
      return "line-through decoration-1 decoration-on-surface-tertiary text-on-surface-tertiary";
    return run.kind === "removed"
      ? "line-through decoration-2 text-on-surface-tertiary"
      : "rounded-[2px] bg-brand-light text-brand-strong";
  };
  return (
    <Show
      when={runsOf(props.unit, props.side)}
      fallback={
        <Show
          when={plainOf(props.bench, props.unit, props.side)}
          fallback={<span class="text-small text-on-surface-tertiary italic">{props.absent}</span>}
        >
          {(text) => <span>{text()}</span>}
        </Show>
      }
    >
      {(runs) => <For each={runs()}>{(run) => <span class={marked(run)}>{run.text}</span>}</For>}
    </Show>
  );
};

/** The header: one sentence, then the counts and the two whole-suggestion actions. */
const Header = (props: {
  readonly names: Names;
  readonly passages: number;
  readonly decided: number;
  readonly unsent: boolean;
}) => (
  <Card class="mb-4 p-4">
    <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span class="text-body font-semibold text-on-surface-primary">{MOCK.who}</span>
      <span class="text-body text-on-surface-secondary">suggested</span>
      <span class="text-body font-medium text-on-surface-primary">“{MOCK.title}”</span>
      <span class="text-small text-on-surface-tertiary">· {MOCK.when}</span>
    </div>
    <div class="mt-2 flex flex-wrap items-center gap-3 text-small text-on-surface-secondary">
      <span>
        {props.passages} passage(s) differ · {props.decided} decided
      </span>
      <span class="flex-1" />
      <Button variant="tertiary" size="sm">
        Decline…
      </Button>
      <Button variant="primary" size="sm">
        Bring in
      </Button>
    </div>
    <Show when={props.unsent}>
      <p class="mt-3 border-t border-surface-border pt-3 text-small text-on-surface-secondary">
        Your editor also has {MOCK.unsent} change(s) that are not in this suggestion — they are not
        shown here.{" "}
        <button type="button" class="cursor-pointer text-brand hover:underline">
          Compare with the editor
        </button>
      </p>
    </Show>
  </Card>
);

/** A card collapsed because the same text was declined before. */
const Declined = (props: { readonly reference: string; readonly onOpen: () => void }) => (
  <div class="mb-2 flex items-center gap-3 rounded-md border border-dashed border-surface-border px-3 py-2 text-small text-on-surface-tertiary">
    <span class="w-16 shrink-0 font-mono text-smallest">{props.reference}</span>
    <span class="flex-1">The same text you declined on {MOCK.declinedOn}.</span>
    <button
      type="button"
      class="cursor-pointer text-on-surface-secondary hover:text-brand"
      onClick={() => props.onOpen()}
    >
      Look again
    </button>
  </div>
);

/** The proposal: the result first, the decision as state. */
const ResultCard = (props: {
  readonly bench: Bench;
  readonly unit: DecisionUnit;
  readonly names: Names;
  readonly decision: Decision | undefined;
  /** What an undecided card shows as "Will read". */
  readonly lean: Side;
  readonly onDecide: (decision: Decision | undefined) => void;
}) => {
  const [editing, setEditing] = createSignal(false);
  let field: HTMLTextAreaElement | undefined;

  const kept = (): Side | undefined =>
    props.decision?.kind === "keep" ? props.decision.side : undefined;
  /** The side "Will read" draws from: the decision, or the lean while undecided. */
  const shown = (): Side => kept() ?? props.lean;
  const other = (): Side => (shown() === "yours" ? "theirs" : "yours");
  const nameOf = (side: Side): string =>
    side === "yours" ? props.names.yours : props.names.theirs;
  const undecided = (): boolean => props.decision === undefined;

  const startEdit = (): void => {
    setEditing(true);
  };
  const finishEdit = (): void => {
    const text = field?.value.trim() ?? "";
    setEditing(false);
    if (text !== "") props.onDecide({ kind: "edit", text });
  };

  return (
    <section
      data-undecided={undecided() ? "" : undefined}
      class="mb-3 rounded-md border border-surface-border bg-surface-primary data-undecided:border-dashed"
    >
      <header class="flex flex-wrap items-center gap-2 border-b border-surface-border px-3 py-1.5">
        <span class="font-mono text-smallest text-on-surface-secondary">
          {unitReference(props.unit)}
        </span>
        <Show when={undecided()}>
          <Badge tone="muted">Undecided</Badge>
        </Show>
        <Show when={props.decision?.kind === "edit"}>
          <Badge tone="brand">Edited</Badge>
        </Show>
        <Show when={props.unit.isUsfmStructureChange}>
          <Badge tone="muted">markup only</Badge>
        </Show>
        <span class="flex-1" />
        <span class="text-smallest text-on-surface-tertiary">Keep</span>
        <SegmentedControl<Side>
          size="sm"
          label="Keep"
          value={kept()}
          items={[
            { value: "yours", label: props.names.yoursShort, title: props.names.yours },
            { value: "theirs", label: props.names.theirsShort, title: props.names.theirs },
          ]}
          onChange={(side) => props.onDecide(kept() === side ? undefined : { kind: "keep", side })}
        />
        <Button variant="tertiary" size="sm" onClick={startEdit}>
          Edit
        </Button>
      </header>

      <div class="px-3 py-2">
        <Show
          when={!editing()}
          fallback={
            <div class="flex flex-col gap-2">
              <textarea
                ref={(element: HTMLTextAreaElement) => {
                  field = element;
                  queueMicrotask(() => element.focus());
                }}
                class="min-h-20 w-full rounded-md border border-surface-border bg-surface-primary p-2 text-small text-on-surface-primary"
                value={
                  props.decision?.kind === "edit"
                    ? props.decision.text
                    : (plainOf(props.bench, props.unit, shown()) ?? "")
                }
              />
              <div class="flex justify-end gap-2">
                <Button variant="tertiary" size="sm" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button variant="secondary" size="sm" onClick={finishEdit}>
                  Use this
                </Button>
              </div>
            </div>
          }
        >
          <div class="mb-1 text-smallest font-medium text-on-surface-secondary">
            Will read
            <Show when={undecided()}>
              <span class="font-normal text-on-surface-tertiary">
                {" "}
                — if you keep {nameOf(shown())}
              </span>
            </Show>
          </div>
          <p class="text-small leading-relaxed text-on-surface-primary">
            <Show
              when={props.decision?.kind === "edit" ? props.decision : undefined}
              fallback={
                <Reading
                  bench={props.bench}
                  unit={props.unit}
                  side={shown()}
                  role="result"
                  absent="Nothing — this verse will not be there."
                />
              }
            >
              {(edit) => <span>{edit().text}</span>}
            </Show>
          </p>
          <div class="mt-2 border-t border-surface-border/60 pt-2">
            <div class="mb-1 text-smallest text-on-surface-tertiary">
              Instead of {props.decision?.kind === "edit" ? "either side" : nameOf(other())}
            </div>
            <p class="text-small leading-relaxed text-on-surface-tertiary">
              <Reading
                bench={props.bench}
                unit={props.unit}
                side={props.decision?.kind === "edit" ? shown() : other()}
                role="instead"
                absent="Nothing — the verse is not there."
              />
            </p>
          </div>
        </Show>
      </div>
    </section>
  );
};

/** Roughly today's card, for comparison: two marked texts and a take/keep pair. */
const TwoTextsCard = (props: {
  readonly bench: Bench;
  readonly unit: DecisionUnit;
  readonly names: Names;
  readonly decision: Decision | undefined;
  readonly onDecide: (decision: Decision | undefined) => void;
}) => {
  const kept = (): Side | undefined =>
    props.decision?.kind === "keep" ? props.decision.side : undefined;
  const pick = (side: Side): void =>
    props.onDecide(kept() === side ? undefined : { kind: "keep", side });
  return (
    <section class="mb-3 rounded-md border border-surface-border bg-surface-primary">
      <header class="flex items-center gap-2 border-b border-surface-border px-3 py-1.5">
        <span class="font-mono text-smallest text-on-surface-secondary">
          {unitReference(props.unit)}
        </span>
        <span class="flex-1" />
        <Button
          variant={kept() === "theirs" ? "accent" : "tertiary"}
          size="sm"
          aria-pressed={kept() === "theirs" ? "true" : "false"}
          onClick={() => pick("theirs")}
        >
          Take {props.names.theirsShort}'s
        </Button>
        <Button
          variant={kept() === "yours" ? "accent" : "tertiary"}
          size="sm"
          aria-pressed={kept() === "yours" ? "true" : "false"}
          onClick={() => pick("yours")}
        >
          Keep {props.names.yoursShort}'s
        </Button>
      </header>
      <div class="flex flex-col gap-2 px-3 py-2">
        <For each={["theirs", "yours"] as const}>
          {(side) => (
            <div>
              <div class="mb-1 text-smallest text-on-surface-tertiary">
                {side === "yours" ? props.names.yours : props.names.theirs}
              </div>
              <p class="text-small leading-relaxed text-on-surface-primary">
                <Reading
                  bench={props.bench}
                  unit={props.unit}
                  side={side}
                  role="plain"
                  absent="nothing on this side"
                />
              </p>
            </div>
          )}
        </For>
      </div>
    </section>
  );
};

function SuggestionReview(props: ExperimentProps) {
  const [decisions, setDecisions] = createSignal<ReadonlyMap<string, Decision>>(new Map(), {
    name: "suggestionDecisions",
  });
  const [lookedAgain, setLookedAgain] = createSignal<ReadonlySet<string>>(new Set(), {
    name: "suggestionLookedAgain",
  });
  const [shownCount, setShownCount] = createSignal(PAGE, { name: "suggestionShown" });

  const decide = (id: string, decision: Decision | undefined): void => {
    setDecisions((held) => {
      const next = new Map(held);
      if (decision === undefined) next.delete(id);
      else next.set(id, decision);
      return next;
    });
  };

  const names = (): Names => namesFor(props.dials.choice("names"));
  const resultFirst = (): boolean => props.dials.choice("card") === "result first";
  const lean = (): Side => (props.dials.choice("undecided") === "yours" ? "yours" : "theirs");
  const remembered = (): boolean => props.dials.toggle("declines");

  const changed = createMemo(
    (): readonly DecisionUnit[] => {
      const bench = props.bench;
      if (bench === undefined) return [];
      return inOrder(bench).filter((unit) => unit.status !== "unchanged");
    },
    { name: "suggestionChanged" },
  );

  /** Mock: every fifth changed passage offers text that was declined before. */
  const declinedBefore = (at: number, id: string): boolean =>
    remembered() && at % DECLINED_EVERY === DECLINED_EVERY - 1 && !lookedAgain().has(id);

  return (
    <Show
      when={props.bench}
      fallback={
        <Card class="m-4 p-4 text-small text-on-surface-secondary">
          No bench: open a project with at least one book, and pick a baseline that exists.
        </Card>
      }
    >
      {(bench) => (
        <Show
          when={bench().skeleton !== undefined}
          fallback={
            <Card class="m-4 p-4 text-small text-on-surface-secondary">
              The engine refused this diff: {bench().refusal ?? "no reason given"}
            </Card>
          }
        >
          <div class="mx-auto max-w-3xl px-6 py-6">
            <Header
              names={names()}
              passages={changed().length}
              decided={decisions().size}
              unsent={props.dials.toggle("unsent")}
            />
            <For each={changed().slice(0, shownCount())}>
              {(unit, at) => (
                <Show
                  when={!declinedBefore(at(), unit.id)}
                  fallback={
                    <Declined
                      reference={unitReference(unit)}
                      onOpen={() => setLookedAgain((held) => new Set([...held, unit.id]))}
                    />
                  }
                >
                  <Show
                    when={resultFirst()}
                    fallback={
                      <TwoTextsCard
                        bench={bench()}
                        unit={unit}
                        names={names()}
                        decision={decisions().get(unit.id)}
                        onDecide={(decision) => decide(unit.id, decision)}
                      />
                    }
                  >
                    <ResultCard
                      bench={bench()}
                      unit={unit}
                      names={names()}
                      decision={decisions().get(unit.id)}
                      lean={lean()}
                      onDecide={(decision) => decide(unit.id, decision)}
                    />
                  </Show>
                </Show>
              )}
            </For>
            <Show when={changed().length > shownCount()}>
              <button
                type="button"
                class={cx(
                  "w-full cursor-pointer rounded-md border border-dashed border-surface-border py-2",
                  "text-small text-on-surface-tertiary hover:text-on-surface-secondary",
                )}
                onClick={() => setShownCount((count) => count + PAGE)}
              >
                {changed().length - shownCount()} more passage(s)
              </button>
            </Show>
          </div>
        </Show>
      )}
    </Show>
  );
}

const experiment: Experiment = {
  id: "suggestion",
  title: "Suggestion review",
  blurb: "Result first, the decision as state, sides named by who wrote them.",
  dials: {
    card: {
      kind: "choice",
      label: "Card",
      options: ["result first", "two texts"],
      initial: "result first",
    },
    names: {
      kind: "choice",
      label: "Names",
      options: ["who wrote it", "today"],
      initial: "who wrote it",
    },
    undecided: {
      kind: "choice",
      label: "Undecided reads",
      options: ["suggestion", "yours"],
      initial: "suggestion",
    },
    declines: { kind: "toggle", label: "Remembered declines", initial: true },
    unsent: { kind: "toggle", label: "Unsent edits line", initial: true },
  },
  view: SuggestionReview,
};

export default experiment;
