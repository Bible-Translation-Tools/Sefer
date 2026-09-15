// format.ts
//
// THE FORMAT DOOR: Onion's formatter, as a transaction Sefer can apply.
//
// `onion::format` merges two edit sets — the lint rows flagged `formatter`,
// and the FORM channel that lint never reaches — with a first-writer-wins
// collision rule. Sefer does not reimplement any of that and never will: a
// second formatter in TypeScript would reproduce the first half and silently
// diverge on the second, and "the two formatters disagree about scripture" is
// the worst bug available here.
//
// Since scripture-kitchen v0.1.0 the galley build re-exports it, so this module
// is a binding and a decoder and nothing else (engine-asks item 1, closed).
//
// ## Edits, not a formatted string
//
// `format(text, opts)` exists on the module and returns the whole rewritten
// document. Sefer deliberately uses `formatEdits` instead. The edits go through
// `book.apply` as ONE transaction, which makes the whole normalisation one
// revision and one Undo step; a replaced document would be a single change
// covering every character in the book, which Undo would take back correctly
// and no reviewer could read.
//
// ## Offsets
//
// `formatEdits` answers in UTF-16 ALWAYS — it converts on the way out, on an
// index it builds per call. That is the unit every `Change` and every
// `book.apply` range in Sefer is already in, so nothing here converts and no
// byte offset is ever held. (The overlay doors are the ones with a `utf16`
// flag; see `overlay.ts`.)

import { Result } from "effect";

import { doorMissing, type EngineDoorMissing } from "./diff";

/**
 * The formatter's switches, as a plain object.
 *
 * The wasm `FormatOpts` is a handle that must be freed and whose fields are
 * set one at a time, so callers hand a plain object and this module builds,
 * fills and frees the handle. Every field is optional; what is left out keeps
 * the engine's own `FormatOptions::default`, which is what Sefer's Format
 * command asks for — choosing among a dozen switches is a settings surface
 * nobody has designed.
 *
 * `newline` and the two break switches are numbers on the wire because they
 * are enums the engine spells as small integers; they are named here so a call
 * site reads as the engine's documentation does.
 */
export interface FormatOptions {
  readonly block_marker_own_line?: boolean;
  readonly bridge_empty_verses?: boolean;
  /** 0 keeps a break on a character-marker boundary, 1 joins it into a space. */
  readonly char_marker_breaks?: number;
  readonly collapse_blank_lines?: boolean;
  readonly dedupe_verse_number?: boolean;
  readonly delimiter_single?: boolean;
  readonly designator_ws_single?: boolean;
  readonly marker_ws_at_line_start?: boolean;
  /** 0 = LF, 1 = CRLF. Sefer's canonical text is LF and never asks for 1. */
  readonly newline?: number;
  readonly normalize_newlines?: boolean;
  readonly trim_text_edges?: boolean;
  /** 0 keeps the line break in front of a `\v`, 1 folds it into a space. */
  readonly verse_breaks?: number;
  /** Marker names, no backslash — `["s5"]` deletes every unfoldingWord chunk marker. */
  readonly removeMarkers?: readonly string[];
  /** Lint codes (diagnostics.json indices) whose fixes join the transaction. */
  readonly repairs?: readonly number[];
}

/** One edit of a format transaction, in the vocabulary `book.apply` takes. */
export interface FormatEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/**
 * A whole format transaction: ascending, non-overlapping, UTF-16.
 *
 * `empty` is not the same as "nothing happened" to a caller — it is exactly
 * that, and it is said with a boolean rather than left to `edits.length` so a
 * command can report "already formatted" without re-deriving the fact.
 */
export interface FormatEdits {
  readonly edits: readonly FormatEdit[];
  readonly empty: boolean;
}

