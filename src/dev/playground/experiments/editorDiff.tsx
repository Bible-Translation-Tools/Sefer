/**
 * The diff inside the editor: the book reads as it does in regular mode (or
 * USFM mode), and the engine's diff is drawn on it — split, or unified.
 *
 * The question: can a review keep the reading flow of the editor rather than
 * move every change onto a row of its own? The two earlier experiments here
 * render units as rows; this one renders the BOOK, through the editor's own
 * reading layer (`#editor` `mountDiffView`), and lets the diff be decoration
 * on it. No line differ is involved anywhere: units and word runs are
 * `galley.diff`'s, with spans into each side's own document.
 *
 *  - **Split:** the earlier text on the left, the working text on the right,
 *    each a whole book. Units are tinted, changed words marked, and the pane
 *    you are not reading follows your place by unit — the reference pane's
 *    `watchLocation` pattern — so the verse at the top of one is the verse at
 *    the top of the other.
 *  - **Unified:** the working text alone. Added words are marked where they
 *    are; removed words are drawn inline where they were, struck through; a
 *    unit only the earlier text has is drawn as a block where it stood — a
 *    stamp of the earlier text (`mountStamp`), so it reads like the page too.
 *
 * The gutter holds each changed unit's two choices: take the earlier text
 * (applied at once, through `galley.merge`, and the book re-diffed) or keep the
 * working text (marked as reviewed). Nothing leaves the playground: the
 * working text here is a copy.
 */

import { Result } from "effect";
import { Show, createEffect, createMemo, createSignal, untrack } from "solid-js";

import { useShell } from "#app/ProjectContext";
import { Badge, Button } from "#app/ui/primitives";
import { readingEnd } from "#core/excerpts/excerpts";
import type { Analysis } from "#core/galley";
import type { DecisionUnit, DiffSkeleton } from "#core/galley/diff";
import {
  mountDiffView,
  mountStamp,
  watchLocation,
  type DiffPaint,
  type DiffViewMount,
  type DiffWidget,
} from "#editor/index";

import "#editor/editor.css";

import type { Experiment, ExperimentProps } from "../experiment";

type Side = "baseline" | "current";

/** Units in the engine's own interleave order — what both panes are read in. */
const ordered = (skeleton: DiffSkeleton): readonly DecisionUnit[] => {
  const rows: DecisionUnit[] = [];
  let last = -1;
  for (const slot of skeleton.slots) {
    if (slot.unit === last) continue;
    last = slot.unit;
    const unit = skeleton.units[slot.unit];
    if (unit !== undefined) rows.push(unit);
  }
  return rows.length > 0 ? rows : [...skeleton.units];
};

const changed = (unit: DecisionUnit): boolean => unit.status !== "unchanged";

const tint = (unit: DecisionUnit, reviewed: boolean): string =>
  reviewed
    ? "cm-diff-reviewed"
    : unit.status === "added"
      ? "cm-diff-added-unit"
      : unit.status === "deleted"
        ? "cm-diff-deleted-unit"
        : unit.isUsfmStructureChange
          ? "cm-diff-markup-unit"
          : "cm-diff-modified-unit";

/** Word runs worth marking in this projection: markup only when markup is shown. */
const visibleRun = (what: string, usfm: boolean): boolean =>
  what === "text" || (usfm && what === "markup");

const inline = (text: string, name: string): HTMLElement => {
  const span = document.createElement("span");
  span.className = name;
  span.textContent = text.replace(/\s+/g, " ");
  return span;
};

interface Controls {
  readonly reviewed: ReadonlySet<string>;
  readonly take: (unit: DecisionUnit) => void;
  readonly keep: (unit: DecisionUnit) => void;
}

