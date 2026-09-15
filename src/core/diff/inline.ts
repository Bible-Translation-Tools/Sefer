// inline.ts
//
// The diff INSIDE a unit: which WORDS of one side became which words of the
// other.
//
// `diff.ts` is line-based and `skeleton.ts` is verse-based, which are the right
// granularities for putting a change back (a revert is one range splice) and
// the wrong one for reading a change. A reviewer looking at
//
//     − And he saw a great multitude, and was moved with compassion
//     + And he saw a great crowd, and was moved with compassion
//
// has to find the one word themselves. This module answers "where exactly",
// and the renderer marks those characters more strongly inside the text it was
// already showing. Nothing here decides anything — a revert is still the whole
// unit, because the offsets a revert needs are the alignment's.
//
// ## Words, not characters
//
// This was a CHARACTER LCS until the review screen was unified. Characters are
// the wrong unit for scripture and were visibly so: changing "multitude" to
// "crowd" marked `m`, `ulti`, `ude` and `c`, `r`, `w` as separate scraps
// because the two words share letters in order, and a reader then had to
// reassemble the word from the marks. Onion's own intra-unit diff is
// word-grained for the same reason (`onion::diff::TextDiffMode::Words`, UAX-29
// boundaries), so moving to words also means the interim marks and the
// engine's marks will say the same kind of thing when the door lands
// (`src/core/galley/diff.ts`, `DIFF_DOOR`).
//
// A token here is a run of letters and digits, a run of whitespace, or one
// other character (punctuation, a USFM backslash, a marker's own `\` and `*`).
// Whitespace is its own token rather than attached to a word, which is what
// keeps the concatenation of every segment EXACTLY the input — a renderer
// splits the segments back onto lines, and a tokenizer that swallowed a
// newline would silently join two lines of scripture.
//
// LCS rather than Myers, for the same reason `diff.ts` chose it: the guarded
// table is twenty lines of obvious code, the inputs are one verse, and it is
// not the slow part. The guard matters more than the algorithm — a whole-book
// unit must never build a table of a million cells on the interaction path, so
// past the cap the answer is the honest coarse one: all of the left removed,
// all of the right added.

/** `same` appears on both sides; `remove` only on the left, `add` only on the right. */
export type InlineKind = "same" | "remove" | "add";

export interface InlineSegment {
  readonly kind: InlineKind;
  readonly text: string;
}

/**
 * Above this many LCS cells the table stops being worth building, and above
 * `MAX_CHARS` on either side we do not even tokenize. A verse is a couple of
 * hundred characters; a pasted chapter is not something anyone reads word by
 * word.
 */
const MAX_CELLS = 1_000_000;
const MAX_CHARS = 40_000;

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
 * A word character: a letter, a digit, or a mark that belongs to the letter
 * before it. `\p{M}` is what keeps a combining diacritic — which plenty of the
 * scripts Sefer serves use — from being torn off the base it modifies and
 * marked as a change of its own.
 */
const WORD = /[\p{L}\p{N}\p{M}]/u;
const SPACE = /\s/u;

/**
 * The string as tokens, in order, whose concatenation is the string.
 *
 * Exported for the one caller that needs to know how many there will be before
 * deciding whether to ask (`skeleton.ts`'s cap), and because "what is a word
 * here" is a decision worth being able to read rather than infer.
 */
export const tokenize = (text: string): readonly string[] => {
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    const char = text[at] ?? "";
    const run = WORD.test(char) ? WORD : SPACE.test(char) ? SPACE : undefined;
    if (run === undefined) {
      // Punctuation and markup characters are one token each: `,` becoming `;`
      // is one small change, and a run of them is rarely one idea.
      out.push(char);
      at += 1;
      continue;
    }
    let end = at + 1;
    while (end < text.length && run.test(text[end] ?? "")) end += 1;
    out.push(text.slice(at, end));
    at = end;
  }
  return out;
};

/**
 * The two strings as one ordered run of segments: walk it and keep everything
 * but `add` for the left column, everything but `remove` for the right.
 *
 * Identical strings give one `same` segment, which is how a caller tells "no
 * intra-unit change" from "every word changed" without a second comparison.
 */
export const inlineDiff = (before: string, after: string): readonly InlineSegment[] => {
  if (before === after) return before === "" ? [] : [{ kind: "same", text: before }];
  if (before === "") return [{ kind: "add", text: after }];
  if (after === "") return [{ kind: "remove", text: before }];
  if (before.length > MAX_CHARS || after.length > MAX_CHARS) return wholesale(before, after);

  const beforeTokens = tokenize(before);
  const afterTokens = tokenize(after);

  // Common prefix and suffix first: an edit to one word in a verse leaves both
  // ends identical, and trimming them is what keeps the table small.
  const shorter = Math.min(beforeTokens.length, afterTokens.length);
  let head = 0;
  while (head < shorter && beforeTokens[head] === afterTokens[head]) head += 1;
  let tail = 0;
  while (
    tail < shorter - head &&
    beforeTokens[beforeTokens.length - 1 - tail] === afterTokens[afterTokens.length - 1 - tail]
  )
    tail += 1;

  const prefix = beforeTokens.slice(0, head).join("");
  const suffix = tail === 0 ? "" : beforeTokens.slice(beforeTokens.length - tail).join("");
  const b = beforeTokens.slice(head, beforeTokens.length - tail);
  const a = afterTokens.slice(head, afterTokens.length - tail);

  if (b.length * a.length > MAX_CELLS)
    return coalesce([
      { kind: "same", text: prefix },
      { kind: "remove", text: b.join("") },
      { kind: "add", text: a.join("") },
      { kind: "same", text: suffix },
    ]);

  const cols = a.length + 1;
  const table = new Int32Array((b.length + 1) * cols);
  for (let i = b.length - 1; i >= 0; i -= 1)
    for (let j = a.length - 1; j >= 0; j -= 1)
      table[i * cols + j] =
        b[i] === a[j]
          ? (table[(i + 1) * cols + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * cols + j] ?? 0, table[i * cols + j + 1] ?? 0);

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
    const down = i < b.length ? (table[(i + 1) * cols + j] ?? 0) : -1;
    const right = j < a.length ? (table[i * cols + j + 1] ?? 0) : -1;
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
