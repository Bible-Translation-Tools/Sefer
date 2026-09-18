/**
 * The book as a MULTIBUFFER: only the neighbourhoods that changed, each with a
 * sticky header saying where you are, and the untouched stretches between them
 * collapsed to one line you can open.
 *
 * This is the Zed shape, and the reason to want it here is the reason Zed wants
 * it: a whole-file surface is the honest one, but nobody reads 1,189 chapters
 * to find eleven changes. An excerpt keeps the context that makes a change
 * judgeable — the verse before it and the verse after — and throws away the
 * hour of scrolling that buys nothing.
 *
 * ## What is different about doing it to scripture
 *
 * A code multibuffer cuts on LINES and has to guess how many to keep, which is
 * why its excerpt boundaries always look slightly arbitrary. Ours cuts on
 * DECISION UNITS, so "two verses of context" is a sentence a translator can
 * agree or disagree with, and an excerpt never starts mid-verse. The header can
 * therefore say `Genesis 3:4–3:9` rather than `@@ -112,7 +112,9 @@`.
 *
 * The collapsed stretches are the second half of the idea. A gap says how many
 * verses it swallowed and opens in place when clicked — so the surface is never
 * lying about what it is not showing, and following a change out into its
 * chapter is one click rather than a mode change.
 *
 * ## Open questions this is here to answer
 *
 *   * Does a sticky chapter header earn its row, or does the reference in each
 *     row's margin already do that job? (Dial: `Sticky headers`.)
 *   * How much context is enough — one verse, two, four? The dial is there
 *     because the answer is almost certainly "it depends on the change", and
 *     watching somebody reach for it is how you find that out.
 *   * Where do the decision buttons go when there is no card? They are in the
 *     gutter here, the same as `continuous`, so the two can be compared without
 *     that being a variable.
 */

import { For, Show, createMemo, createSignal } from "solid-js";

import { Badge, Card, cx } from "../../../app/ui/primitives";
import { unitReference, type DecisionUnit, type MergeSide } from "../../../core/galley";
import type { Bench, Experiment, ExperimentProps } from "../experiment";
import { Gutter, UnitBody, inOrder } from "../units";

/** A run of units the reader sees, or a stretch they do not. */
type Band =
  | { readonly kind: "excerpt"; readonly units: readonly DecisionUnit[] }
  | { readonly kind: "gap"; readonly id: string; readonly units: readonly DecisionUnit[] };

/**
 * Changed units, widened by `context` on each side, then run together where
 * they touch — the whole of the excerpting.
 *
 * Adjacent excerpts are MERGED rather than left as two with a one-verse gap
 * between them: a collapsed bar hiding a single verse is worse than the verse,
 * and two headers a line apart read as a mistake.
 */
const bands = (
  units: readonly DecisionUnit[],
  context: number,
  opened: ReadonlySet<string>,
): readonly Band[] => {
  const keep = new Set<number>();
  units.forEach((unit, at) => {
    if (unit.status === "unchanged") return;
    for (let near = at - context; near <= at + context; near += 1) {
      if (near >= 0 && near < units.length) keep.add(near);
    }
  });

  const out: Band[] = [];
  let at = 0;
  while (at < units.length) {
    const shown = keep.has(at);
    let end = at;
    while (end < units.length && keep.has(end) === shown) end += 1;
    const slice = units.slice(at, end);
    // A gap the reader opened becomes an ordinary excerpt, which is what makes
    // "expand" one line of state rather than a second rendering path.
    const id = `gap:${at}`;
    out.push(
      shown || opened.has(id)
        ? { kind: "excerpt", units: slice }
        : { kind: "gap", id, units: slice },
    );
    at = end;
  }
  return out;
};

/** "Genesis 3:4–3:9", or the single reference when an excerpt is one unit. */
const bandLabel = (units: readonly DecisionUnit[]): string => {
  const first = units[0];
  const last = units.at(-1);
  if (first === undefined || last === undefined) return "";
  const from = unitReference(first);
  const to = unitReference(last);
  return from === to ? from : `${from} – ${to}`;
};

