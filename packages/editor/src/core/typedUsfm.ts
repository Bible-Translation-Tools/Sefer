import {
  EditorSelection,
  type EditorState,
  type Extension,
  Prec,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { Decoration, EditorView, type KeyBinding, WidgetType } from "@codemirror/view";
import { MARKERS, MarkerKind } from "@sefer/text/engine/analysis";

import { isVisual, nl, trusted } from "./kernel";
import { assignmentAt } from "./registry";

/**
 * USFM typed straight into Refine. A backslash starts a marker being typed: it
 * shows where it will go, in the USFM colours, and is not in the text yet.
 * Space (or Enter) writes it when it is a marker Refine can take:
 *
 * - `\v 4` — a verse, numbered as typed;
 * - a paragraph or poetry marker (`\p`, `\q2`, `\s1`) — a new line of that kind
 *   from the caret, as Enter makes one.
 *
 * Not yet a character marker (`\nd`): its empty pair is no caret stop, so the
 * caret settles outside it and what is typed next misses it. Anything else
 * (`\c`, a note, a character marker, a misspelling) stays on screen marked wrong
 * until Backspace or Escape takes it back. Each marker written tells the host
 * (`onTypedUsfm`), so it can say USFM mode is there for someone who types it.
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

const listeners = new WeakMap<EditorView, Set<(marker: string) => void>>();

/** Called with each marker written by typing USFM in Refine (`v`, `q2`). Returns the detach. */
export function onTypedUsfm(view: EditorView, listener: (marker: string) => void): () => void {
  let held = listeners.get(view);
  if (held === undefined) listeners.set(view, (held = new Set()));
  held.add(listener);
  return () => held.delete(listener);
}

const rowNamed = (name: string) =>
  MARKERS.find((row) => row.name === name) ??
  MARKERS.find((row) => row.name === name.replace(/\d+$/, ""));

/** What a typed marker writes at `at`, and where the caret goes; null when Refine cannot take it. */
function written(
  state: EditorState,
  at: number,
  typed: string,
): { from: number; to: number; insert: string; caret: number; marker: string } | null {
  const verse = /^\\v[ \t]+(\d{1,3}[a-z]?(?:-\d{1,3}[a-z]?)?)$/.exec(typed);
  const before = state.doc.sliceString(Math.max(0, at - 1), at);
  if (verse !== null) {
    const insert = `${before === "" || /\s/.test(before) ? "" : " "}\\v ${verse[1]} `;
    return { from: at, to: at, insert, caret: at + insert.length, marker: "v" };
  }
  const name = /^\\([A-Za-z]+\d*)$/.exec(typed)?.[1];
  if (name === undefined) return null;
  const row = rowNamed(name);
  if (row === undefined) return null;
  if (row.kind === MarkerKind.Paragraph) {
    let from = at;
    let to = at;
    while (from > 0 && /[ \t]/.test(state.doc.sliceString(from - 1, from))) from--;
    while (to < state.doc.length && /[ \t]/.test(state.doc.sliceString(to, to + 1))) to++;
    const insert = `${nl(state)}\\${name} `;
    return { from, to, insert, caret: from + insert.length, marker: name };
  }
  return null;
}

/** Writes what is being typed, or marks it wrong; true either way, the key is spent. */
function commit(view: EditorView, held: Composing): boolean {
  const write = written(view.state, held.at, held.text);
  if (write === null) {
    view.dispatch({ effects: compose.of({ ...held, wrong: true }) });
    return true;
  }
  view.dispatch({
    changes: { from: write.from, to: write.to, insert: write.insert },
    selection: EditorSelection.cursor(write.caret),
    effects: compose.of(null),
    annotations: trusted.of("typed-usfm"),
    userEvent: "input.usfm.typed",
    scrollIntoView: true,
  });
  for (const listener of listeners.get(view) ?? []) listener(write.marker);
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
export const typedUsfmKeys = (): readonly KeyBinding[] => [
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
export const typedUsfmBehaviour: Extension = [composingField, Prec.highest(typing)];
