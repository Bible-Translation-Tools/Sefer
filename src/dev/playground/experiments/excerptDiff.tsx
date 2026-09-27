/**
 * The diff as a multibuffer: every change a small clipped piece of the book,
 * with context, in the same excerpt shape Find and Key terms use — and across
 * every book at once.
 *
 * The question: when changes are short and spread over many books — a
 * spelling standardised, a key term re-rendered, a formatting pass — can a
 * review be read without scrolling whole books or opening them one by one?
 * "In the editor" answers the long-change case with the whole book; this is
 * the other one.
 *
 * Each card is the diff view (`#editor` `mountDiffView`) CLIPPED to one change
 * and its context, so it reads exactly as the editor does — regular mode or
 * USFM, split (earlier left, working right) or unified (the working text with
 * the earlier words struck through where they were). Context is TOC steps,
 * like every other excerpt; changes whose context would overlap share a card,
 * so no verse is shown twice. The gutter keeps each unit's two choices.
 *
 * Books are diffed one at a time off a timer, so the list fills while the
 * rest are still being compared; every step is traced (`playground.diff.*`).
 */

import { Result } from "effect";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";

import { useShell } from "#app/ProjectContext";
import {
  DiffCard,
  estimate,
  hunksOf,
  ordered,
  type Controls,
  type DiffSides,
  type Hunk,
} from "#app/ui/diff";
import { Badge, VirtualList, type VirtualSection } from "#app/ui/primitives";
import type { DecisionUnit, MergeSide } from "#core/galley/diff";

import { benchFor } from "../bench";
import type { Bench, Experiment, ExperimentProps } from "../experiment";

interface Diffed {
  readonly bench: Bench;
  readonly sides: DiffSides;
  readonly hunks: readonly Hunk[];
}

