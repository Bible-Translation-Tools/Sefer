// inline.ts
//
// The diff INSIDE a hunk: which characters of one line became which characters
// of the other.
//
// `diff.ts` is line-based, which is the right granularity for putting a change
// back (a revert is one range splice) and the wrong one for reading a change.
// A reviewer looking at
//
//     − And he saw a great multitude, and was moved with compassion
//     + And he saw a great crowd, and was moved with compassion
//
// has to find the one word themselves. This module answers "where exactly",
// and the renderer marks those characters more strongly inside the line it was
// already showing. Nothing here decides anything — a revert is still the whole
// hunk, because the offsets a revert needs are the line diff's.
//
// The engine's own readers were checked first (`vendor/galley/*.ts`): the onion
// reader exposes a tree, tokens, diagnostics and a table of contents, and the
// sous reader a findings snapshot and a pattern table. Neither carries an
// alignment or a diff of any kind, so this is ours to compute.
//
// Character LCS rather than Myers, for the same reason `diff.ts` chose it: the
// guarded table is twenty lines of obvious code, the inputs are one line of
// scripture, and it is not the slow part. The guard matters more than the
// algorithm — a whole-book `replace` hunk must never build a table of a
// million cells on the interaction path, so past the cap the answer is the
// honest coarse one: all of the left removed, all of the right added.

/** `same` appears on both sides; `remove` only on the left, `add` only on the right. */
export type InlineKind = "same" | "remove" | "add";

export interface InlineSegment {
  readonly kind: InlineKind;
  readonly text: string;
}

/**
 * Above this many LCS cells the table stops being worth building, and above
 * `MAX_CHARS` on either side we do not even measure. A verse is a couple of
 * hundred characters; a pasted chapter is not something anyone reads character
 * by character.
 */
const MAX_CELLS = 1_000_000;
const MAX_CHARS = 4_000;

const coalesce = (segments: readonly InlineSegment[]): readonly InlineSegment[] => {
  const out: InlineSegment[] = [];
  for (const segment of segments) {
    if (segment.text === "") continue;
    const last = out.at(-1);
    if (last !== undefined && last.kind === segment.kind) {
      out[out.length - 1] = { kind: last.kind, text: last.text + segment.text };
      continue;
    }
    out.push(segment);
  }
  return out;
};

const wholesale = (before: string, after: string): readonly InlineSegment[] =>
  coalesce([
    { kind: "remove", text: before },
    { kind: "add", text: after },
  ]);

/**
 * The two strings as one ordered run of segments: walk it and keep everything
 * but `add` for the left column, everything but `remove` for the right.
 *
 * Identical strings give one `same` segment, which is how a caller tells "no
 * intra-line change" from "every character changed" without a second
 * comparison.
 */
export const inlineDiff = (before: string, after: string): readonly InlineSegment[] => {
  if (before === after) return before === "" ? [] : [{ kind: "same", text: before }];
  if (before === "") return [{ kind: "add", text: after }];
  if (after === "") return [{ kind: "remove", text: before }];
  if (before.length > MAX_CHARS || after.length > MAX_CHARS) return wholesale(before, after);

  // Common prefix and suffix first: an edit to one word in a verse leaves both
  // ends identical, and trimming them is what keeps the table small.
  const shorter = Math.min(before.length, after.length);
  let head = 0;
  while (head < shorter && before[head] === after[head]) head += 1;
  let tail = 0;
  while (
    tail < shorter - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail += 1;

  const prefix = before.slice(0, head);
  const suffix = tail === 0 ? "" : before.slice(before.length - tail);
  const b = before.slice(head, before.length - tail);
  const a = after.slice(head, after.length - tail);

  if (b.length * a.length > MAX_CELLS)
    return coalesce([
      { kind: "same", text: prefix },
      { kind: "remove", text: b },
      { kind: "add", text: a },
      { kind: "same", text: suffix },
    ]);

  const cols = a.length + 1;
  const table = new Int32Array((b.length + 1) * cols);
  for (let i = b.length - 1; i >= 0; i -= 1)
    for (let j = a.length - 1; j >= 0; j -= 1)
      table[i * cols + j] =
        b[i] === a[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);

  const middle: InlineSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < b.length || j < a.length) {
    if (i < b.length && j < a.length && b[i] === a[j]) {
      middle.push({ kind: "same", text: b[i] ?? "" });
      i += 1;
      j += 1;
      continue;
    }
    const down = i < b.length ? table[(i + 1) * cols + j] : -1;
    const right = j < a.length ? table[i * cols + j + 1] : -1;
    if (down >= right) {
      middle.push({ kind: "remove", text: b[i] ?? "" });
      i += 1;
    } else {
      middle.push({ kind: "add", text: a[j] ?? "" });
      j += 1;
    }
  }

  return coalesce([{ kind: "same", text: prefix }, ...middle, { kind: "same", text: suffix }]);
};

/** The segments one column shows: the left drops `add`, the right drops `remove`. */
export const sideOf = (
  segments: readonly InlineSegment[],
  side: "before" | "after",
): readonly InlineSegment[] =>
  segments.filter((segment) => segment.kind !== (side === "before" ? "add" : "remove"));

/** True when the two strings differ by more than nothing at all. */
export const hasInlineChange = (segments: readonly InlineSegment[]): boolean =>
  segments.some((segment) => segment.kind !== "same");
