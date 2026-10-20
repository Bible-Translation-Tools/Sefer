import { Result } from "effect";

import { doorMissing, type EngineDoorMissing } from "./diff";

export interface FormatOptions {
  readonly block_marker_own_line?: boolean;
  readonly bridge_empty_verses?: boolean;
  readonly char_marker_breaks?: number;
  readonly collapse_blank_lines?: boolean;
  readonly dedupe_verse_number?: boolean;
  readonly delimiter_single?: boolean;
  readonly designator_ws_single?: boolean;
  readonly marker_ws_at_line_start?: boolean;
  readonly newline?: number;
  readonly normalize_newlines?: boolean;
  readonly trim_text_edges?: boolean;
  readonly verse_breaks?: number;
  readonly removeMarkers?: readonly string[];
  readonly repairs?: readonly number[];
}

export interface FormatEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface FormatEdits {
  readonly edits: readonly FormatEdit[];
  readonly empty: boolean;
}

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

interface OptsHandle {
  free: () => void;
  setRemoveMarkers: (names: string) => void;
  setRepairs: (codes: Uint32Array) => void;
}

export interface EditsHandle {
  readonly spans: Uint32Array;
  readonly lens: Uint32Array;
  readonly text: string;
  free: () => void;
}

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

export const readEdits = (held: EditsHandle): readonly FormatEdit[] => {
  const spans = held.spans;
  const lens = held.lens;
  const text = held.text;
  const out: FormatEdit[] = [];
  let at = 0;
  for (let index = 0; index < lens.length; index += 1) {
    // SAFETY: `spans` carries two words per edit and `lens` one, which the engine's own `Edits` invariant states; the loop is bounded by `lens`.
    const from = spans[index * 2] ?? 0;
    const to = spans[index * 2 + 1] ?? from;
    const length = lens[index] ?? 0;
    out.push({ from, to, insert: text.slice(at, at + length) });
    at += length;
  }
  return out;
};

export const engineFormatEdits = (
  module: unknown,
  text: string,
  options?: FormatOptions,
): Result.Result<FormatEdits, EngineDoorMissing> => {
  if (!hasFormat(module)) return Result.fail(doorMissing("formatEdits"));
  const opts = new module.FormatOpts();
  try {
    if (options !== undefined) {
      // SAFETY: every SWITCHES entry is a declared mutable field of `FormatOpts` (see pkg-web/usfm_galley.d.ts) with the same type `FormatOptions` gives it.
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
