// diff.ts
//
// Baseline and Diff (seams §3.12): what changed in a Book since the text Save
// last wrote to disk, and how to put a piece of it back.
//
// Pure and synchronous by design. Diff sits below Save in the DAG: it consumes
// the `Baseline` VALUE that Save produces, never the Save service. That is why
// the parameter type here is the structural `BaselineLike` below rather than an
// import of `src/core/save` — Diff must not point at a module that points at
// FileSystem and Observability.
//
// Diff is line-based (LF lines, the only newline canonical text has). Verse and
// paragraph edits in USFM are line-shaped, hunks the size of a line are what a
// translator can read, and line granularity keeps `revert` a single range
// splice through the one write path.

import { Result } from "effect";

import { Refusal, trustedBy, type Book, type BookId, type Receipt } from "../book/book";
import type { Change, SourceStamp } from "../source/source";

/**
 * The shape of a saved baseline that Diff needs: which book, the stamp of the
 * text that was written, and that text. Deliberately structural — Save's
 * `Baseline` (which also carries `path`, `hash` and `savedAt`) satisfies it
 * without Diff depending on Save.
 */
export interface BaselineLike {
  readonly bookId: BookId;
  readonly stamp: SourceStamp;
  readonly text: string;
}

/**
 * One difference between the baseline text and the working text.
 *
 * `from`/`to` are UTF-16 offsets into the WORKING text (so they can be handed
 * straight to `book.apply`, whose changes are in before-text coordinates);
 * `baselineFrom`/`baselineTo` index the baseline text, for callers that want to
 * show the old side. `stamp` is the working text's stamp: a hunk computed from
 * one revision means nothing against another, so every consumer checks
 * `stale` before acting.
 *
 * A pure insertion has an empty baseline slice; a pure deletion has a
 * zero-width working range at the point the lines were removed from.
 */
export interface TextHunk {
  readonly from: number;
  readonly to: number;
  readonly baselineFrom: number;
  readonly baselineTo: number;
  readonly kind: "insert" | "delete" | "replace";
  readonly working: string;
  readonly baseline: string;
}

/** A `TextHunk` that knows which book it came from and at which revision. */
export interface Hunk extends TextHunk {
  readonly bookId: BookId;
  readonly stamp: SourceStamp;
}

/**
 * Above this many LCS cells (baseline lines × working lines, after common
 * prefix and suffix are trimmed) the table stops being worth building on the
 * interaction path, and the whole differing region becomes one `replace` hunk.
 * A book is a few thousand lines, so a normal edit trims down to a handful of
 * lines and never comes near this; a wholesale rewrite trips it and still gets
 * a correct, if coarse, answer.
 */
const MAX_LCS_CELLS = 4_000_000;

/** A run of unequal lines, in line indices into both texts. */
interface Run {
  wStart: number;
  wEnd: number;
  bStart: number;
  bEnd: number;
}

const splitLines = (text: string): readonly string[] => text.split("\n");

/**
 * Offset of the start of line `index`, where each line is taken to include its
 * trailing newline. `index === lines.length` yields the end of the text, so a
 * half-open line range always maps to a half-open offset range.
 */
const lineOffsets = (lines: readonly string[]): readonly number[] => {
  const offsets: number[] = [0];
  let at = 0;
  for (const line of lines) {
    at += line.length + 1;
    offsets.push(at);
  }
  // The last entry over-counts by the newline the final line does not have.
  offsets[offsets.length - 1] = at - 1;
  return offsets;
};

/**
 * Classic dynamic-programming LCS over lines, with common prefix and suffix
 * trimmed first and a size guard. Chosen over Myers because the guarded table
 * is ~30 lines of obvious code with no diagonal bookkeeping, and at the sizes
 * this runs on (a book, after trimming) it is not the slow part.
 */
const diffRuns = (baseline: readonly string[], working: readonly string[]): readonly Run[] => {
  const shorter = Math.min(baseline.length, working.length);
  let head = 0;
  while (head < shorter && baseline[head] === working[head]) head += 1;
  let tail = 0;
  while (
    tail < shorter - head &&
    baseline[baseline.length - 1 - tail] === working[working.length - 1 - tail]
  )
    tail += 1;

  const b = baseline.slice(head, baseline.length - tail);
  const w = working.slice(head, working.length - tail);
  if (b.length === 0 && w.length === 0) return [];
  if (b.length === 0 || w.length === 0 || b.length * w.length > MAX_LCS_CELLS)
    return [{ wStart: head, wEnd: head + w.length, bStart: head, bEnd: head + b.length }];

  const cols = w.length + 1;
  const table = new Int32Array((b.length + 1) * cols);
  for (let i = b.length - 1; i >= 0; i -= 1)
    for (let j = w.length - 1; j >= 0; j -= 1)
      table[i * cols + j] =
        b[i] === w[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);

  const runs: Run[] = [];
  let i = 0;
  let j = 0;
  while (i < b.length || j < w.length) {
    if (i < b.length && j < w.length && b[i] === w[j]) {
      i += 1;
      j += 1;
      continue;
    }
    const run: Run = { wStart: head + j, wEnd: head + j, bStart: head + i, bEnd: head + i };
    while (i < b.length || j < w.length) {
      if (i < b.length && j < w.length && b[i] === w[j]) break;
      const down = i < b.length ? table[(i + 1) * cols + j] : -1;
      const right = j < w.length ? table[i * cols + j + 1] : -1;
      if (down >= right) {
        i += 1;
        run.bEnd = head + i;
      } else {
        j += 1;
        run.wEnd = head + j;
      }
    }
    runs.push(run);
  }
  return runs;
};

