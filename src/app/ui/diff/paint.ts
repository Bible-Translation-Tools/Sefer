import type { DiffHunk, DiffPaint } from "@wycliffeassociates/sefer-editor";

import { readingEnd } from "#core/excerpts/excerpts";
import type { Analysis } from "#core/galley";
import { unitReference, type DecisionUnit, type MergeSide } from "#core/galley/diff";

export type Side = "baseline" | "current";

export const changed = (unit: DecisionUnit): boolean => unit.status !== "unchanged";

/**
 * Which way the colours read. The column on the right is "now": green for its
 * words, red for the other's. Normally that is `current` (the editor, against
 * its past); with `currentFirst` the current side is drawn on the left, so the
 * baseline is now — a suggestion, read as a change to the shared project.
 */
const nowSide = (currentFirst: boolean): Side => (currentFirst ? "baseline" : "current");

const tint = (
  unit: DecisionUnit,
  decision: MergeSide | undefined,
  live: boolean,
  marked: boolean,
  currentFirst: boolean,
): string =>
  live && changed(unit)
    ? statusTint(unit, marked, currentFirst)
    : decidedTint(decision, unit, marked, currentFirst);

const modifiedRuns = (unit: DecisionUnit, side: Side) => {
  if (unit.status !== "modified") return undefined;
  return side === "baseline" ? unit.text?.baseline : unit.text?.current;
};

const hunkKind = (unit: DecisionUnit): "decided" | "added" | "modified" => {
  if (!changed(unit)) return "decided";
  return unit.status === "added" ? "added" : "modified";
};

const hunkVerb = (unit: DecisionUnit): string => {
  if (!changed(unit)) return "Decided";
  return unit.status === "added" ? "Added" : "Changed";
};

const decidedTint = (
  decision: MergeSide | undefined,
  unit: DecisionUnit,
  marked: boolean,
  currentFirst: boolean,
): string => {
  if (decision === "current") return "cm-diff-kept";
  if (decision === "baseline") return "cm-diff-taken";
  return statusTint(unit, marked, currentFirst);
};

const statusTint = (unit: DecisionUnit, marked: boolean, currentFirst: boolean): string => {
  const onlyNow = currentFirst ? "deleted" : "added";
  if (unit.status === "added" || unit.status === "deleted")
    return unit.status === onlyNow ? "cm-diff-added-unit" : "cm-diff-deleted-unit";
  return unit.isUsfmStructureChange || !marked ? "cm-diff-markup-unit" : "";
};

const marksWords = (unit: DecisionUnit, usfm: boolean): boolean =>
  [...(unit.text?.baseline ?? []), ...(unit.text?.current ?? [])].some(
    (run) => run.kind !== "unchanged" && visibleRun(run.what, usfm),
  );

const visibleRun = (what: string, usfm: boolean): boolean => what !== "markup" || usfm;

export interface Controls {
  readonly decision: (unit: DecisionUnit) => MergeSide | undefined;
  readonly decide: (unit: DecisionUnit, side: MergeSide | undefined) => void;
  readonly keepTitle: string;
  readonly takeTitle: string;
  readonly live?: boolean;
  readonly gutter?: boolean;
  readonly dimUnchosen?: boolean;
}

const chevron = (points: "left" | "right"): SVGSVGElement => {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svgNamespace, "path");
  path.setAttribute("d", points === "left" ? "M15 5 L8 12 L15 19" : "M9 5 L16 12 L9 19");
  svg.append(path);
  return svg;
};

const button = (
  unit: DecisionUnit,
  controls: Controls,
  side: MergeSide,
  title: string,
  currentFirst: boolean,
): HTMLButtonElement => {
  const on = controls.decision(unit) === side;
  const element = document.createElement("button");
  element.type = "button";
  element.title = title;
  element.append(chevron((side === "baseline") === currentFirst ? "right" : "left"));
  element.dataset["on"] = on ? "true" : "false";
  element.dataset["side"] = side;
  element.setAttribute("aria-pressed", on ? "true" : "false");
  element.setAttribute("aria-label", title);
  element.onclick = () => controls.decide(unit, on ? undefined : side);
  return element;
};

const controlFor =
  (unit: DecisionUnit, controls: Controls, currentFirst: boolean): (() => HTMLElement) =>
  () => {
    const box = document.createElement("span");
    box.className = "cm-diff-control";
    box.dataset["unit"] = unit.id;
    const reference = unitReference(unit);
    const ref = document.createElement("span");
    ref.className = "cm-diff-control-ref";
    ref.textContent = reference.slice(reference.indexOf(":") + 1);
    const take = button(unit, controls, "baseline", controls.takeTitle, currentFirst);
    const keep = button(unit, controls, "current", controls.keepTitle, currentFirst);
    if (currentFirst) box.append(keep, ref, take);
    else box.append(take, ref, keep);
    return box;
  };

