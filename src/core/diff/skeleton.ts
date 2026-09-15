// skeleton.ts
//
// THE INTERIM DIFF. One shape for the review screen, built by Sefer's own
// verse alignment until the engine's door opens.
//
// `src/core/galley/diff.ts` holds the types and the door. Onion's
// decision-unit differ is the thing Sefer actually wants — it lexes each side,
// cuts it at its own table-of-contents anchors, pairs the blocks by a
// deliberately loose key and reports coalesced bridges, duplicate contexts and
// pure relabels — and `galley/src/wasm.rs` does not re-export it yet
// (`DIFF_DOOR`). This module fills the gap with what Sefer already had:
// `spans.ts` asks the engine where the verses are, `verses.ts` aligns the two
// sides by verse reference, and the rows become `DecisionUnit`s of exactly the
// same shape.
//
// Everything a caller reads comes back either way. What is HONESTLY different
// is recorded on the value rather than left to be inferred:
//
//   `DiffSkeleton.engine`  false here, true from the door. The screen shows it,
//                          because a reviewer deciding what to keep is entitled
//                          to know whether a USFM parser or a verse-key walk
//                          produced the alignment.
//
// And what the interim cannot say at all, stated plainly so nobody builds on
// an absence:
//
//   * `kind` is never `coalesced` — a bridge against its members is one
//     decision to the engine and two unmatched rows here, because the
//     alignment key includes the range end.
//   * `status` is never `moved` — the verse-order walk reports a moved verse as
//     a removal plus an addition, which is true but coarser.
//   * `displaced`, `relabeled`, `isDup`, `coveredBy` are always their empty
//     value. They are narration about pairings this aligner does not make.
//   * `slots` is empty. The interleave is the engine's merge machinery; the
//     interim merge walks the units instead (see `mergeWithDecisions`).
//
// What it DOES carry, because the screen is built on it: the addresses, the
// spans into each side's own text, whitespace-only changes, and — via the
// engine's projection rather than a second parser — `isUsfmStructureChange`,
// the "markup only" badge.

import { project } from "../excerpts/excerpts";
import type { Analysis, GalleyService } from "../galley";
import type { Addr, DecisionMap, DecisionUnit, DiffSkeleton, MergeSide } from "../galley/diff";
import { verseSpans } from "./spans";
import { alignVerses, type VerseRow, type VerseSpan } from "./verses";

/** The sid grammar the engine renders, so `parseAddr` reads ours the same way. */
const sidOf = (book: string, span: { chapter: number; verse: number; lastVerse: number }): string =>
  `${book === "" ? "###" : book} ${span.chapter}:${span.verse}${
    span.lastVerse > span.verse ? `-${span.lastVerse}` : ""
  }`;

const addrOf = (book: string, row: VerseRow, lastVerse: number): Addr => ({
  book,
  chapter: row.chapter,
  first: verseOf(row),
  last: lastVerse,
  cdup: 0,
  vdup: 0,
  kind: verseOf(row) > 0 ? "verse" : row.chapter === 0 ? "frontMatter" : "chapterOpen",
  sid: sidOf(book, { chapter: row.chapter, verse: verseOf(row), lastVerse }),
});

/** `alignVerses` keeps the reference as a string; the key carries the numbers. */
const verseOf = (row: VerseRow): number => Number(row.key.split(":")[1] ?? 0);
const lastOf = (row: VerseRow): number => Number(row.key.split(":")[2] ?? 0);

const STATUS = {
  same: "unchanged",
  changed: "modified",
  added: "added",
  removed: "deleted",
} as const;

const KIND = {
  same: "shared",
  changed: "shared",
  added: "added",
  removed: "deleted",
} as const;

const squeeze = (text: string): string => text.replace(/\s+/gu, " ").trim();

/**
 * Two aligned texts as decision units.
 *
 * Pure, synchronous and engine-free: the spans arrive already extracted, the
 * way `verses.ts` beside it takes them, so this half stays testable with two
 * strings and two arrays.
 *
 * Unit ids are the sid, made unique with the engine's own `@N` suffix when two
 * rows render the same address — which happens for a repeated verse number, and
 * is exactly the case the engine's uniquifier exists for. Nothing may parse the
 * id; the ADDRESS is what a screen reads.
 */
export const interimSkeleton = (
  book: string,
  baselineText: string,
  baselineSpans: readonly VerseSpan[],
  currentText: string,
  currentSpans: readonly VerseSpan[],
): DiffSkeleton => {
  const rows = alignVerses(baselineText, baselineSpans, currentText, currentSpans);
  const seen = new Map<string, number>();
  const units: DecisionUnit[] = rows.map((row) => {
    const last = lastOf(row);
    const addr = addrOf(book, row, last);
    const taken = seen.get(addr.sid) ?? 0;
    seen.set(addr.sid, taken + 1);
    const id = taken === 0 ? addr.sid : `${addr.sid}@${taken}`;
    const onBaseline = row.kind !== "added";
    const onCurrent = row.kind !== "removed";
    return {
      id,
      kind: KIND[row.kind],
      status: STATUS[row.kind],
      baselineAddr: onBaseline ? addr : undefined,
      currentAddr: onCurrent ? addr : undefined,
      baseline: onBaseline ? { from: row.baselineFrom, to: row.baselineTo } : undefined,
      current: onCurrent ? { from: row.from, to: row.to } : undefined,
      displaced: false,
      relabeled: false,
      baselineCount: onBaseline ? 1 : 0,
      currentCount: onCurrent ? 1 : 0,
      isDup: false,
      coveredBy: undefined,
      isWhitespaceChange: row.kind === "changed" && squeeze(row.baseline) === squeeze(row.working),
      // Filled in by `decorate` below, which is the half that can project.
      isUsfmStructureChange: false,
      text: undefined,
    };
  });

  return {
    units,
    slots: [],
    baselineLen: baselineText.length,
    currentLen: currentText.length,
    engine: false,
  };
};

