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
import { Show, createEffect, createMemo, createSignal, untrack } from "solid-js";

import { useShell } from "#app/ProjectContext";
import { Badge, Card, VirtualList, type VirtualSection } from "#app/ui/primitives";
import { tocViewOf, type Analysis } from "#core/galley";
import { unitReference, type DecisionUnit } from "#core/galley/diff";
import { tocUnits, unitIndexAt } from "#core/location/locate";
import { mountDiffView, mountStamp, type DiffViewMount } from "#editor/index";

import "#editor/editor.css";

import { benchFor } from "../bench";
import { changed, ordered, sidePaint, unifiedPaint, type Controls } from "../diffPaint";
import type { Bench, Experiment, ExperimentProps } from "../experiment";

/** One card: the changes it holds, and the stretch of each text it shows. */
interface Hunk {
  readonly bookId: string;
  readonly key: string;
  readonly units: readonly DecisionUnit[];
  /** What the working text shows, and where it stands before the first unit. */
  readonly current: { readonly from: number; readonly to: number };
  readonly currentStart: number;
  /** What the earlier text shows; absent when every unit here is new. */
  readonly baseline: { readonly from: number; readonly to: number } | undefined;
  readonly baselineStart: number;
}

interface Diffed {
  readonly bench: Bench;
  readonly baseline: Analysis;
  readonly current: Analysis;
  readonly hunks: readonly Hunk[];
}

/** `[from, to)` widened by `steps` TOC units either side, in one text. */
const withContext = (
  analysis: Analysis,
  from: number,
  to: number,
  steps: number,
): { from: number; to: number } => {
  const units = tocUnits(tocViewOf(analysis));
  const low = Math.max(0, unitIndexAt(units, from) - steps);
  const high = Math.min(units.length - 1, unitIndexAt(units, Math.max(from, to - 1)) + steps);
  return { from: units[low]?.from ?? from, to: units[high]?.to ?? to };
};

/**
 * The changed units of one book as cards: each change with its context, and
 * neighbours whose context would overlap joined into one card.
 */
const hunksOf = (
  bench: Bench,
  units: readonly DecisionUnit[],
  baseline: Analysis,
  current: Analysis,
  steps: number,
): Hunk[] => {
  const out: Hunk[] = [];
  let currentEnd = 0;
  let baselineEnd = 0;
  for (const unit of units) {
    const beforeCurrent = currentEnd;
    const beforeBaseline = baselineEnd;
    if (unit.current !== undefined) currentEnd = unit.current.to;
    if (unit.baseline !== undefined) baselineEnd = unit.baseline.to;
    if (!changed(unit)) continue;
    const here = unit.current ?? { from: beforeCurrent, to: beforeCurrent };
    const shown = withContext(current, here.from, Math.max(here.from + 1, here.to), steps);
    const was =
      unit.baseline === undefined
        ? undefined
        : withContext(baseline, unit.baseline.from, unit.baseline.to, steps);
    const last = out[out.length - 1];
    if (last !== undefined && shown.from <= last.current.to) {
      out[out.length - 1] = {
        ...last,
        units: [...last.units, unit],
        current: { from: last.current.from, to: Math.max(last.current.to, shown.to) },
        baseline:
          was === undefined
            ? last.baseline
            : last.baseline === undefined
              ? was
              : { from: last.baseline.from, to: Math.max(last.baseline.to, was.to) },
      };
      continue;
    }
    out.push({
      bookId: bench.bookId,
      key: `${bench.bookId} ${unit.id}`,
      units: [unit],
      current: shown,
      currentStart: beforeCurrent,
      baseline: was,
      baselineStart: beforeBaseline,
    });
  }
  return out;
};

/** Roughly one line of the scripture serif per this many characters of source. */
const CHARS_PER_LINE = 70;

const estimate = (hunk: Hunk): number =>
  60 + Math.ceil((hunk.current.to - hunk.current.from) / CHARS_PER_LINE) * 30;