export const sidePaint = (
  units: readonly DecisionUnit[],
  side: Side,
  usfm: boolean,
  controls: Controls | undefined,
  analysis: Analysis,
  currentFirst = false,
): DiffPaint => {
  const lines: DiffPaint["lines"][number][] = [];
  const marks: DiffPaint["marks"][number][] = [];
  const buttons: DiffPaint["controls"][number][] = [];
  for (const unit of units) {
    const span = side === "baseline" ? unit.baseline : unit.current;
    const decision = controls?.decision(unit);
    if (!changed(unit) && decision === undefined) continue;
    if (span !== undefined) {
      const end = usfm ? span.to : readingEnd(analysis, span.from, span.to);
      const unchosen =
        controls?.dimUnchosen === true &&
        decision !== undefined &&
        (controls.live === true ? side === "baseline" : decision !== side);
      const line = unchosen
        ? "cm-diff-unchosen"
        : tint(unit, decision, controls?.live === true, marksWords(unit, usfm), currentFirst);
      if (line !== "")
        lines.push({ from: span.from, to: Math.max(span.from + 1, end), class: line });
      const runs = modifiedRuns(unit, side);
      for (const run of runs ?? [])
        if (run.kind !== "unchanged" && visibleRun(run.what, usfm))
          marks.push({
            from: run.from,
            to: run.to,
            class: side === nowSide(currentFirst) ? "cm-diff-added" : "cm-diff-removed",
          });
    }
    if (controls !== undefined && controls.gutter !== false && side === "current")
      buttons.push({
        at: span?.from ?? unit.place[side],
        key: `${unit.id} ${decision ?? "-"}`,
        render: controlFor(unit, controls, currentFirst),
      });
  }
  return { lines, marks, controls: buttons };
};

type TextRun = NonNullable<DecisionUnit["text"]>["current"][number];

/**
 * A side's runs cut into stretches at its unchanged words. A space alone
 * between two changed words is not a break: "Let me tell of" → "I will
 * proclaim" is one stretch, not four, so it reads as one tracked change
 * ("~~Let me tell of~~ I will proclaim") rather than alternating word by word.
 */
interface Stretch {
  /** The first and last changed run of the stretch, if it has any. */
  readonly first?: TextRun;
  readonly last?: TextRun;
  /** Where the stretch begins when it changed nothing: just after the last unchanged word. */
  readonly at: number;
}
const stretchesOf = (runs: readonly TextRun[], usfm: boolean, start: number): Stretch[] => {
  const out: Stretch[] = [];
  let first: TextRun | undefined;
  let last: TextRun | undefined;
  let at = start;
  const close = (): void => {
    out.push({ first, last, at });
    first = undefined;
    last = undefined;
  };
  for (const run of runs) {
    if (run.kind === "unchanged") {
      if (run.text.trim() === "" && first !== undefined) continue;
      close();
      at = run.to;
      continue;
    }
    // A space on its own is no word to mark: underlined, it reads as "_day".
    if (!visibleRun(run.what, usfm) || run.text.trim() === "") continue;
    first ??= run;
    last = run;
  }
  close();
  return out;
};

/**
 * A changed run's anchor: how many unchanged non-space characters come before
 * it on its own side. Both sides hold the same unchanged words, so a removed
 * stretch and the added one that replaced it share an anchor however the two
 * sides cut their unchanged text into runs, and a space alone never parts them.
 */
const anchored = (
  runs: readonly TextRun[],
  kind: "removed" | "added",
  usfm: boolean,
): Map<number, TextRun[]> => {
  const out = new Map<number, TextRun[]>();
  let seen = 0;
  for (const run of runs) {
    if (run.kind === "unchanged") {
      seen += run.text.replace(/\s+/gu, "").length;
      continue;
    }
    if (run.kind !== kind || !visibleRun(run.what, usfm) || run.text.trim() === "") continue;
    const group = out.get(seen);
    if (group === undefined) out.set(seen, [run]);
    else group.push(run);
  }
  return out;
};

/**
 * A changed unit as tracked changes, in reading order: each removed stretch
 * with the added one that took its place ("" when nothing did), paired by the
 * same anchor the inline paint uses.
 */
export const replacements = (
  unit: DecisionUnit,
  usfm: boolean,
): readonly { readonly removed: string; readonly added: string }[] => {
  const removed = anchored(unit.text?.baseline ?? [], "removed", usfm);
  const added = anchored(unit.text?.current ?? [], "added", usfm);
  const text = (runs: readonly TextRun[] | undefined): string =>
    (runs ?? []).map((run) => run.text).join(" ");
  return [...new Set([...removed.keys(), ...added.keys()])]
    .toSorted((a, b) => a - b)
    .map((anchor) => ({ removed: text(removed.get(anchor)), added: text(added.get(anchor)) }));
};

