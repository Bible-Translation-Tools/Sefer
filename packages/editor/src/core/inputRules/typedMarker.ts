import {
  EditorSelection,
  type EditorState,
  type Extension,
  Prec,
  type StateCommand,
  StateEffect,
  StateField,
  type Transaction,
} from "@codemirror/state";
import { type Command, Decoration, EditorView, WidgetType } from "@codemirror/view";
import { Category, MARKERS, MarkerKind } from "@wycliffeassociates/sefer-text/engine/analysis";

import { planAt, structureAt } from "../editorState";
import { guardedEnter, setBlockMarker } from "../guards/input";
import { isVisual, trusted } from "../kernel";
import type { DocStructure } from "../model/docStructure";
import { lineIndexAt } from "../model/docStructure";
import { assignmentAt } from "../model/registry";
import { dropHeldRun, heldRunBehaviour, holdRun } from "./heldRun";

/**
 * USFM typed straight into Refine. A backslash starts a marker being typed: it
 * shows where it will go, in the USFM colours, and is not in the text yet.
 * Space or Enter (`typedMarker.accept`) writes it when it is a marker Refine can take:
 *
 * - `\v 4` — a verse, numbered as typed;
 * - a paragraph, poetry or heading marker (`\p`, `\q2`, `\s1`) — Enter at the
 *   caret, then the new line given that marker, as one Undo step. Not the
 *   book's header or introduction (`\h`, `\toc1`, `\mt`, `\ip`), which have
 *   no place in a chapter.
 *
 * - a character marker of running text (`\nd`, `\wj`, `\add`, `\bd`) — its
 *   empty pair, the caret between the halves, so what is typed next is in
 *   it (`heldRun.ts` holds the pair, and takes it out again if the caret
 *   leaves it empty). Inside another run it is written nested (`\+nd`).
 *
 * With words selected, `\` keeps the selection and a character marker wraps
 * it, as one Undo step; a selection across a verse number, a line or the edge
 * of another run cannot be wrapped. Anything else (`\c`, a note, a marker of
 * notes, lists or tables, a paragraph marker over a selection, a misspelling)
 * stays on screen marked wrong until Backspace or Escape takes it back. Each marker written carries
 * `typedMarker`, which the mount hands its host (`onTypedUsfm`), so it can say
 * USFM mode is there for someone who types it.
 */

interface Composing {
  readonly at: number;
  readonly text: string;
  readonly wrong: boolean;
  /** The selection the marker is being typed over; its start is `at`. */
  readonly wrap: { readonly from: number; readonly to: number } | null;
}

/** Whether the caret, or the selection, is still where the marker is being typed. */
const stillAt = (held: Composing, sel: { from: number; to: number }): boolean =>
  held.wrap === null
    ? sel.from === held.at && sel.to === held.at
    : sel.from === held.wrap.from && sel.to === held.wrap.to;

const compose = StateEffect.define<Composing | null>();

const composingField = StateField.define<Composing | null>({
  create: () => null,
  update(held, tr) {
    for (const effect of tr.effects) if (effect.is(compose)) return effect.value;
    if (held === null) return null;
    // A flip to USFM or to read-only changes neither the text nor the caret.
    if (!inRefine(tr.state) || tr.state.readOnly) return null;
    if (tr.docChanged) return null;
    if (tr.selection && !stillAt(held, tr.newSelection.main)) return null;
    return held;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (held) =>
      held === null
        ? Decoration.none
        : Decoration.set([
            Decoration.widget({ widget: new TypedMarker(held.text, held.wrong), side: -1 }).range(
              held.at,
            ),
          ]),
    ),
});

class TypedMarker extends WidgetType {
  constructor(
    readonly text: string,
    readonly wrong: boolean,
  ) {
    super();
  }
  eq(other: TypedMarker) {
    return other.text === this.text && other.wrong === this.wrong;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = this.wrong ? "cm-typed-usfm cm-typed-usfm-wrong" : "cm-typed-usfm";
    span.textContent = this.text;
    return span;
  }
}

