import { history } from "@codemirror/commands";
import { EditorState, type Extension, Transaction } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, drawSelection } from "@codemirror/view";

import { type Analyze, analyzed, analyzer } from "./analyzer";
import { clipboardHandlers } from "./clipboard";
import { buildStructure } from "./docStructure";
import { decoField, pickField, structureField, usfmModeProjection } from "./editorState";
import { traceFor, type TraceVerdict } from "./instrument";
import type { ChangeRule, TransactionRule } from "./kernel";
import { commandsLayer } from "./keymaps";
import { HOOK, PHASES, type ParserPort, type PhaseRule, type RuleName } from "./phases";
import { renderRangeField, renderWindow } from "./render";
import { scrollGuard } from "./scroll";
import { span } from "./timing";

export type { RuleName };

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
  /**
   * Copy and cut write plain text, HTML and widened USFM (`core/clipboard.ts`).
   * On by default; `false` leaves CodeMirror's own copy, the raw selection.
   */
  readonly clipboard?: boolean;
}

/**
 * A marker as the lexer opens one: a backslash and a name (`\\v`, `\\+add`, `\\qt-s`), or a
 * backslash and `*` (`\\*`, a milestone's terminator). A closer (`\\add*`) is the first form.
 */
const MARKER = /\\(?:\+?[A-Za-z][\w-]*|\*)/g;

/**
 * Does `[from, to)` of `doc` hold, or reach into, a marker? Read off the text
 * rather than parsed: parsing the slice with the book's own analyzer
 * registered the slice as the book in the engine (`galley.memoize(id)` calls
 * `update(id, text)`) until the next parse put the book back. A marker that
 * starts before `from` and runs into the range counts, as an overlapping
 * token did.
 */
function marksUpInContext(doc: string, from: number, to: number): boolean {
  if (!doc.slice(from, to).includes("\\")) return false;
  const lo = doc.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  for (const match of doc.slice(lo, to).matchAll(MARKER))
    if (lo + match.index + match[0].length > from) return true;
  return false;
}

const enginePort = (analyze: Analyze): ParserPort => ({
  marksUp: marksUpInContext,
  chapterCount: (d) => buildStructure(d, analyzed(analyze, d), null).chapters.length,
});

export const readingLayer: Extension = [
  structureField,
  pickField,
  usfmModeProjection,
  renderRangeField,
  decoField,
];

function changeVerdict(out: boolean | readonly number[]): [TraceVerdict, string | undefined] {
  if (out === true) return ["passed", undefined];
  if (out === false) return ["refused", "vetoed the whole transaction"];
  return ["passed", `guarding ${out.length / 2} range(s)`];
}

function transactionVerdict(tr: Transaction, out: unknown): [TraceVerdict, string | undefined] {
  if (out === tr) return ["passed", undefined];
  if (Array.isArray(out) && out.length === 0) return ["refused", "dropped the transaction"];
  return ["rewrote", undefined];
}

function install(
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
          // SAFETY: HOOK decides which hook this rule was registered on, and PHASES only pairs a 'change' phase with a ChangeRule, so `out` is that rule's own return type.
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
      // SAFETY: HOOK says this phase is a change filter, and PHASES only ever pairs a 'change' phase with a rule returning a ChangeRule's verdict (boolean or a range list). `entered` returns exactly what `fn` did.
      change.push(EditorState.changeFilter.of(entered as ChangeRule));
    } else {
      // SAFETY: the same, for the transaction hook: a non-'change' phase's rule returns a TransactionSpec or a list of them.
      transaction.push(EditorState.transactionFilter.of(entered as TransactionRule));
    }
  }
  return [...change, ...transaction.reverse()];
}

function rulesLayer(options: EditorOptions): Extension {
  return install(
    PHASES,
    options.parser ?? enginePort(options.analyze),
    new Set(options.omit ?? []),
  );
}

/**
 * The caret moves only for a press on the text. A press in the editor but
 * off its lines — the margins either side of the column, the room under the
 * last line — lets go of the editor instead of moving the caret to the
 * nearest text; so does a press on the page outside it, unless it lands on a
 * control (a toolbar button keeps its own say over focus) — where the
 * browser, left alone, puts the caret back in the nearest editable text. Listened for on
 * the whole document, capturing, because the editor only hears presses on its
 * content.
 */
const pressesOutsideTextLetGo = ViewPlugin.define((view) => {
  const doc = view.dom.ownerDocument;
  const onDown = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target === null) return;
    const onText =
      view.contentDOM.contains(target) && target.closest(".cm-line, .cm-widgetBuffer") !== null;
    // Block widgets (a chapter's notes) and an open note answer their own presses.
    const own = ".cm-tooltip, .cm-panels, .cm-gutters, .cm-block-host, .usfm-note-pop";
    if (onText || target.closest(own) !== null) return;
    if (view.dom.contains(target)) {
      if (target === view.scrollDOM && event.offsetX >= view.scrollDOM.clientWidth) return; // the scrollbar
      event.preventDefault();
      event.stopPropagation();
      view.contentDOM.blur();
      return;
    }
    if (!view.hasFocus) return;
    if (target.closest("button, a, input, select, textarea, [role], [tabindex], [contenteditable]"))
      return;
    // Bare background (no words of its own, not another editor): the browser
    // would put the caret in the nearest editable text — this editor — so the
    // press is kept from doing anything but letting go.
    const words = [...target.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
    );
    if (!words && target.closest(".cm-editor") === null) event.preventDefault();
    view.contentDOM.blur();
  };
  doc.addEventListener("mousedown", onDown, true);
  return { destroy: () => doc.removeEventListener("mousedown", onDown, true) };
});

export function viewLayer(options: ViewOptions = {}): Extension {
  return [
    drawSelection(),
    EditorView.lineWrapping,
    ...(options.perLineDirection === false ? [] : [EditorView.perLineTextDirection.of(true)]),
    ...(options.clipboard === false ? [] : [clipboardHandlers]),
    renderWindow,
    scrollGuard,
    pressesOutsideTextLetGo,
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

/**
 * What the Book judges a SURFACE's edit with (`book.ts`, `applyFrom`): the
 * engine, the structure and the phases — the very rules `usfmEditorHeadless`
 * installs, and nothing of the reading layer. The surface's own projection,
 * mode and range are added beside it as data; the rules are the Book's.
 *
 * Not the reading layer, because the judging state is built per edit and
 * thrown away: `decoField` would decorate the whole book for a state nobody
 * draws, and `pickField` would bring the CANONICAL editor's chapter clip into
 * a judgement about a surface that has its own range.
 */
export function judgeLayer(options: EditorOptions): Extension[] {
  return [analyzer.of(options.analyze), structureField, rulesLayer(options)];
}

export const historyLayer: Extension = history();
