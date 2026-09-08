/**
 * The assembled editor: the layers, the keymap, and the two doors composition
 * uses (`usfmEditor`, `usfmEditorHeadless`).
 *
 * Layers are separate because their costs and their requirements differ: the
 * reading layer is state only (it works in Node and in a worker), the rules
 * layer needs the engine, the commands and view layers need a DOM. A window or a
 * test takes the first two and stops.
 */

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, type Extension, Prec, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, drawSelection, keymap, type KeyBinding } from "@codemirror/view";

import { type Analysis, TOKEN_SPELLING_BIT } from "../../core/galley";
import { type Analyze, analyzed, analyzer } from "./analyzer";
import { caretLineBoundary, extendCaret, moveCaret, moveCaretByWord } from "./caret";
import { type ClipRange } from "./clip";
import { guardedBackspace, guardedDelete, mergeParagraphBackwards } from "./deletion";
import { buildStructure } from "./docStructure";
import {
  PAINT_PORT,
  planAt,
  decoField,
  structureAt,
  pickField,
  structureField,
  usfmModeProjection,
} from "./editorState";
import { guardedEnter, setBlockMarker } from "./input";
import type { ChangeRule, TransactionRule } from "./kernel";
import { MARKUP_TOKEN_KINDS } from "./mapping";
import { HOOK, PHASES, RULE_NAMES, type ParserPort, type PhaseRule, type RuleName } from "./phases";
import { renderRangeField, renderWindow } from "./render";
import { span } from "./timing";
import { note } from "./trace";

export type { ClipRange, RuleName };
export { RULE_NAMES };

export interface EditorOptions {
  /**
   * The one parse this state may run. Required: a USFM editor with no engine
   * is a plain text box wearing our class names, and the facet's own guard
   * would throw at the first structure read anyway.
   *
   * Composition passes `galley.memoize()` — one memo per Book.
   */
  readonly analyze: Analyze;
  readonly omit?: readonly RuleName[];
  readonly parser?: ParserPort;
  readonly perLineDirection?: boolean;
}

/** The subset `viewLayer` needs; a satellite composes it with no engine. */
export interface ViewOptions {
  readonly perLineDirection?: boolean;
}

function marksUpInContext(
  doc: string,
  from: number,
  to: number,
  analyze: (t: string) => Analysis,
): boolean {
  if (!doc.slice(from, to).includes("\\")) return false;
  const lo = doc.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const hiRaw = doc.indexOf("\n", to);
  const hi = hiRaw === -1 ? doc.length : hiRaw;
  try {
    let marks = false;
    analyze(doc.slice(lo, hi)).dish.tokens.forEach((kindBits, _markerIdx, tf, tt) => {
      if (tt + lo <= from || tf + lo >= to) return;
      if (MARKUP_TOKEN_KINDS.has(kindBits & ~TOKEN_SPELLING_BIT)) {
        marks = true;
        return false;
      }
      return;
    });
    return marks;
  } catch {
    return false;
  }
}

/**
 * The two questions the admission rules ask the engine, over one analyzer.
 *
 * A function of the analyzer rather than a constant, because there is no
 * engine singleton to close over: each state's rules are installed with that
 * state's analyzer.
 */
export const enginePort = (analyze: Analyze): ParserPort => ({
  marksUp: (d, f, t) => marksUpInContext(d, f, t, (x) => analyzed(analyze, x)),
  chapterCount: (d) => buildStructure(d, analyzed(analyze, d), null).chapters.length,
});

export const readingLayer: Extension = [
  structureField,
  pickField,
  usfmModeProjection,
  renderRangeField,
  decoField,
];

/**
 * Turns the phase list into CodeMirror extensions, in phase order.
 *
 * `changeFilter` and `transactionFilter` are two different hooks: admission
 * runs as a change filter (it can veto ranges before the transaction exists),
 * everything after runs as a transaction filter. CodeMirror runs transaction
 * filters from the LAST registered to the first, so the list is reversed on
 * the way out to make registration order the order rules actually see.
 *
 * Every rule is wrapped once, so a trace says which door a keystroke went
 * through and the meter attributes the time to a phase.
 */