const inRefine = (state: EditorState): boolean =>
  isVisual(state) && !assignmentAt(state).verseLines;

/** On the transaction that writes a typed marker: its name (`v`, `q2`). */
export const typedMarker = StateEffect.define<string>();

const rowNamed = (name: string) =>
  MARKERS.find((row) => row.name === name) ??
  MARKERS.find((row) => row.name === name.replace(/\d+$/, ""));

/** Header and introduction markers: paragraph-kind, but not a line in a chapter. */
const NOT_IN_A_CHAPTER = /^(h|toc\w*|ide|rem|sts|cl|cd|cp|mte?\d*|i[a-z]+\d*|z\w+)$/;

/**
 * The character markers that may be typed into running text: its features
 * (`\nd`, `\wj`, `\add`), its formatting (`\bd`, `\it`) and poetry's (`\qs`).
 * Not a note's, a list's, a table's or the introduction's, which belong
 * somewhere a typed marker cannot put them.
 */
const TYPED_CHARACTER: ReadonlySet<number> = new Set([
  Category.CharTextFeatures,
  Category.CharFormatting,
  Category.CharPoetry,
]);

const characterNamed = (name: string) =>
  MARKERS.find(
    (row) =>
      row.name === name && row.kind === MarkerKind.Character && TYPED_CHARACTER.has(row.category),
  );

/** The character runs on `pos`'s line whose words `pos` stands among. */
const runsAround = (structure: DocStructure, pos: number) => {
  const row = lineIndexAt(structure, pos);
  if (row < 0) return [];
  return structure.lines
    .at(row)
    .words.filter((word) => !word.figure && word.surfaceFrom <= pos && pos <= word.surfaceTo);
};

/**
 * The pair a typed character marker writes, empty at the caret or around a
 * selection; null when it cannot be written there.
 */
function writtenCharacter(state: EditorState, held: Composing, name: string): Transaction | null {
  if (characterNamed(name) === undefined) return null;
  const structure = structureAt(state);
  const from = held.wrap?.from ?? held.at;
  const to = held.wrap?.to ?? held.at;
  const around = runsAround(structure, from);
  if (held.wrap !== null) {
    if (state.doc.sliceString(from, to).includes("\n")) return null;
    if (structure.verses.some((verse) => verse.markerFrom >= from && verse.markerFrom < to))
      return null;
    // Both ends inside the same runs, or the pair would cross another's edge.
    const outer = runsAround(structure, to);
    if (around.length !== outer.length || around.some((run) => !outer.includes(run))) return null;
  }
  const nested = around.length > 0 ? "+" : "";
  const open = `\\${nested}${name} `;
  const close = `\\${nested}${name}*`;
  const common = {
    effects: [compose.of(null), typedMarker.of(name)],
    annotations: trusted.of("typed-usfm"),
    userEvent: "input.usfm.typed",
    scrollIntoView: true,
  };
  if (held.wrap !== null)
    return state.update({
      ...common,
      changes: [
        { from, insert: open },
        { from: to, insert: close },
      ],
      selection: EditorSelection.range(from + open.length, to + open.length),
    });
  const inside = from + open.length;
  return state.update({
    ...common,
    changes: { from, insert: open + close },
    selection: EditorSelection.cursor(inside),
    effects: [...common.effects, holdRun.of({ from, at: inside, to: inside + close.length })],
  });
}