/**
 * "Markup only", answered by the engine's own projection rather than by a
 * second opinion about what USFM means.
 *
 * `core/excerpts`' `project` is the reading: text tokens, note bodies dropped,
 * whitespace collapsed. Two sides whose readings are the same string and whose
 * bytes are not differ in MARKUP and nothing else — `\p` became `\m`, a word
 * gained a `\add`, a footnote moved. That is a real and common kind of change
 * and it is one a reviewer wants to be told about rather than made to spot, so
 * it earns a badge instead of a paragraph of tinted text.
 *
 * Onion computes the same fact as `is_usfm_structure_change` from its own
 * reader-text mask, which is why the field is the engine's and not ours.
 */
const decorate = (
  skeleton: DiffSkeleton,
  baseline: Analysis | undefined,
  current: Analysis | undefined,
): DiffSkeleton => {
  if (baseline === undefined || current === undefined) return skeleton;
  const readingOf = (analysis: Analysis, range: { from: number; to: number } | undefined): string =>
    range === undefined ? "" : squeeze(project(analysis, range.from, range.to).text);
  return {
    ...skeleton,
    units: skeleton.units.map((unit) => {
      if (unit.status !== "modified" || unit.isWhitespaceChange) return unit;
      const left = readingOf(baseline, unit.baseline);
      const right = readingOf(current, unit.current);
      return left === right ? { ...unit, isUsfmStructureChange: true } : unit;
    }),
  };
};

/**
 * The last few skeletons, by the pair of texts they came from.
 *
 * The review screen re-derives its units whenever the shell ticks, and a tick
 * costs one alignment plus one projection per changed unit without this. Keyed
 * on the texts themselves, so there is nothing to invalidate.
 */
const CACHE_LIMIT = 4;
const cache = new Map<string, DiffSkeleton>();

const remember = (key: string, skeleton: DiffSkeleton): DiffSkeleton => {
  cache.set(key, skeleton);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done === true) break;
    cache.delete(oldest.value);
  }
  return skeleton;
};

const analyzed = (galley: GalleyService, text: string): Analysis | undefined => {
  try {
    return galley.analyze(text);
  } catch {
    // A text the engine will not parse still has to be reviewable: the caller
    // falls back to a whole-document unit and the badge is simply not offered.
    return undefined;
  }
};

/**
 * THE ONE DOOR the screen calls. Prefers the engine; falls back to the interim.
 *
 * The preference is not a guess — `Galley.diff` refuses by name when the
 * artifact has no diff export, and the refusal is the signal. So the day
 * `galley/src/wasm.rs` re-exports it, every caller of this function starts
 * reading Onion's alignment with no other change anywhere, and
 * `DiffSkeleton.engine` flips to true on the screen that shows it.
 *
 * `book` is the three-letter code the sids are rendered with. It is passed
 * rather than read from the text because Sefer's `BookId` is already canonical
 * and re-deriving it from a `\id` line would be a second opinion about what a
 * book is called.
 */
export const diffSkeleton = (
  galley: GalleyService,
  book: string,
  baselineText: string,
  currentText: string,
): DiffSkeleton => {
  const key = `${book} ${baselineText} ${currentText}`;
  const held = cache.get(key);
  if (held !== undefined) return held;

  const engine = galley.diff(baselineText, currentText);
  if (engine._tag === "Success") return remember(key, engine.success);

  const baseline = analyzed(galley, baselineText);
  const current = analyzed(galley, currentText);
  const skeleton = interimSkeleton(
    book,
    baselineText,
    verseSpans(galley, baselineText),
    currentText,
    verseSpans(galley, currentText),
  );
  return remember(key, decorate(skeleton, baseline, current));
};

/**
 * One book's text under a decision map.
 *
 * The engine's merge walks the interleave, which is what makes a moved or
 * coalesced unit land where it belongs. The interim walks the UNITS in the
 * current side's reading order and emits the chosen side of each — which is
 * exactly right for the ordinary case (an all-`current` map reproduces the
 * current text, an all-`baseline` map reproduces the baseline) and is coarser
 * for a verse that moved, which the interim reports as a removal plus an
 * addition anyway.
 *
 * `fallback` is what an UNDECIDED unit takes. It is required, because "what
 * happens to the units nobody chose" is the whole safety question of a merge
 * and a default here would be Sefer answering it quietly for the caller.
 */
export const mergeWithDecisions = (
  galley: GalleyService,
  skeleton: DiffSkeleton,
  baselineText: string,
  currentText: string,
  decisions: DecisionMap,
  fallback: MergeSide,
): string => {
  if (skeleton.engine) {
    const merged = galley.merge(baselineText, currentText, decisions, fallback);
    if (merged._tag === "Success") return merged.success;
  }
  let out = "";
  for (const unit of skeleton.units) {
    const side = decisions.get(unit.id) ?? fallback;
    const range = side === "baseline" ? unit.baseline : unit.current;
    if (range === undefined) continue;
    out += (side === "baseline" ? baselineText : currentText).slice(range.from, range.to);
  }
  return out;
};