function ExcerptDiff(props: ExperimentProps) {
  const shell = useShell();
  const services = shell.services;
  const observability = services.composition.observability;

  const split = (): boolean => props.dials.choice("layout") === "split";
  const usfm = (): boolean => props.dials.choice("mode") === "usfm";
  const allBooks = (): boolean => props.dials.choice("scope") === "all books";
  const steps = (): number => Number(props.dials.choice("context"));
  const withControls = (): boolean => props.dials.toggle("controls");

  /** Working texts a "take" produced, by book. The bench's text is the default. */
  const [working, setWorking] = createSignal<ReadonlyMap<string, string>>(new Map(), {
    name: "hunkWorking",
  });
  const [reviewed, setReviewed] = createSignal<ReadonlySet<string>>(new Set(), {
    name: "hunkReviewed",
  });
  const [books, setBooks] = createSignal<readonly Diffed[]>([], { name: "hunkBooks" });
  const [progress, setProgress] = createSignal("", { name: "hunkProgress" });
  const [mounted, setMounted] = createSignal<{ n: number; total: number; max: number }>(
    { n: 0, total: 0, max: 0 },
    { name: "hunkMounts" },
  );

  const analyzeBaseline = services.galley.memoize("diff.excerpts.baseline");
  const analyzeCurrent = services.galley.memoize("diff.excerpts.current");

  const diffOne = (bench: Bench): Diffed | undefined => {
    const text = working().get(bench.bookId) ?? bench.currentText;
    const done = observability.span("playground.diff.book", bench.bookId);
    const found = services.galley.diff(bench.baselineText, text);
    if (Result.isFailure(found)) {
      done({ "diff.failed": true });
      return undefined;
    }
    const sides: DiffSides = {
      bookId: bench.bookId,
      baselineText: bench.baselineText,
      currentText: text,
      baseline: analyzeBaseline(bench.baselineText),
      current: analyzeCurrent(text),
    };
    const live = { ...bench, currentText: text, skeleton: found.success };
    const hunks = hunksOf({
      bookId: bench.bookId,
      units: ordered(found.success),
      baseline: sides.baseline,
      current: sides.current,
      steps: untrack(steps),
    });
    done({ "diff.units": found.success.units.length, "diff.hunks": hunks.length });
    return { bench: live, sides, hunks };
  };

  // The books, diffed one per tick so the list fills while the rest are compared.
  createEffect(
    () => ({ all: allBooks(), bench: props.bench, context: steps(), taken: working() }),
    ({ all, bench, context }) => {
      const op = observability.operation("playground.diff.excerpts", {
        "diff.scope": all ? "all books" : "one book",
        "diff.context": context,
      });
      const started = performance.now();
      const project = untrack(() => shell.project());
      const ids =
        all && project !== undefined
          ? project.books.map((book) => book.id)
          : bench === undefined
            ? []
            : [bench.bookId];
      const out: Diffed[] = [];
      let stopped = false;
      let at = 0;
      const next = (): void => {
        if (stopped) return;
        const id = ids[at];
        if (id === undefined) {
          const hunks = out.reduce((sum, book) => sum + book.hunks.length, 0);
          setProgress(
            `${hunks} changes in ${out.length} books · ${(performance.now() - started).toFixed(0)} ms`,
          );
          op.end("passed", { "diff.books": out.length, "diff.hunks": hunks });
          return;
        }
        at += 1;
        const held =
          !all && bench !== undefined && id === bench.bookId
            ? bench
            : benchFor({
                project,
                galley: services.galley,
                save: services.save,
                bookId: id,
                baseline: "draft",
                density: "normal",
              });
        const diffed = held === undefined ? undefined : diffOne(held);
        if (diffed !== undefined && diffed.hunks.length > 0) {
          out.push(diffed);
          setBooks([...out]);
        }
        setProgress(`comparing ${at} of ${ids.length} books…`);
        setTimeout(next, 0);
      };
      setBooks([]);
      setMounted({ n: 0, total: 0, max: 0 });
      next();
      return () => {
        stopped = true;
      };
    },
  );

  const take = (unit: DecisionUnit, bookId: string): void => {
    const diffed = untrack(books).find((book) => book.bench.bookId === bookId);
    if (diffed === undefined) return;
    const op = observability.operation("playground.diff.take", { "diff.unit": unit.id });
    const merged = services.galley.merge(
      diffed.bench.baselineText,
      diffed.bench.currentText,
      new Map([[unit.id, "baseline"]]),
      "current",
    );
    op.end(Result.isSuccess(merged) ? "passed" : "failed");
    if (Result.isSuccess(merged))
      setWorking((held) => new Map([...held, [bookId, merged.success]]));
  };
  const mark = (unit: DecisionUnit, on: boolean): void => {
    setReviewed((held) => {
      const next = new Set(held);
      if (on) next.add(unit.id);
      else next.delete(unit.id);
      return next;
    });
  };
  /** Taking the earlier text merges at once; keeping marks the unit reviewed. */
  const controlsFor = (bookId: string): Controls | undefined =>
    withControls()
      ? {
          decision: (unit): MergeSide | undefined =>
            reviewed().has(unit.id) ? "current" : undefined,
          decide: (unit, side) => {
            if (side === "baseline") take(unit, bookId);
            else mark(unit, side === "current");
          },
          keepTitle: "Keep the working text",
          takeTitle: "Take the earlier text for this unit",
        }
      : undefined;

  const sections = createMemo(
    (): readonly VirtualSection<{ hunk: Hunk; diffed: Diffed }>[] =>
      books().map((diffed) => ({
        key: diffed.bench.bookId,
        rows: diffed.hunks.map((hunk) => ({
          key: hunk.key,
          item: { hunk, diffed },
          estimate: estimate(hunk),
        })),
      })),
    { name: "hunkSections" },
  );

  const count = (): number => books().reduce((sum, book) => sum + book.hunks.length, 0);
  const onMounted = (ms: number): void => {
    setMounted((held) => ({ n: held.n + 1, total: held.total + ms, max: Math.max(held.max, ms) }));
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2" data-experiment-body="excerpt-diff">
      <div class="flex items-center gap-2 text-small text-on-surface-secondary">
        <Badge tone="muted">{`${count()} cards`}</Badge>
        <Badge tone="muted">{`${reviewed().size} reviewed`}</Badge>
        <span class="text-smallest text-on-surface-tertiary tabular-nums" data-hunk-progress>
          {progress()}
        </span>
        <span class="text-smallest text-on-surface-tertiary tabular-nums" data-hunk-mounts>
          {mounted().n === 0
            ? ""
            : `card mount avg ${(mounted().total / mounted().n).toFixed(1)} ms, max ${mounted().max.toFixed(0)} ms (${mounted().n})`}
        </span>
      </div>
      <div class="flex h-[calc(100vh-220px)] min-h-0">
        <VirtualList<{ hunk: Hunk; diffed: Diffed }>
          sections={sections()}
          header={(section, ref) => (
            <header
              ref={ref}
              class="sticky top-0 z-10 flex items-baseline gap-2 border-b border-surface-border bg-surface-secondary/95 px-1 py-1.5 backdrop-blur-xs"
            >
              <strong class="text-small font-semibold">{section().key}</strong>
              <span class="ms-auto text-smallest text-on-surface-tertiary">
                {`${section().rows.length} cards`}
              </span>
            </header>
          )}
          row={(item) => (
            <div class="pt-3">
              <DiffCard
                hunk={item().hunk}
                sides={item().diffed.sides}
                split={split()}
                usfm={usfm()}
                controls={controlsFor(item().hunk.bookId)}
                baselineLabel={item().diffed.bench.baselineLabel}
                currentLabel={item().diffed.bench.currentLabel}
                onMounted={onMounted}
              />
            </div>
          )}
          empty={<p class="text-small text-on-surface-tertiary">No changes yet.</p>}
        />
      </div>
    </div>
  );
}

const experiment: Experiment = {
  id: "excerpt-diff",
  title: "Changes as excerpts",
  blurb: "Every change as a clipped card with context, as the editor reads it — across every book.",
  dials: {
    layout: { kind: "choice", label: "Layout", options: ["split", "unified"], initial: "unified" },
    mode: { kind: "choice", label: "Mode", options: ["regular", "usfm"], initial: "regular" },
    scope: {
      kind: "choice",
      label: "Books",
      options: ["this book", "all books"],
      initial: "this book",
    },
    context: { kind: "choice", label: "Context", options: ["0", "1", "2"], initial: "1" },
    controls: { kind: "toggle", label: "Unit controls", initial: true },
  },
  view: ExcerptDiff,
};

export default experiment;