const controlFor =
  (unit: DecisionUnit, controls: Controls): (() => HTMLElement) =>
  () => {
    const box = document.createElement("span");
    box.className = "cm-diff-control";
    const take = document.createElement("button");
    take.type = "button";
    take.title = "Take the earlier text for this unit";
    take.textContent = "↶";
    take.onclick = () => controls.take(unit);
    const keep = document.createElement("button");
    keep.type = "button";
    keep.title = controls.reviewed.has(unit.id)
      ? "Reviewed — click to undo"
      : "Keep the working text";
    keep.textContent = "✓";
    keep.dataset["on"] = controls.reviewed.has(unit.id) ? "true" : "false";
    keep.onclick = () => controls.keep(unit);
    box.append(take, keep);
    return box;
  };

/** One side of a split: tints, and the words that side has and the other does not. */
const sidePaint = (
  units: readonly DecisionUnit[],
  side: Side,
  usfm: boolean,
  controls: Controls | undefined,
  analysis: Analysis,
): DiffPaint => {
  const lines: DiffPaint["lines"][number][] = [];
  const marks: DiffPaint["marks"][number][] = [];
  const widgets: DiffWidget[] = [];
  const buttons: DiffPaint["controls"][number][] = [];
  let lastEnd = 0;
  for (const unit of units) {
    const span = side === "baseline" ? unit.baseline : unit.current;
    if (span !== undefined) lastEnd = span.to;
    if (!changed(unit)) continue;
    const reviewed = controls?.reviewed.has(unit.id) === true;
    if (span !== undefined) {
      // To where the reading ends, not the structural end: a unit's span runs
      // to the next unit's marker, so it owns the bare `\q1` before the next
      // verse — and in regular mode that hidden line is drawn as the next
      // verse's line, which the tint would then claim.
      const end = usfm ? span.to : readingEnd(analysis, span.from, span.to);
      lines.push({
        from: span.from,
        to: Math.max(span.from + 1, end),
        class: tint(unit, reviewed),
      });
      // Word marks only where there is something to compare: a unit only one
      // side has is ALL change, and marking each of its words says nothing
      // the tint has not.
      const runs =
        unit.status !== "modified"
          ? undefined
          : side === "baseline"
            ? unit.text?.baseline
            : unit.text?.current;
      for (const run of runs ?? [])
        if (run.kind !== "unchanged" && visibleRun(run.what, usfm))
          marks.push({
            from: run.from,
            to: run.to,
            class: side === "baseline" ? "cm-diff-removed" : "cm-diff-added",
          });
    }
    if (controls !== undefined && side === "current")
      buttons.push({
        at: span?.from ?? lastEnd,
        key: `${unit.id} ${reviewed ? 1 : 0}`,
        render: controlFor(unit, controls),
      });
  }
  return { lines, marks, widgets, controls: buttons };
};

/**
 * The working text with the earlier one folded into it: removed words where
 * they were, a removed unit where it stood.
 */
const unifiedPaint = (
  units: readonly DecisionUnit[],
  usfm: boolean,
  controls: Controls | undefined,
  removedBlock: (unit: DecisionUnit) => HTMLElement,
  analysis: Analysis,
): DiffPaint => {
  const base = sidePaint(units, "current", usfm, controls, analysis);
  const widgets: DiffWidget[] = [];
  let lastEnd = 0;
  for (const unit of units) {
    if (unit.current !== undefined) lastEnd = unit.current.to;
    if (!changed(unit)) continue;
    if (unit.current === undefined) {
      widgets.push({
        at: lastEnd,
        block: true,
        key: `gone ${unit.id}`,
        render: () => removedBlock(unit),
      });
      continue;
    }
    const was = unit.text?.baseline ?? [];
    const now = unit.text?.current ?? [];
    // Both sides list their unchanged runs in the same order, so walking them
    // together places each stretch of removed runs just before what replaced
    // it, or just after the last WORD the two share — not after a shared
    // newline or bare `\q1`, which in regular mode is the next verse's line.
    let at = 0;
    let wordEnd = unit.current.from;
    let held: { text: string; from: number } | undefined;
    const flush = (): void => {
      if (held === undefined || held.text.trim() === "") {
        held = undefined;
        return;
      }
      const next = now[at];
      const place = next !== undefined && next.kind === "added" ? next.from : wordEnd;
      const stretch = held;
      widgets.push({
        at: place,
        block: false,
        key: `was ${unit.id} ${stretch.from}`,
        render: () => inline(stretch.text, "cm-diff-struck"),
      });
      held = undefined;
    };
    for (const run of was) {
      if (run.kind === "unchanged") {
        flush();
        while (at < now.length && now[at]?.kind !== "unchanged") {
          const skipped = now[at];
          if (skipped?.what === "text") wordEnd = skipped.to;
          at += 1;
        }
        const shared = now[at];
        if (shared?.what === "text") wordEnd = shared.to;
        at += 1;
        continue;
      }
      // Whitespace joins a stretch (so struck words keep their spaces);
      // markup joins it only where markup is shown.
      if (run.what === "markup" && !usfm) continue;
      held =
        held === undefined
          ? { text: run.text, from: run.from }
          : { ...held, text: held.text + run.text };
    }
    flush();
  }
  return { ...base, widgets: [...base.widgets, ...widgets] };
};