/** The scalar switches, in the order the `.d.ts` declares them. */
const SWITCHES = [
  "block_marker_own_line",
  "bridge_empty_verses",
  "char_marker_breaks",
  "collapse_blank_lines",
  "dedupe_verse_number",
  "delimiter_single",
  "designator_ws_single",
  "marker_ws_at_line_start",
  "newline",
  "normalize_newlines",
  "trim_text_edges",
  "verse_breaks",
] as const satisfies readonly (keyof FormatOptions)[];

/**
 * The wasm `FormatOpts` handle, as this module needs to see it. Structural,
 * so the probe below is a `typeof` on a constructor rather than a version
 * number Sefer would have to keep in step with the artifact.
 */
interface OptsHandle {
  free: () => void;
  setRemoveMarkers: (names: string) => void;
  setRepairs: (codes: Uint32Array) => void;
}

/** The `Edits` class the module's format and overlay doors both answer with. */
export interface EditsHandle {
  readonly spans: Uint32Array;
  readonly lens: Uint32Array;
  readonly text: string;
  free: () => void;
}

/** The two free functions this module binds, probed by name on the module. */
interface FormatCapableModule {
  readonly FormatOpts?: new () => OptsHandle;
  readonly formatEdits?: (text: string, opts: OptsHandle) => EditsHandle;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const hasFormat = (module: unknown): module is Required<FormatCapableModule> =>
  isRecord(module) &&
  typeof module.formatEdits === "function" &&
  typeof module.FormatOpts === "function";

/**
 * `Edits` read out and freed.
 *
 * `spans` is `[from, to]` per edit and `lens[i]` slices `text` at the running
 * offset — one concatenated insert blob, so the handle carries one string
 * rather than one per edit. `lens[i] === 0` is a pure deletion, and a span
 * whose `from === to` is a pure insertion; both are ordinary here.
 *
 * Exported because the overlay door answers with the same class.
 */
export const readEdits = (held: EditsHandle): readonly FormatEdit[] => {
  const spans = held.spans;
  const lens = held.lens;
  const text = held.text;
  const out: FormatEdit[] = [];
  let at = 0;
  for (let index = 0; index < lens.length; index += 1) {
    // SAFETY: `spans` carries two words per edit and `lens` one, which the
    // engine's own `Edits` invariant states; the loop is bounded by `lens`.
    const from = spans[index * 2] ?? 0;
    const to = spans[index * 2 + 1] ?? from;
    const length = lens[index] ?? 0;
    out.push({ from, to, insert: text.slice(at, at + length) });
    at += length;
  }
  return out;
};

/**
 * Onion's format transaction for one document, or a refusal naming the door.
 *
 * Takes the wasm MODULE NAMESPACE, like `engineDiff`: these doors are
 * stateless free functions, and `galley.ts` stays the one place the module is
 * held. The `FormatOpts` handle is built, filled, used and freed inside this
 * call — no caller ever holds a wasm handle.
 */
export const engineFormatEdits = (
  module: unknown,
  text: string,
  options?: FormatOptions,
): Result.Result<FormatEdits, EngineDoorMissing> => {
  if (!hasFormat(module)) return Result.fail(doorMissing("formatEdits"));
  const opts = new module.FormatOpts();
  try {
    if (options !== undefined) {
      // SAFETY: every SWITCHES entry is a declared mutable field of
      // `FormatOpts` (see pkg-web/usfm_galley.d.ts) with the same type
      // `FormatOptions` gives it.
      const target = opts as unknown as Record<string, boolean | number>;
      for (const key of SWITCHES) {
        const value = options[key];
        if (value !== undefined) target[key] = value;
      }
      if (options.removeMarkers !== undefined)
        opts.setRemoveMarkers(options.removeMarkers.join(","));
      if (options.repairs !== undefined) opts.setRepairs(Uint32Array.from(options.repairs));
    }
    const held = module.formatEdits(text, opts);
    try {
      const edits = readEdits(held);
      return Result.succeed({ edits, empty: edits.length === 0 });
    } finally {
      held.free();
    }
  } finally {
    opts.free();
  }
};