/**
 * The differences between two plain texts, ascending in working-text order and
 * non-overlapping — the whole of the line diff, with no Book and no stamp.
 *
 * `compare` below is this plus a book identity; `src/core/compare` is this
 * between two arbitrary sources, neither of which need be a Book at all.
 * Separating the texts function is what lets a comparison exist before either
 * side has been seated.
 *
 * The equal spans BETWEEN the returned hunks are identical on both sides,
 * which is what makes a merged text buildable by walking one side and
 * substituting the chosen slice at each hunk.
 */
export const diffTexts = (baselineText: string, workingText: string): readonly TextHunk[] => {
  const baselineLines = splitLines(baselineText);
  const workingLines = splitLines(workingText);
  const baselineOffsets = lineOffsets(baselineLines);
  const workingOffsets = lineOffsets(workingLines);

  return diffRuns(baselineLines, workingLines).map((run) => {
    const from = workingOffsets[run.wStart];
    const to = workingOffsets[run.wEnd];
    const baselineFrom = baselineOffsets[run.bStart];
    const baselineTo = baselineOffsets[run.bEnd];
    const working = workingText.slice(from, to);
    const baseline = baselineText.slice(baselineFrom, baselineTo);
    return {
      from,
      to,
      baselineFrom,
      baselineTo,
      kind: working === "" ? "delete" : baseline === "" ? "insert" : "replace",
      working,
      baseline,
    } satisfies TextHunk;
  });
};

/**
 * The differences between `baseline.text` and the book's current text, in
 * ascending working-text order and non-overlapping. Stamped with
 * `book.source().stamp`; empty when the texts are identical.
 *
 * The baseline's own stamp is not checked against the book: a baseline is by
 * definition older than the working text. It is carried on the baseline for
 * Save's own freshness rules, not Diff's.
 */
export const compare = (book: Book, baseline: BaselineLike): readonly Hunk[] => {
  const source = book.source();
  return diffTexts(baseline.text, source.text).map(
    (hunk) => ({ ...hunk, bookId: baseline.bookId, stamp: source.stamp }) satisfies Hunk,
  );
};

/**
 * True when the book has moved on since the hunk was computed — its offsets no
 * longer describe the text they were measured in. Revision alone would do;
 * length is compared too because that is the SourceStamp rule (length never
 * identifies text by itself, but a mismatch is proof of movement).
 */
const stale = (hunk: Hunk, book: Book): boolean => {
  const stamp = book.source().stamp;
  return (
    hunk.bookId !== book.id ||
    stamp.revision !== hunk.stamp.revision ||
    stamp.length !== hunk.stamp.length
  );
};

const refuseRevert = (reason: string, description: string): Refusal =>
  new Refusal({ rule: "diff.revert", reason, description });

const staleRefusal = (): Refusal =>
  refuseRevert("Stale", "the book changed after the hunk was computed");

/**
 * Puts one hunk's baseline text back, as a trusted `revert` through the one
 * write path. Refuses `Stale` rather than splicing at offsets that have moved.
 */
export const revert = (hunk: Hunk, book: Book): Result.Result<Receipt, Refusal> => {
  if (stale(hunk, book)) return Result.fail(staleRefusal());
  return book.apply(
    [{ from: hunk.from, to: hunk.to, insert: hunk.baseline }],
    "revert",
    trustedBy("diff.revert"),
  );
};

/**
 * Reverts every hunk in ONE apply — one history event, so the user's Undo
 * takes the whole "discard my changes" back, not a hunk at a time. The hunks
 * are already in before-text coordinates and non-overlapping (each run is
 * separated from the next by at least one equal line), which is exactly what
 * `book.apply` requires of a change list.
 */
export const revertAll = (hunks: readonly Hunk[], book: Book): Result.Result<Receipt, Refusal> => {
  // An empty list would still count a revision in the Book, so it is refused
  // rather than quietly stamping a no-op edit into history.
  if (hunks.length === 0) return Result.fail(refuseRevert("Empty", "there is nothing to revert"));
  if (hunks.some((hunk) => stale(hunk, book))) return Result.fail(staleRefusal());
  const changes: readonly Change[] = hunks.map((hunk) => ({
    from: hunk.from,
    to: hunk.to,
    insert: hunk.baseline,
  }));
  return book.apply(changes, "revert", trustedBy("diff.revert"));
};
