/**
 * The whole book, reading continuously, with the changes in it.
 *
 * The question this is trying to answer: can a review look like reading, rather
 * than like a merge tool? Today's `/review` shows a LIST OF CHANGED UNITS —
 * everything that did not change is simply absent, which is honest about what
 * you have to decide and dishonest about what you are reading. A verse whose
 * neighbour explains it is a verse you cannot judge alone.
 *
 * So this walks the skeleton's SLOTS, which are the engine's own interleave and
 * cover every byte of both documents in order, and renders every unit —
 * unchanged ones as plain reading text, changed ones marked. The result is a
 * reading surface with the diff inside it, which is roughly what a word
 * processor's tracked changes feels like and nothing like a diff tool.
 *
 * ## Why the two columns line up
 *
 * The usual objection to a split diff is that the sides drift: an insertion on
 * one side pushes everything below it out of step, and the reader spends the
 * session re-finding their place. That does not happen here, and the reason is
 * the DIFFING, not the layout — a unit IS a verse (or a bridge, or a chapter's
 * opening matter), so row N on the left and row N on the right are the same
 * reference by construction. A verse only one side has leaves the other column
 * empty at that row rather than shifting it.
 *
 * ## What is deliberately unfinished
 *
 * The decision buttons are in the GUTTER, not on a card, which is the bit most
 * worth arguing about: it makes the surface read as text with an apparatus
 * beside it rather than as a stack of forms, but it also means the decision is
 * no longer the most prominent thing on the row. There is no keyboard path
 * through the units yet, and nothing here writes — the decisions are local
 * state, and the door they would go out of is `mergeWithDecisions`.
 *
 * The honest cost of this layout is that it renders the whole book. At Genesis
 * that is ~1,500 rows and it is fine; at a Bible it is not, and the answer is
 * either `VirtualList` or the `excerpts` experiment beside it.
 */

import { For, Show, createSignal } from "solid-js";

import { Badge, Card, cx } from "../../../app/ui/primitives";
import { unitReference, type MergeSide } from "../../../core/galley";
import type { Experiment, ExperimentProps } from "../experiment";
import { Gutter, UnitBody, inOrder, type DiffTone } from "../units";

function ContinuousDiff(props: ExperimentProps) {
  const [flipped, setFlipped] = createSignal<ReadonlySet<string>>(new Set(), {
    name: "flippedToMarkup",
  });
  const flip = (id: string): void => {
    setFlipped((held) => {
      const next = new Set(held);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const [decisions, setDecisions] = createSignal<ReadonlyMap<string, MergeSide>>(new Map(), {
    name: "playgroundDecisions",
  });

  const decide = (id: string, side: MergeSide | undefined): void => {
    setDecisions((held) => {
      const next = new Map(held);
      if (side === undefined) next.delete(id);
      else next.set(id, side);
      return next;
    });
  };

  const split = (): boolean => props.dials.choice("layout") === "split";
  const tone = (): DiffTone => (props.dials.choice("tone") === "was / now" ? "wasNow" : "side");

  const rows = () => {
    const bench = props.bench;
    if (bench === undefined) return [];
    const all = inOrder(bench);
    return props.dials.toggle("quiet") ? all.filter((unit) => unit.status !== "unchanged") : all;
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
          {/* A reading measure, centred, because the whole claim of this layout
              is that it is something you read. A full-width diff is a diff. */}
          <div class={cx("mx-auto px-6 py-6", split() ? "max-w-6xl" : "max-w-3xl")}>
            <For each={rows()}>
              {(unit) => (
                <div
                  class={cx(
                    "group flex gap-3 rounded-md px-2 py-1 transition-colors",
                    unit.status === "unchanged" ? "" : "hover:bg-surface-secondary/60",
                  )}
                  data-status={unit.status}
                >
                  <Show
                    when={unit.status !== "unchanged"}
                    fallback={<span class="w-11 shrink-0" />}
                  >
                    <Gutter
                      held={decisions().get(unit.id)}
                      onPick={(side) => decide(unit.id, side)}
                    />
                  </Show>

                  {/* The reference in the margin: the row's identity, and the
                      reason the two columns can line up at all. */}
                  <button
                    type="button"
                    title="show this row's USFM"
                    data-flipped={flipped().has(unit.id) ? "" : undefined}
                    class="w-16 shrink-0 cursor-pointer pt-0.5 text-end font-mono text-smallest text-on-surface-tertiary transition-colors hover:text-brand data-flipped:font-semibold data-flipped:text-brand"
                    onClick={() => flip(unit.id)}
                  >
                    {unitReference(unit)}
                  </button>

                  <div class="min-w-0 flex-1">
                    <UnitBody
                      bench={bench()}
                      unit={unit}
                      split={split()}
                      tone={tone()}
                      markup={flipped().has(unit.id)}
                    />
                    <Show when={unit.isUsfmStructureChange && unit.status !== "unchanged"}>
                      {/* The unit every "just show me the words" layout draws as
                          blank. It has to say something. */}
                      <Badge tone="muted">markup only</Badge>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      )}
    </Show>
  );
}

export const experiment: Experiment = {
  id: "continuous",
  title: "Continuous",
  blurb: "The whole book, reading, with the changes inside it.",
  dials: {
    layout: { kind: "choice", label: "Layout", options: ["merged", "split"], initial: "merged" },
    tone: { kind: "choice", label: "Tone", options: ["by side", "was / now"], initial: "by side" },
    quiet: { kind: "toggle", label: "Changes only", initial: false },
  },
  view: ContinuousDiff,
};