function HunkCard(props: {
  readonly hunk: Hunk;
  readonly diffed: Diffed;
  readonly split: boolean;
  readonly usfm: boolean;
  readonly controls: Controls | undefined;
  readonly onMounted: (ms: number) => void;
}) {
  const [left, setLeft] = createSignal<HTMLDivElement | undefined>(undefined, { name: "hunkLeft" });
  const [right, setRight] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "hunkRight",
  });

  createEffect(
    () => ({
      l: left(),
      r: right(),
      split: props.split,
      usfm: props.usfm,
      controls: props.controls,
    }),
    ({ l, r, split, usfm, controls }) => {
      if (r === undefined) return;
      const started = performance.now();
      const { hunk, diffed } = untrack(() => ({ hunk: props.hunk, diffed: props.diffed }));
      const mode = usfm ? "usfm" : "default";
      const mounts: DiffViewMount[] = [];
      const removedBlock = (unit: DecisionUnit): HTMLElement => {
        const block = document.createElement("div");
        block.className = "cm-diff-gone";
        if (unit.baseline !== undefined)
          mountStamp({
            parent: block,
            analysis: diffed.baseline,
            range: unit.baseline,
            mode,
            marks: [],
            surface: "cm-excerpt",
            label: `gone:${unit.id}`,
          });
        return block;
      };
      if (split) {
        if (l !== undefined && hunk.baseline !== undefined)
          mounts.push(
            mountDiffView({
              parent: l,
              text: diffed.bench.baselineText,
              analyze: () => diffed.baseline,
              mode,
              clip: hunk.baseline,
              surface: "cm-diff cm-diff-card",
              paint: sidePaint(
                hunk.units,
                "baseline",
                usfm,
                undefined,
                diffed.baseline,
                hunk.baselineStart,
              ),
            }),
          );
        mounts.push(
          mountDiffView({
            parent: r,
            text: diffed.bench.currentText,
            analyze: () => diffed.current,
            mode,
            clip: hunk.current,
            surface: "cm-diff cm-diff-card",
            paint: sidePaint(
              hunk.units,
              "current",
              usfm,
              controls,
              diffed.current,
              hunk.currentStart,
            ),
          }),
        );
      } else {
        mounts.push(
          mountDiffView({
            parent: r,
            text: diffed.bench.currentText,
            analyze: () => diffed.current,
            mode,
            clip: hunk.current,
            surface: "cm-diff cm-diff-card",
            paint: unifiedPaint(
              hunk.units,
              usfm,
              controls,
              removedBlock,
              diffed.current,
              hunk.currentStart,
            ),
          }),
        );
      }
      props.onMounted(performance.now() - started);
      return () => {
        for (const mount of mounts) mount.destroy();
      };
    },
  );

  /**
   * What KIND of change the card holds, when that is not the words: the
   * engine's own classification (`isWhitespaceChange`, `isUsfmStructureChange`
   * — reader-visible text unchanged). A card whose every change is one of those
   * says so; a card with some says how many, since the rest are the words.
   */
  const kind = (): string | undefined => {
    const units = props.hunk.units;
    const spaces = units.filter((unit) => unit.isWhitespaceChange).length;
    const markup = units.filter(
      (unit) => !unit.isWhitespaceChange && unit.isUsfmStructureChange,
    ).length;
    if (spaces === units.length) return "whitespace only";
    if (markup === units.length) return "markup only";
    if (spaces + markup === units.length) return "markup and whitespace only";
    const parts = [
      markup > 0 ? `${markup} markup only` : "",
      spaces > 0 ? `${spaces} whitespace only` : "",
    ].filter((part) => part !== "");
    return parts.length === 0 ? undefined : parts.join(" · ");
  };
  const first = () => props.hunk.units[0];
  const last = () => props.hunk.units[props.hunk.units.length - 1];
  const label = (): string => {
    const a = first();
    const b = last();
    if (a === undefined || b === undefined) return "";
    return a === b ? unitReference(a) : `${unitReference(a)} – ${unitReference(b)}`;
  };

  return (
    <div class="pt-3">
      <Card padded={false} class="overflow-hidden" data-hunk={props.hunk.key}>
        <header class="flex items-center gap-2 border-b border-surface-border px-3 py-1.5">
          <strong class="text-small font-medium text-on-surface-primary">
            {props.hunk.bookId} {label()}
          </strong>
          <span class="text-smallest text-on-surface-tertiary">
            {props.hunk.units.length === 1 ? first()?.status : `${props.hunk.units.length} changes`}
          </span>
          <Show when={kind()}>{(label) => <Badge tone="muted">{label()}</Badge>}</Show>
        </header>
        <div class={props.split ? "grid grid-cols-2 gap-0 divide-x divide-surface-border" : ""}>
          <Show when={props.split}>
            <div class="min-w-0" ref={setLeft}>
              <Show when={props.hunk.baseline === undefined}>
                <p class="px-3 py-2 text-small text-on-surface-tertiary italic">
                  Not in the earlier text.
                </p>
              </Show>
            </div>
          </Show>
          <div class="min-w-0" ref={setRight} />
        </div>
      </Card>
    </div>
  );
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
    const baseline = analyzeBaseline(bench.baselineText);
    const current = analyzeCurrent(text);
    const live = { ...bench, currentText: text, skeleton: found.success };
    const hunks = hunksOf(live, ordered(found.success), baseline, current, untrack(steps));
    done({ "diff.units": found.success.units.length, "diff.hunks": hunks.length });
    return { bench: live, baseline, current, hunks };
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
  const keep = (unit: DecisionUnit): void => {
    setReviewed((held) => {
      const next = new Set(held);
      if (next.has(unit.id)) next.delete(unit.id);
      else next.add(unit.id);
      return next;
    });
  };
  const controlsFor = (bookId: string): Controls | undefined =>
    withControls() ? { reviewed: reviewed(), take: (unit) => take(unit, bookId), keep } : undefined;

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
            <HunkCard
              hunk={item().hunk}
              diffed={item().diffed}
              split={split()}
              usfm={usfm()}
              controls={controlsFor(item().hunk.bookId)}
              onMounted={onMounted}
            />
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
