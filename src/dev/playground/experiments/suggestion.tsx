import type { BookId } from "@sefer/text/book";
import { For, Show, createMemo, createSignal } from "solid-js";

import { Button, Card } from "#app/ui/primitives";
import { ReviewReader, type ReviewBook } from "#app/ui/review/ReviewReader";
import type { DecisionUnit, MergeSide } from "#core/galley";

import type { Experiment, ExperimentProps } from "../experiment";

const MOCK = {
  who: "will-kelly-test",
  title: "Changes suggested on 7 October 2026",
  when: "56 minutes ago",
  versions: ["Edited Philemon", "Combined Philemon with the shared project", "Default"],
} as const;

interface Names {
  readonly current: string;
  readonly baseline: string;
  readonly currentShort: string;
  readonly baselineShort: string;
}

const BY_WHO: Names = {
  current: "Your project",
  baseline: `${MOCK.who}'s suggestion`,
  currentShort: "your project",
  baselineShort: MOCK.who,
};

const TODAY: Names = {
  current: "In the editor",
  baseline: "The suggested changes",
  currentShort: "the editor",
  baselineShort: "the suggestion",
};

const HeaderToday = () => (
  <div class="space-y-1 rounded-md border border-surface-border bg-surface-secondary px-3 py-2">
    <p class="text-small">
      <span class="font-semibold">{MOCK.who}</span>
      <span class="text-on-surface-secondary">
        {" "}
        suggested “{MOCK.title}” · {MOCK.when}
      </span>
    </p>
    <ul class="space-y-0.5 ps-4 text-smallest text-on-surface-secondary">
      <For each={MOCK.versions}>{(message) => <li class="list-disc">{message}</li>}</For>
    </ul>
  </div>
);

const HeaderSentence = (props: { readonly passages: number; readonly decided: number }) => (
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-surface-border bg-surface-secondary px-3 py-2">
    <p class="min-w-0 flex-1 text-small">
      <span class="font-semibold">{MOCK.who}</span>
      <span class="text-on-surface-secondary"> suggested </span>
      <span class="font-medium">“{MOCK.title}”</span>
      <span class="text-on-surface-tertiary"> · {MOCK.when}</span>
    </p>
    <span class="text-smallest text-on-surface-tertiary">
      {props.decided} of {props.passages} decided
    </span>
    <Button size="sm" variant="tertiary">
      Decline…
    </Button>
  </div>
);

function SuggestionReview(props: ExperimentProps) {
  const [decisions, setDecisions] = createSignal<ReadonlyMap<string, MergeSide>>(new Map(), {
    name: "suggestionDecisions",
  });
  const [usfm, setUsfm] = createSignal(false, { name: "suggestionUsfm" });

  const names = (): Names => (props.dials.choice("names") === "today" ? TODAY : BY_WHO);

  const books = createMemo(
    (): readonly ReviewBook[] => {
      const bench = props.bench;
      if (bench?.skeleton === undefined) return [];
      return [
        {
          // SAFETY: the bench's book id is one the playground picked from the open project's own books, so it is a BookId already.
          bookId: bench.bookId as BookId,
          name: bench.bookId,
          currentText: bench.currentText,
          baselineText: bench.baselineText,
          skeleton: bench.skeleton,
        },
      ];
    },
    { name: "suggestionBooks" },
  );

  const passages = (): number =>
    books()[0]?.skeleton.units.filter((unit) => unit.status !== "unchanged").length ?? 0;

  const decide = (units: readonly DecisionUnit[], side: MergeSide | undefined): void => {
    setDecisions((held) => {
      const next = new Map(held);
      for (const unit of units) {
        if (side === undefined) next.delete(unit.id);
        else next.set(unit.id, side);
      }
      return next;
    });
  };

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
          <div class="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-4">
            <Show when={props.dials.choice("header") === "one sentence"} fallback={<HeaderToday />}>
              <HeaderSentence passages={passages()} decided={decisions().size} />
            </Show>
            <div class="flex h-[75vh] min-h-[480px] flex-col" data-suggestion-reader>
              <ReviewReader
                books={books()}
                decision={(_, unitId) => decisions().get(unitId)}
                decide={(_, units, side) => decide(units, side)}
                decidable={true}
                writesDecisions={false}
                dimUnchosen={props.dials.toggle("dim")}
                usfm={usfm()}
                onUsfm={setUsfm}
                currentLabel={names().current}
                baselineLabel={names().baseline}
                currentShort={names().currentShort}
                baselineShort={names().baselineShort}
                selected={books()[0]?.bookId}
                onSelect={() => {}}
                seat={() => Promise.resolve(undefined)}
                onEdited={() => {}}
                claimSidebar={false}
              />
            </div>
          </div>
        </Show>
      )}
    </Show>
  );
}

const experiment: Experiment = {
  id: "suggestion",
  title: "Suggestion review",
  blurb:
    "Review's own cards: sides named by who wrote them, the unchosen side dimmed, a one-line header.",
  dials: {
    names: {
      kind: "choice",
      label: "Names",
      options: ["who wrote it", "today"],
      initial: "who wrote it",
    },
    dim: { kind: "toggle", label: "Dim the unchosen side", initial: true },
    header: {
      kind: "choice",
      label: "Header",
      options: ["one sentence", "today"],
      initial: "one sentence",
    },
  },
  view: SuggestionReview,
};

export default experiment;