function EditorDiff(props: ExperimentProps) {
  // Every step is a span in the app's own ring, so the prototype's costs read
  // in `__sefer.observability.traces` like any screen's.
  const observability = useShell().services.composition.observability;
  const layout = (): string => props.dials.choice("layout");
  const usfm = (): boolean => props.dials.choice("mode") === "usfm";
  const withControls = (): boolean => props.dials.toggle("controls");

  /** The working text: the bench's, until a unit is taken back. A copy; nothing writes. */
  const [working, setWorking] = createSignal<string | undefined>(undefined, {
    name: "diffWorking",
  });
  const [reviewed, setReviewed] = createSignal<ReadonlySet<string>>(new Set(), {
    name: "diffReviewed",
  });
  /** The last mount's cost, written from the mount effect (never from a memo). */
  const [mountMs, setMountMs] = createSignal<number | undefined>(undefined, {
    name: "diffMountMs",
  });
  const timing = (): string => {
    const diff = skeleton()?.ms;
    const mount = mountMs();
    return [
      diff === undefined ? "" : `diff ${diff.toFixed(1)} ms`,
      mount === undefined ? "" : `mount ${mount.toFixed(0)} ms`,
    ]
      .filter((part) => part !== "")
      .join(" · ");
  };

  const bench = () => props.bench;
  const text = (): string | undefined => working() ?? bench()?.currentText;

  const skeleton = createMemo(
    () => {
      const held = bench();
      const now = text();
      if (held === undefined || now === undefined) return undefined;
      // Its own operation: re-diffing is the cost of every take, and the one
      // number a split-versus-unified decision needs beside the mount's.
      const op = observability.operation("playground.diff.compare", { "diff.book": held.bookId });
      const found = held.galley.diff(held.baselineText, now);
      const ms = op.end(Result.isSuccess(found) ? "passed" : "failed", {
        "diff.units": Result.isSuccess(found) ? found.success.units.length : 0,
        "diff.baseline.bytes": held.baselineText.length,
        "diff.current.bytes": now.length,
      });
      return Result.isSuccess(found) ? { skeleton: found.success, ms } : undefined;
    },
    { name: "diffSkeleton" },
  );
  const units = createMemo(() => {
    const held = skeleton();
    return held === undefined ? [] : ordered(held.skeleton);
  });
  const count = () => units().filter(changed).length;

  const take = (unit: DecisionUnit): void => {
    const held = bench();
    const now = text();
    if (held === undefined || now === undefined) return;
    const op = observability.operation("playground.diff.take", {
      "diff.unit": unit.id,
      "diff.status": unit.status,
    });
    const merged = held.galley.merge(
      held.baselineText,
      now,
      new Map([[unit.id, "baseline"]]),
      "current",
    );
    op.end(Result.isSuccess(merged) ? "passed" : "failed");
    if (Result.isSuccess(merged)) setWorking(merged.success);
  };
  const keep = (unit: DecisionUnit): void => {
    setReviewed((held) => {
      const next = new Set(held);
      if (next.has(unit.id)) next.delete(unit.id);
      else next.add(unit.id);
      return next;
    });
  };

  const [left, setLeft] = createSignal<HTMLDivElement | undefined>(undefined, { name: "diffLeft" });
  const [right, setRight] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "diffRight",
  });

  // The views, mounted per text and layout. A new working text is a new
  // document, so it is a new view — the playground's copy has no funnel to
  // hand changes through.
  createEffect(
    () => ({
      held: bench(),
      now: text(),
      shape: layout(),
      l: left(),
      r: right(),
    }),
    ({ held, now, shape, l, r }) => {
      if (held === undefined || now === undefined || r === undefined) return;
      const op = observability.operation("playground.diff.show", {
        "diff.layout": shape,
        "diff.book": held.bookId,
        "diff.mode": untrack(usfm) ? "usfm" : "regular",
      });
      const mounted = op.span("playground.diff.mount", shape);
      const projection = untrack(usfm) ? "usfm" : "default";
      const baselineAnalyze = held.galley.memoize("diff.baseline");
      const currentAnalyze = held.galley.memoize("diff.current");
      const controls = (): Controls | undefined =>
        untrack(withControls) ? { reviewed: untrack(reviewed), take, keep } : undefined;
      const removedBlock = (unit: DecisionUnit): HTMLElement => {
        const block = document.createElement("div");
        block.className = "cm-diff-gone";
        if (unit.baseline !== undefined)
          mountStamp({
            parent: block,
            analysis: baselineAnalyze(held.baselineText),
            range: unit.baseline,
            mode: projection,
            marks: [],
            surface: "cm-excerpt",
            label: `gone:${unit.id}`,
          });
        return block;
      };
      const paintFor = (side: Side | "unified"): DiffPaint => {
        const list = untrack(units);
        const markup = untrack(usfm);
        const current = currentAnalyze(now);
        if (side === "unified")
          return unifiedPaint(list, markup, controls(), removedBlock, current);
        return side === "current"
          ? sidePaint(list, side, markup, controls(), current)
          : sidePaint(list, side, markup, undefined, baselineAnalyze(held.baselineText));
      };

      const mounts: { side: Side | "unified"; mount: DiffViewMount }[] = [];
      const releases: (() => void)[] = [];

      /**
       * The other pane follows the reader's PLACE — the pattern the reference
       * pane already uses (`watchLocation`): the pane being read reports the
       * offset at its top, the unit there is found, and the other pane shows
       * that unit's pair at its own top. Units are places both texts share, so
       * following by unit needs no height bookkeeping at all.
       *
       * The pane the reader last touched leads; the follower's own scroll
       * reports are ignored, which is what keeps the two from chasing each
       * other.
       */
      let leader: Side = "current";
      const pairAt = (side: Side, top: number): number | undefined => {
        const list = untrack(units);
        let found: DecisionUnit | undefined;
        for (const unit of list) {
          const span = side === "baseline" ? unit.baseline : unit.current;
          if (span === undefined) continue;
          if (span.from > top) break;
          found = unit;
        }
        const other = side === "baseline" ? found?.current : found?.baseline;
        return other?.from;
      };
      const followFrom = (side: Side, mount: DiffViewMount): void => {
        releases.push(
          watchLocation(mount.view, (where) => {
            if (where === null || side !== leader) return;
            const target = mounts.find((entry) => entry.side !== side)?.mount;
            // The END of the line at the top, not its start: a visual line in
            // regular mode opens with the bare `\q1` that belongs to the unit
            // BEFORE, and following that would show the verse above.
            const probe = Math.max(where.top, mount.view.lineBlockAt(where.top).to - 1);
            const at = pairAt(side, probe);
            if (target === undefined || at === undefined) return;
            // A span, not an operation: it fires once a frame while scrolling.
            const done = observability.span("playground.diff.follow", side);
            target.showAt(at);
            done();
          }),
        );
        const take = (): void => {
          leader = side;
        };
        const events = ["wheel", "pointerdown", "keydown", "touchstart"] as const;
        const host = mount.view.dom;
        for (const name of events) host.addEventListener(name, take, { passive: true });
        releases.push(() => {
          for (const name of events) host.removeEventListener(name, take);
        });
      };

      if (shape === "split" && l !== undefined) {
        const was = mountDiffView({
          parent: l,
          text: held.baselineText,
          analyze: baselineAnalyze,
          mode: projection,
          paint: paintFor("baseline"),
        });
        const now2 = mountDiffView({
          parent: r,
          text: now,
          analyze: currentAnalyze,
          mode: projection,
          paint: paintFor("current"),
        });
        mounts.push({ side: "baseline", mount: was }, { side: "current", mount: now2 });
        followFrom("baseline", was);
        followFrom("current", now2);
      } else {
        mounts.push({
          side: "unified",
          mount: mountDiffView({
            parent: r,
            text: now,
            analyze: currentAnalyze,
            mode: projection,
            paint: paintFor("unified"),
          }),
        });
      }
      const paintedMs = mounted({ "diff.changed": untrack(units).filter(changed).length });
      op.end("passed");
      setMountMs(paintedMs);

      // Repaint in place when only the decisions, the mode or the controls moved.
      const stop = createRepaint(() => {
        for (const entry of mounts) {
          entry.mount.setMode(usfm() ? "usfm" : "default");
          entry.mount.repaint(paintFor(entry.side));
        }
      });
      return () => {
        stop();
        for (const release of releases) release();
        for (const entry of mounts) entry.mount.destroy();
      };
    },
  );

  /**
   * A repaint hook that outlives one mount: the effect above owns the views,
   * this tracks what may change under them without remounting.
   */
  let repaint: (() => void) | undefined;
  const createRepaint = (run: () => void): (() => void) => {
    repaint = run;
    return () => {
      if (repaint === run) repaint = undefined;
    };
  };
  createEffect(
    () => ({ marked: reviewed(), markup: usfm(), controls: withControls() }),
    () => repaint?.(),
  );

  return (
    <Show
      when={bench()}
      fallback={<p class="text-small text-on-surface-tertiary">Pick a book to put on the bench.</p>}
    >
      <div class="flex min-h-0 flex-1 flex-col gap-2" data-experiment-body="editor-diff">
        <div class="flex items-center gap-2 text-small text-on-surface-secondary">
          <Badge tone="muted">{`${count()} changed`}</Badge>
          <Badge tone="muted">{`${reviewed().size} reviewed`}</Badge>
          <span class="text-smallest text-on-surface-tertiary tabular-nums">{timing()}</span>
          <Show when={working() !== undefined}>
            <Button
              size="sm"
              variant="secondary"
              class="ms-auto"
              onClick={() => setWorking(undefined)}
            >
              Reset the working text
            </Button>
          </Show>
        </div>
        <div
          class={
            layout() === "split"
              ? "grid min-h-0 flex-1 grid-cols-2 gap-3"
              : "grid min-h-0 flex-1 grid-cols-1"
          }
        >
          <Show when={layout() === "split"}>
            <div class="flex min-h-0 flex-col">
              <p class="pb-1 text-smallest text-on-surface-tertiary">{bench()?.baselineLabel}</p>
              <div class="cm-diff-pane h-[calc(100vh-240px)]" ref={setLeft} />
            </div>
          </Show>
          <div class="flex min-h-0 flex-col">
            <p class="pb-1 text-smallest text-on-surface-tertiary">{bench()?.currentLabel}</p>
            <div class="cm-diff-pane h-[calc(100vh-240px)]" ref={setRight} />
          </div>
        </div>
      </div>
    </Show>
  );
}

const experiment: Experiment = {
  id: "editor-diff",
  title: "In the editor",
  blurb: "The book as the editor reads it, with the engine's diff drawn on it — split or unified.",
  dials: {
    layout: { kind: "choice", label: "Layout", options: ["split", "unified"], initial: "split" },
    mode: { kind: "choice", label: "Mode", options: ["regular", "usfm"], initial: "regular" },
    controls: { kind: "toggle", label: "Unit controls", initial: true },
  },
  view: EditorDiff,
};

export default experiment;
