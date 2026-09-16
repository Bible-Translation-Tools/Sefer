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
import { EditorState, type Extension, Prec, Transaction } from "@codemirror/state";
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
import { insertFootnote, insertParagraph, insertPoetry, insertVerse } from "./insert";
import { traceFor, type Verdict } from "./instrument";
import type { ChangeRule, TransactionRule } from "./kernel";
import { MARKUP_TOKEN_KINDS } from "./mapping";
import { HOOK, PHASES, RULE_NAMES, type ParserPort, type PhaseRule, type RuleName } from "./phases";
import { renderRangeField, renderWindow } from "./render";
import { scrollGuard } from "./scroll";
import { span } from "./timing";

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
 * Every rule runs inside a trace STAGE (`core/instrument.ts`), so one read of
 * a trace says which doors a keystroke went through, in order, and what each
 * decided. The verdict comes from the rule's own `note` when it made one, and
 * otherwise from what it returned — see `changeVerdict`/`transactionVerdict`.
 * The local span stays as well: the keystroke meter attributes time by phase,
 * and it is armed independently of the trace.
 */

/**
 * What a change filter's return value means. `true` is the ordinary case;
 * `false` vetoes the whole transaction; a list of offsets protects those
 * ranges — which is not itself a refusal (the rest of the change lands), so it
 * reads as `passed` with the ranges as detail.
 */
const changeVerdict = (out: boolean | readonly number[]): [Verdict, string | undefined] =>
  out === true
    ? ["passed", undefined]
    : out === false
      ? ["refused", "vetoed the whole transaction"]
      : ["passed", `guarding ${out.length / 2} range(s)`];

/**
 * What a transaction filter's return value means. The rule got `tr` and either
 * handed it back (passed), returned nothing at all (refused — CodeMirror drops
 * the transaction), or returned something else (rewrote).
 */
const transactionVerdict = (tr: Transaction, out: unknown): [Verdict, string | undefined] =>
  out === tr
    ? ["passed", undefined]
    : Array.isArray(out) && out.length === 0
      ? ["refused", "dropped the transaction"]
      : ["rewrote", undefined];

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
    const isChange = HOOK[r.phase] === "change";
    const entered = (tr: Transaction) => {
      const trace = traceFor(
        tr.startState,
        tr.annotation(Transaction.userEvent) ?? "transaction",
        tr.docChanged,
      );
      const close = trace === null ? null : trace.stage(r.phase, r.name);
      const done = span(`phase:${r.phase}`, r.name);
      try {
        const out = fn(tr);
        if (close !== null) {
          // SAFETY: HOOK decides which hook this rule was registered on, and
          // PHASES only pairs a 'change' phase with a ChangeRule, so `out` is
          // that rule's own return type.
          const [verdict, detail] = isChange
            ? changeVerdict(out as boolean | readonly number[])
            : transactionVerdict(tr, out);
          close(verdict, detail);
        }
        return out;
      } finally {
        done();
      }
    };
    if (isChange) {
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

/**
 * One command invocation as a trace COMMAND frame.
 *
 * The frame is what makes a keystroke readable end to end: the command opens
 * it, the dispatch it makes runs the phase stages nested inside it, and the
 * command's own `note` (moveCaret's from→to, guardedBackspace's plan) becomes
 * the frame's verdict. With no tracer armed this is one facet read and the
 * original command.
 */
const traced =
  <T extends { state: EditorState }>(name: string, run: (target: T) => boolean) =>
  (target: T): boolean => {
    const trace = traceFor(target.state, "key");
    if (trace === null) return run(target);
    const close = trace.command(name);
    let ok = false;
    try {
      ok = run(target);
      return ok;
    } finally {
      close(ok ? "consumed" : "declined");
    }
  };

export function usfmKeys(): readonly KeyBinding[] {
  const move = (right: boolean) =>
    traced("moveCaret", moveCaret(structureAt, right, undefined, PAINT_PORT));
  const extend = (right: boolean) =>
    traced("extendCaret", extendCaret(structureAt, right, undefined, PAINT_PORT));
  const boundary = (end: boolean) =>
    traced("caretLineBoundary", caretLineBoundary(structureAt, end, PAINT_PORT));
  const byWord = (right: boolean) =>
    traced("moveCaretByWord", moveCaretByWord(structureAt, right, PAINT_PORT));
  const backspace = () =>
    traced("guardedBackspace", guardedBackspace(structureAt, planAt, PAINT_PORT));
  const del = () => traced("guardedDelete", guardedDelete(structureAt, planAt, PAINT_PORT));
  return [
    { key: "ArrowLeft", run: move(false) },
    { key: "ArrowRight", run: move(true) },
    { key: "Shift-ArrowLeft", run: extend(false) },
    { key: "Shift-ArrowRight", run: extend(true) },
    { key: "Home", run: boundary(false) },
    { key: "End", run: boundary(true) },
    { key: "Mod-ArrowLeft", run: boundary(false) },
    { key: "Mod-ArrowRight", run: boundary(true) },
    { key: "Alt-ArrowLeft", run: byWord(false) },
    { key: "Alt-ArrowRight", run: byWord(true) },
    { key: "Enter", run: traced("guardedEnter", guardedEnter(structureAt, planAt)) },
    { key: "Backspace", run: backspace() },
    {
      key: "Backspace",
      run: traced("mergeParagraphBackwards", mergeParagraphBackwards(structureAt)),
    },
    { key: "Delete", run: del() },
    { key: "Ctrl-d", run: del() },
    { key: "Ctrl-h", run: backspace() },
    { key: "Mod-Alt-1", run: traced("setBlockMarker", setBlockMarker(structureAt, "q1")) },
    { key: "Mod-Alt-0", run: traced("setBlockMarker", setBlockMarker(structureAt, "p")) },
    // The structured insertions (`core/insert.ts`). Bound here as well as in
    // the shell's command registry: this copy reaches the caret the reader is
    // looking at with no round trip, and the registry's copy is what the
    // palette lists and what fires when focus is outside the editor. They
    // cannot both run — the shell's document listener skips a chord the
    // editor already consumed (`installCommandKeys`).
    { key: "Mod-Shift-v", run: traced("insertVerse", insertVerse(structureAt)) },
    { key: "Mod-Shift-p", run: traced("insertParagraph", insertParagraph(structureAt)) },
    { key: "Mod-Shift-l", run: traced("insertPoetry", insertPoetry(structureAt)) },
    { key: "Mod-Shift-n", run: traced("insertFootnote", insertFootnote()) },
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
    scrollGuard,
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