/** The transaction a typed marker writes; null when Refine cannot take it. */
function written(state: EditorState, held: Composing): Transaction | null {
  const at = held.at;
  const typed = held.text;
  const character = /^\\\+?([a-z]+\d*)$/.exec(typed)?.[1];
  if (character !== undefined && characterNamed(character) !== undefined)
    return writtenCharacter(state, held, character);
  if (held.wrap !== null) return null;
  const verse = /^\\v[ \t]+(\d{1,3}[a-z]?(?:-\d{1,3}[a-z]?)?)$/.exec(typed);
  if (verse !== null) {
    const before = state.doc.sliceString(Math.max(0, at - 1), at);
    const insert = `${before === "" || /\s/.test(before) ? "" : " "}\\v ${verse[1]} `;
    return state.update({
      changes: { from: at, insert },
      selection: EditorSelection.cursor(at + insert.length),
      effects: [compose.of(null), typedMarker.of("v")],
      annotations: trusted.of("typed-usfm"),
      userEvent: "input.usfm.typed",
      scrollIntoView: true,
    });
  }
  const name = /^\\([A-Za-z]+\d*)$/.exec(typed)?.[1];
  if (name === undefined || NOT_IN_A_CHAPTER.test(name)) return null;
  if (rowNamed(name)?.kind !== MarkerKind.Paragraph) return null;
  // The canonical Enter, then the canonical marker change on its new line:
  // where a line may break, and how its spaces split, are Enter's to say.
  const split = run(guardedEnter(structureAt, planAt), state);
  if (split === null) return null;
  const marked = run(setBlockMarker(structureAt, name), split.state);
  return state.update({
    changes: marked === null ? split.changes : split.changes.compose(marked.changes),
    selection: (marked ?? split).state.selection,
    effects: [compose.of(null), typedMarker.of(name)],
    annotations: trusted.of("typed-usfm"),
    userEvent: "input.usfm.typed",
    scrollIntoView: true,
    // Each step was judged by the transaction filters as it was made.
    filter: false,
  });
}

/** The transaction a command would dispatch, without dispatching it. */
function run(command: StateCommand, state: EditorState): Transaction | null {
  let made: Transaction | null = null;
  command({ state, dispatch: (tr) => (made = tr) });
  return made;
}

/** Writes what is being typed, or marks it wrong; true either way, the key is spent. */
function commit(view: EditorView, held: Composing): boolean {
  const write = written(view.state, held);
  view.dispatch(write ?? { effects: compose.of({ ...held, wrong: true }) });
  return true;
}

const typing = EditorView.inputHandler.of((view, from, to, text) => {
  const held = view.state.field(composingField, false) ?? null;
  if (held === null) {
    if (text !== "\\" || !inRefine(view.state) || view.state.readOnly) return false;
    const sel = view.state.selection.main;
    // Over a selection, only when the selection is exactly what the key would replace.
    if (from !== to && (sel.from !== from || sel.to !== to)) return false;
    const wrap = from === to ? null : { from, to };
    view.dispatch({ effects: compose.of({ at: from, text: "\\", wrong: false, wrap }) });
    return true;
  }
  if (!stillAt(held, { from, to })) return false;
  if (/^[A-Za-z0-9 *+-]+$/.test(text)) {
    view.dispatch({ effects: compose.of({ ...held, text: held.text + text, wrong: false }) });
    return true;
  }
  return false;
});

/**
 * The commands, by id; their keys are `keymaps.ts`'s (Space and Enter accept,
 * Backspace shortens, Escape drops). Each declines when no marker is being
 * typed, and `accept` declines on a bare `\\v`, whose number comes after a space.
 */
export const typedMarkerCommands: Readonly<Record<string, Command>> = {
  "typedMarker.accept": (view) => {
    const held = view.state.field(composingField, false) ?? null;
    if (held === null || held.text === "\\v") return false;
    return commit(view, held);
  },
  "typedMarker.shorten": (view) => {
    const held = view.state.field(composingField, false) ?? null;
    if (held === null) return dropHeldRun(view);
    const text = held.text.slice(0, -1);
    view.dispatch({
      effects: compose.of(text === "" ? null : { ...held, text, wrong: false }),
    });
    return true;
  },
  "typedMarker.dropHeld": dropHeldRun,
  "typedMarker.cancel": (view) => {
    if ((view.state.field(composingField, false) ?? null) === null) return false;
    view.dispatch({ effects: compose.of(null) });
    return true;
  },
};

/** The marker being typed, and the typing that grows it. */
export const typedMarkerBehaviour: Extension = [
  composingField,
  Prec.highest(typing),
  heldRunBehaviour,
];
