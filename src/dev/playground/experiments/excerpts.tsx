import { For, Show, createMemo, createSignal } from "solid-js";

import { Badge, Card, cx } from "#app/ui/primitives";
import { unitReference, type DecisionUnit, type MergeSide } from "#core/galley";

import type { Bench, Experiment, ExperimentProps } from "../experiment";
import { Gutter, UnitBody, inOrder, type DiffTone } from "../units";

type Band =
  | { readonly kind: "excerpt"; readonly units: readonly DecisionUnit[] }
  | { readonly kind: "gap"; readonly id: string; readonly units: readonly DecisionUnit[] };

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

const bandLabel = (units: readonly DecisionUnit[]): string => {
  const first = units[0];
  const last = units.at(-1);
  if (first === undefined || last === undefined) return "";
  const from = unitReference(first);
  const to = unitReference(last);
  return from === to ? from : `${from} – ${to}`;
};

function Excerpts(props: ExperimentProps) {
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
  const tone = (): DiffTone => (props.dials.choice("tone") === "was / now" ? "wasNow" : "side");
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
                      {}
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

const experiment: Experiment = {
  id: "excerpts",
  title: "Excerpts",
  blurb: "A multibuffer: changed neighbourhoods, with the rest collapsed.",
  dials: {
    layout: { kind: "choice", label: "Layout", options: ["merged", "split"], initial: "merged" },
    tone: { kind: "choice", label: "Tone", options: ["by side", "was / now"], initial: "by side" },
    context: { kind: "choice", label: "Context", options: ["1", "2", "4", "8"], initial: "2" },
    sticky: { kind: "toggle", label: "Sticky headers", initial: true },
  },
  view: Excerpts,
};

export default experiment;
