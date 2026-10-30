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
import { Decoration, EditorView, type KeyBinding, WidgetType } from "@codemirror/view";
import { MARKERS, MarkerKind } from "@sefer/text/engine/analysis";

import { planAt, structureAt } from "../editorState";
import { guardedEnter, setBlockMarker } from "../input";
import { isVisual, trusted } from "../kernel";
import { assignmentAt } from "../registry";

/**
 * USFM typed straight into Refine. A backslash starts a marker being typed: it
 * shows where it will go, in the USFM colours, and is not in the text yet.
 * Space (or Enter) writes it when it is a marker Refine can take:
 *
 * - `\v 4` — a verse, numbered as typed;
 * - a paragraph, poetry or heading marker (`\p`, `\q2`, `\s1`) — Enter at the
 *   caret, then the new line given that marker, as one Undo step. Not the
 *   book's header or introduction (`\h`, `\toc1`, `\mt`, `\ip`), which have
 *   no place in a chapter.
 *
 * Not yet a character marker (`\nd`): its empty pair is no caret stop, so the
 * caret settles outside it and what is typed next misses it. Anything else
 * (`\c`, a note, a character marker, a misspelling) stays on screen marked wrong
 * until Backspace or Escape takes it back. Each marker written carries
 * `typedMarker`, which the mount hands its host (`onTypedUsfm`), so it can say
 * USFM mode is there for someone who types it.
 */

interface Composing {
  readonly at: number;
  readonly text: string;
  readonly wrong: boolean;
}

const compose = StateEffect.define<Composing | null>();

const composingField = StateField.define<Composing | null>({
  create: () => null,
  update(held, tr) {
    for (const effect of tr.effects) if (effect.is(compose)) return effect.value;
    if (held === null) return null;
    if (tr.docChanged) return null;
    if (tr.selection && tr.newSelection.main.head !== held.at) return null;
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

/** The transaction a typed marker writes; null when Refine cannot take it. */
function written(state: EditorState, at: number, typed: string): Transaction | null {
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
  // The canonical Enter, then its new line's marker renamed: where a line may
  // break, and how its spaces split, are Enter's to say.
  const split = run(guardedEnter(structureAt, planAt), state);
  if (split === null) return null;
  const marked = run(setBlockMarker(structureAt, name), split.state);
  const last = marked ?? split;
  return state.update({
    changes: marked === null ? split.changes : split.changes.compose(marked.changes),
    selection: last.state.selection,
    effects: [compose.of(null), typedMarker.of(name)],
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
  const write = written(view.state, held.at, held.text);
  view.dispatch(write ?? { effects: compose.of({ ...held, wrong: true }) });
  return true;
}

const typing = EditorView.inputHandler.of((view, from, to, text) => {
  const held = view.state.field(composingField, false) ?? null;
  if (held === null) {
    if (text !== "\\" || from !== to || !inRefine(view.state) || view.state.readOnly) return false;
    view.dispatch({ effects: compose.of({ at: from, text: "\\", wrong: false }) });
    return true;
  }
  if (from !== held.at || to !== from) return false;
  // `\v` takes its number after a space; any other marker is done at the space.
  if (text === " " && !/^\\v$/.test(held.text)) return commit(view, held);
  if (/^[A-Za-z0-9 *+-]+$/.test(text)) {
    view.dispatch({ effects: compose.of({ at: held.at, text: held.text + text, wrong: false }) });
    return true;
  }
  return false;
});

/** Backspace, Escape and Enter while a marker is being typed; each declines otherwise. */
export const typedMarkerKeys = (): readonly KeyBinding[] => [
  {
    key: "Backspace",
    run: (view) => {
      const held = view.state.field(composingField, false) ?? null;
      if (held === null) return false;
      const text = held.text.slice(0, -1);
      view.dispatch({
        effects: compose.of(text === "" ? null : { at: held.at, text, wrong: false }),
      });
      return true;
    },
  },
  {
    key: "Escape",
    run: (view) => {
      if ((view.state.field(composingField, false) ?? null) === null) return false;
      view.dispatch({ effects: compose.of(null) });
      return true;
    },
  },
  {
    key: "Enter",
    run: (view) => {
      const held = view.state.field(composingField, false) ?? null;
      return held === null ? false : commit(view, held);
    },
  },
];

/** The marker being typed, and the typing that grows it. */
export const typedMarkerBehaviour: Extension = [composingField, Prec.highest(typing)];