export function install(
  rules: readonly PhaseRule[],
  parser: ParserPort,
  omit: ReadonlySet<string>,
): Extension {
  const change: Extension[] = [];
  const transaction: Extension[] = [];
  for (const r of rules) {
    if (omit.has(r.name)) continue;
    const fn = r.rule(parser);
    const entered = (tr: Transaction) => {
      note(tr.startState, { rule: `phase:${r.name}`, verdict: "passed", detail: r.phase });
      const done = span(`phase:${r.phase}`, r.name);
      try {
        return fn(tr);
      } finally {
        done();
      }
    };
    if (HOOK[r.phase] === "change") {
      // SAFETY: HOOK says this phase is a change filter, and PHASES only ever
      // pairs a 'change' phase with a rule returning a ChangeRule's verdict
      // (boolean or a range list). `entered` returns exactly what `fn` did.
      change.push(EditorState.changeFilter.of(entered as ChangeRule));
    } else {
      // SAFETY: the same, for the transaction hook: a non-'change' phase's
      // rule returns a TransactionSpec or a list of them.
      transaction.push(EditorState.transactionFilter.of(entered as TransactionRule));
    }
  }
  return [...change, ...transaction.reverse()];
}

export function rulesLayer(options: EditorOptions): Extension {
  return install(
    PHASES,
    options.parser ?? enginePort(options.analyze),
    new Set(options.omit ?? []),
  );
}

export function usfmKeys(): readonly KeyBinding[] {
  return [
    { key: "ArrowLeft", run: moveCaret(structureAt, false, undefined, PAINT_PORT) },
    { key: "ArrowRight", run: moveCaret(structureAt, true, undefined, PAINT_PORT) },
    { key: "Shift-ArrowLeft", run: extendCaret(structureAt, false, undefined, PAINT_PORT) },
    { key: "Shift-ArrowRight", run: extendCaret(structureAt, true, undefined, PAINT_PORT) },
    { key: "Home", run: caretLineBoundary(structureAt, false, PAINT_PORT) },
    { key: "End", run: caretLineBoundary(structureAt, true, PAINT_PORT) },
    { key: "Mod-ArrowLeft", run: caretLineBoundary(structureAt, false, PAINT_PORT) },
    { key: "Mod-ArrowRight", run: caretLineBoundary(structureAt, true, PAINT_PORT) },
    { key: "Alt-ArrowLeft", run: moveCaretByWord(structureAt, false, PAINT_PORT) },
    { key: "Alt-ArrowRight", run: moveCaretByWord(structureAt, true, PAINT_PORT) },
    { key: "Enter", run: guardedEnter(structureAt, planAt) },
    { key: "Backspace", run: guardedBackspace(structureAt, planAt, PAINT_PORT) },
    { key: "Backspace", run: mergeParagraphBackwards(structureAt) },
    { key: "Delete", run: guardedDelete(structureAt, planAt, PAINT_PORT) },
    { key: "Ctrl-d", run: guardedDelete(structureAt, planAt, PAINT_PORT) },
    { key: "Ctrl-h", run: guardedBackspace(structureAt, planAt, PAINT_PORT) },
    { key: "Mod-Alt-1", run: setBlockMarker(structureAt, "q1") },
    { key: "Mod-Alt-0", run: setBlockMarker(structureAt, "p") },
  ];
}

export const commandsLayer: Extension = [
  Prec.high(keymap.of([...usfmKeys()])),
  keymap.of([...defaultKeymap, ...historyKeymap]),
];

export function viewLayer(options: ViewOptions = {}): Extension {
  return [
    drawSelection(),
    EditorView.lineWrapping,
    ...(options.perLineDirection === false ? [] : [EditorView.perLineTextDirection.of(true)]),
    renderWindow,
    EditorView.atomicRanges.of((v) => v.state.field(decoField, false)?.atomic ?? Decoration.none),
    EditorView.bidiIsolatedRanges.of(
      (v) => v.state.field(decoField, false)?.isolates ?? Decoration.none,
    ),
  ];
}

export function usfmEditor(options: EditorOptions): Extension[] {
  return [
    analyzer.of(options.analyze),
    readingLayer,
    rulesLayer(options),
    commandsLayer,
    viewLayer(options),
  ];
}

/**
 * Everything but the DOM: the state, the rules, no view plugins and no keymap.
 * This is what a Book's canonical state is built from — it must work with no
 * `EditorView` at all, in Node and in a worker.
 */
export function usfmEditorHeadless(options: EditorOptions): Extension[] {
  return [analyzer.of(options.analyze), readingLayer, rulesLayer(options)];
}

export const historyLayer: Extension = history();