/** The current-text offset just after `count` unchanged non-space characters, and the spaces after them. */
const offsetAfter = (runs: readonly TextRun[], count: number, start: number): number => {
  let left = count;
  let at = start;
  for (const run of runs) {
    if (run.kind !== "unchanged") {
      if (left === 0) return at;
      continue;
    }
    at = run.from;
    for (const char of run.text) {
      if (left === 0 && !/\s/u.test(char)) return at;
      if (!/\s/u.test(char)) left -= 1;
      at += char.length;
    }
  }
  return at;
};

/**
 * Where each stretch's removed words stand in the current text: just before
 * the words that replaced them, as a tracked change reads ("~~At~~ About"), or
 * where they stood when nothing replaced them.
 */
const ghostsOf = (unit: DecisionUnit, usfm: boolean): { at: number; text: string }[] => {
  const baseline = unit.text?.baseline ?? [];
  const current = unit.text?.current ?? [];
  const added = anchored(current, "added", usfm);
  const start = unit.current?.from ?? unit.place.current;
  return [...anchored(baseline, "removed", usfm)].map(([anchor, runs]) => {
    const first = runs[0];
    const last = runs.at(-1);
    const text = baseline
      .slice(baseline.indexOf(first), baseline.indexOf(last ?? first) + 1)
      .filter((run) => run.kind === "unchanged" || visibleRun(run.what, usfm))
      .map((run) => run.text)
      .join("");
    const replaced = added.get(anchor)?.[0];
    return { at: replaced?.from ?? offsetAfter(current, anchor, start), text };
  });
};

/**
 * One word changed by a few letters ("walk" → "wal", "man" → "men", "sinner"
 * → "sinners"): drawn as those letters, not the whole word struck and
 * written again. Only when one removed word and one added word share an
 * anchor, neither holds a space, and what differs is one run of at most two
 * letters or a third of the word. Display only: the decision is still the
 * whole unit.
 *
 * TODO(Will, 2026-11-20): a trial. Once the rule reads right, move it into
 * the kitchen's word runs (`unit_text_diff`, onion/src/diff.rs) so every
 * consumer draws the same letters, and take this back out.
 */
interface Letters {
  /** The added word as the engine gave it. */
  readonly word: { readonly from: number; readonly to: number };
  /** The letters only the old word had, and where they stand in the new one. */
  readonly ghost: { readonly at: number; readonly text: string };
  /** The letters only the new word has; empty when it only lost some. */
  readonly mark: { readonly from: number; readonly to: number };
}

const lettersOf = (unit: DecisionUnit, usfm: boolean): Letters[] => {
  const removed = anchored(unit.text?.baseline ?? [], "removed", usfm);
  const out: Letters[] = [];
  for (const [anchor, added] of anchored(unit.text?.current ?? [], "added", usfm)) {
    const gone = removed.get(anchor);
    const [was] = gone ?? [];
    const [now] = added;
    if (gone?.length !== 1 || added.length !== 1 || was === undefined || now === undefined)
      continue;
    const before = [...was.text];
    const after = [...now.text];
    if (before.some((char) => /\s/u.test(char)) || after.some((char) => /\s/u.test(char))) continue;
    let head = 0;
    while (head < before.length && head < after.length && before[head] === after[head]) head += 1;
    let tail = 0;
    while (
      tail < before.length - head &&
      tail < after.length - head &&
      before[before.length - 1 - tail] === after[after.length - 1 - tail]
    )
      tail += 1;
    const lost = before.slice(head, before.length - tail).join("");
    const gained = after.slice(head, after.length - tail).join("");
    const longest = Math.max(before.length, after.length);
    const differs = Math.max([...lost].length, [...gained].length);
    if (head + tail === 0 || (differs > 2 && differs * 3 > longest)) continue;
    const at = now.from + after.slice(0, head).join("").length;
    out.push({
      word: { from: now.from, to: now.to },
      ghost: { at: at, text: lost },
      mark: { from: at, to: at + gained.length },
    });
  }
  return out;
};

/** One mark per stretch of added words, spaces between them included. */
const addedMarks = (unit: DecisionUnit, usfm: boolean): { from: number; to: number }[] =>
  stretchesOf(unit.text?.current ?? [], usfm, 0).flatMap((stretch) =>
    stretch.first === undefined || stretch.last === undefined
      ? []
      : [{ from: stretch.first.from, to: stretch.last.to }],
  );

/** A changed word's mark narrowed to the letters it gained; none when it only lost some. */
const withLetters = (
  marks: readonly { readonly from: number; readonly to: number }[],
  letters: readonly Letters[],
): { from: number; to: number }[] =>
  marks.flatMap((mark) => {
    const word = letters.find((each) => each.word.from === mark.from && each.word.to === mark.to);
    if (word === undefined) return [mark];
    return word.mark.to > word.mark.from ? [word.mark] : [];
  });