function Excerpts(props: ExperimentProps) {
  const [decisions, setDecisions] = createSignal<ReadonlyMap<string, MergeSide>>(new Map(), {
    name: "excerptDecisions",
  });
  const [opened, setOpened] = createSignal<ReadonlySet<string>>(new Set(), {
    name: "excerptOpened",
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
  const context = (): number => Number(props.dials.choice("context")) || 2;
  const sticky = (): boolean => props.dials.toggle("sticky");

  const laid = createMemo(
    (): readonly Band[] => {
      const bench: Bench | undefined = props.bench;
      if (bench === undefined) return [];
      return bands(inOrder(bench), context(), opened());
    },
    { name: "excerptBands" },
  );

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
          <div class={cx("mx-auto px-6 py-6", split() ? "max-w-6xl" : "max-w-3xl")}>
            <For each={laid()}>
              {(band) => (
                <Show
                  when={band.kind === "excerpt" ? band : undefined}
                  fallback={
                    // The gap. It says what it is hiding, because a surface that
                    // silently omits scripture is not one a translator can trust.
                    <button
                      type="button"
                      class="my-2 flex w-full cursor-pointer items-center gap-3 rounded-md border border-dashed border-surface-border px-3 py-1.5 text-smallest text-on-surface-tertiary transition-colors hover:border-brand/40 hover:text-on-surface-secondary"
                      onClick={() =>
                        setOpened((held) => new Set([...held, band.kind === "gap" ? band.id : ""]))
                      }
                    >
                      <span class="h-px flex-1 bg-surface-border" />
                      {band.units.length} unchanged, unshown — {bandLabel(band.units)}
                      <span class="h-px flex-1 bg-surface-border" />
                    </button>
                  }
                >
                  {(excerpt) => (
                    <section class="mb-4 overflow-hidden rounded-md border border-surface-border">
                      {/* The header the excerpt is named by. Sticky because in a
                          long multibuffer the thing you lose first is where you
                          are, and the reference in each row's margin is too
                          quiet to answer that while scrolling. */}
                      <h2
                        class={cx(
                          "z-10 border-b border-surface-border bg-surface-secondary px-3 py-1 font-mono text-smallest text-on-surface-secondary",
                          sticky() ? "sticky top-0" : "",
                        )}
                      >
                        {bandLabel(excerpt().units)}
                      </h2>
                      <div class="px-2 py-2">
                        <For each={excerpt().units}>
                          {(unit) => (
                            <div
                              class={cx(
                                "group flex gap-3 rounded-md px-2 py-1 transition-colors",
                                unit.status === "unchanged"
                                  ? "opacity-70"
                                  : "hover:bg-surface-secondary/60",
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
                              <span class="w-16 shrink-0 select-none pt-0.5 text-end font-mono text-smallest text-on-surface-tertiary">
                                {unitReference(unit)}
                              </span>
                              <div class="min-w-0 flex-1">
                                <UnitBody bench={bench()} unit={unit} split={split()} />
                                <Show
                                  when={unit.isUsfmStructureChange && unit.status !== "unchanged"}
                                >
                                  <Badge tone="muted">markup only</Badge>
                                </Show>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </section>
                  )}
                </Show>
              )}
            </For>
          </div>
        </Show>
      )}
    </Show>
  );
}

export const experiment: Experiment = {
  id: "excerpts",
  title: "Excerpts",
  blurb: "A multibuffer: changed neighbourhoods, with the rest collapsed.",
  dials: {
    layout: { kind: "choice", label: "Layout", options: ["merged", "split"], initial: "merged" },
    context: { kind: "choice", label: "Context", options: ["1", "2", "4", "8"], initial: "2" },
    sticky: { kind: "toggle", label: "Sticky headers", initial: true },
  },
  view: Excerpts,
};