/** The whole struck word becomes the struck letters, inside the new word; none when it only gained some. */
const lettersInGhosts = (
  ghosts: readonly { readonly at: number; readonly text: string }[],
  letters: readonly Letters[],
): { at: number; text: string; letters?: boolean }[] =>
  ghosts.flatMap((ghost) => {
    const word = letters.find((each) => each.word.from === ghost.at);
    if (word === undefined) return [ghost];
    return word.ghost.text === "" ? [] : [{ ...word.ghost, letters: true }];
  });

export const hunkPaint = (
  units: readonly DecisionUnit[],
  usfm: boolean,
  controls: Controls | undefined,
  was: (unit: DecisionUnit) => HTMLElement,
  analysis: Analysis,
  inlineRemoved = false,
  active: string | undefined = undefined,
  /**
   * A decided change reads as the text it settled on. Inline, the active one
   * keeps what it passed over beside it, faint and struck, and the words it
   * kept carry the settled underline: its current side is what was kept.
   */
  settled: (unit: DecisionUnit) => boolean = () => false,
  /**
   * The change came from the other side, so the words only it has are what
   * arrives: inline, they read as added and the editor's own as struck through.
   */
  incoming: (unit: DecisionUnit) => boolean = () => false,
): DiffPaint => {
  const base = sidePaint(units, "current", usfm, controls, analysis);
  const hunks: DiffHunk[] = [];
  for (const unit of units) {
    const span = unit.current;
    const decision = controls?.decision(unit);
    if (!changed(unit) && decision === undefined) continue;
    const decided = settled(unit);
    const quiet = unit.id !== active && decided;
    // Decided and active, inline: the kept words settled, the passed-over ones faint.
    const kept = inlineRemoved && unit.id === active && decided;
    const arriving = inlineRemoved && incoming(unit) && !kept;
    if (span === undefined) {
      // Inline, a whole removed unit reads where it stood, struck through, as
      // removed words do; otherwise it waits behind its bar.
      const gone =
        inlineRemoved && !quiet
          ? (was(unit).textContent ?? "").trim().replace(/^(\d+)(?=\S)/u, "$1 ")
          : "";
      hunks.push({
        key: unit.id,
        kind: "deleted",
        from: unit.place.current,
        to: unit.place.current,
        tint: "",
        marks: [],
        old: () => was(unit),
        label: `Removed ${unitReference(unit)}`,
        ghosts:
          gone === ""
            ? undefined
            : [{ at: unit.place.current, text: `${gone} `, added: arriving, lost: kept }],
      });
      continue;
    }
    const end = usfm ? span.to : readingEnd(analysis, span.from, span.to);
    const markKind = arriving ? "cm-diff-removed" : "cm-diff-added";
    const markClass = kept
      ? "cm-diff-settled"
      : unit.id === active
        ? `${markKind} cm-diff-active`
        : markKind;
    // Inline, a whole added unit is one mark, as added words are.
    const whole =
      inlineRemoved && unit.status === "added" && !quiet
        ? [{ from: span.from, to: Math.max(span.from + 1, end) }]
        : [];
    // Settled, inline: a dotted underline over what the decision left, so it can be found again.
    const settledWords = inlineRemoved && quiet ? addedMarks(unit, usfm) : [];
    const settledMarks = (
      settledWords.length > 0
        ? settledWords
        : inlineRemoved && quiet
          ? [{ from: span.from, to: Math.max(span.from + 1, end) }]
          : []
    ).map((mark) => ({ ...mark, class: "cm-diff-settled" }));
    hunks.push({
      key: unit.id,
      kind: hunkKind(unit),
      from: span.from,
      to: Math.max(span.from + 1, end),
      tint:
        quiet || kept
          ? ""
          : changed(unit)
            ? "cm-diff-now"
            : tint(unit, decision, controls?.live === true, true, false),
      marks: [
        ...(unit.status === "modified" && !quiet
          ? withLetters(addedMarks(unit, usfm), inlineRemoved ? lettersOf(unit, usfm) : [])
          : []),
        ...whole,
      ]
        .map((mark) => ({ ...mark, class: markClass }))
        .concat(settledMarks),
      old: unit.baseline === undefined || !changed(unit) ? undefined : () => was(unit),
      label: `${hunkVerb(unit)} ${unitReference(unit)}`,
      ghosts:
        inlineRemoved && unit.status === "modified" && !quiet
          ? lettersInGhosts(ghostsOf(unit, usfm), lettersOf(unit, usfm)).map((ghost) => ({
              ...ghost,
              added: arriving,
              lost: kept,
            }))
          : undefined,
    });
  }
  return { lines: [], marks: [], controls: base.controls, hunks };
};
