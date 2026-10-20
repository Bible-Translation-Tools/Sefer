import {
  EditorState,
  StateEffect,
  StateField,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import { EditorView, ViewPlugin, keymap } from "@codemirror/view";
import { NOTE_PART } from "@sefer/text/engine/analysis";

import { funnelFor, seatedOf, type EditorBook } from "../book";
import { analyzer } from "../core/analyzer";
import {
  buildNoteApparatus,
  noteApparatusText,
  paintNoteBody,
  setNoteToggler,
  type NoteGesture,
} from "../core/decorations";
import { docText, structureAt, structureField } from "../core/docStructure";
import { planAt } from "../core/editorState";
import { modeView } from "../views";
import { mountSatellite, satelliteRange, type Satellite } from "./satellite";

const setEditing = StateEffect.define<number | null>();

const insertedNote = (tr: Transaction): number | null => {
  if (!tr.isUserEvent("input.usfm.footnote")) return null;
  let at: number | null = null;
  tr.changes.iterChanges((_fromA, _toA, fromB) => {
    at ??= fromB;
  });
  return at;
};

const editingField = StateField.define<number | null>({
  create: () => null,
  update(held, tr) {
    for (const effect of tr.effects) if (effect.is(setEditing)) return effect.value;
    const made = insertedNote(tr);
    if (made !== null) return made;
    if (held === null || !tr.docChanged) return held;
    return tr.changes.mapPos(held, 1);
  },
});

const editingNote = (state: EditorState): number | null => state.field(editingField, false) ?? null;

const FLASH_MS = 900;

const rowFor = (view: EditorView, at: number): HTMLElement | null =>
  view.dom.querySelector(`.usfm-note[data-note-row="${String(at)}"]`);

const apparatusAt = (view: EditorView, at: number): number | null => {
  try {
    const block = planAt(view.state).apparatus.find((entry) =>
      entry.notes.some((note) => note.from === at),
    );
    return block === undefined ? null : block.at;
  } catch {
    return null;
  }
};

const flashRow = (view: EditorView, at: number, tries = 12): void => {
  const row = rowFor(view, at);
  if (row === null) {
    if (tries > 0) requestAnimationFrame(() => flashRow(view, at, tries - 1));
    return;
  }
  row.classList.add("usfm-note-found");
  setTimeout(() => row.classList.remove("usfm-note-found"), FLASH_MS);
};

const spanOf = (view: EditorView, at: number): { from: number; to: number } | null => {
  const note = structureAt(view.state).notes.find((row) => row.from === at);
  if (note === undefined) return null;
  const content = note.parts.filter(
    (part) => part.kind === NOTE_PART.ORIGIN || part.kind === NOTE_PART.BODY,
  );
  const first = content[0];
  const last = content[content.length - 1];
  if (first !== undefined && last !== undefined) return { from: first.from, to: last.to };
  const closer = note.parts.findLast(
    (part) => part.kind === NOTE_PART.MARKUP && part.to === note.to,
  );
  const empty = closer?.from ?? note.to;
  return { from: empty, to: empty };
};

const caretFor = (view: EditorView, at: number, span: { from: number; to: number }): number => {
  const note = structureAt(view.state).notes.find((row) => row.from === at);
  const body = note?.parts.find((part) => part.kind === NOTE_PART.BODY);
  const wanted = body === undefined ? span.to : body.from;
  return Math.min(span.to, Math.max(span.from, wanted));
};

class NoteSurfaces {
  readonly #view: EditorView;
  #open: { at: number; satellite: Satellite; row: HTMLElement; slot: HTMLElement } | null = null;

  constructor(view: EditorView) {
    this.#view = view;
    this.#sync();
  }

  update(): void {
    this.#sync();
  }

  destroy(): void {
    this.#close();
  }

  #sync(): void {
    const want = editingNote(this.#view.state);
    const orphaned = this.#open !== null && !this.#open.row.isConnected;
    if (this.#open?.at === want && !orphaned) return;
    this.#close();
    if (want === null) return;
    this.#mountWhenDrawn(want, 20, true);
  }

  #mountWhenDrawn(at: number, tries: number, mayScroll: boolean): void {
    requestAnimationFrame(() => {
      if (editingNote(this.#view.state) !== at || this.#open !== null) return;
      if (rowFor(this.#view, at) === null) {
        let scrolled = false;
        if (mayScroll) {
          const block = apparatusAt(this.#view, at);
          if (block !== null) {
            this.#view.dispatch({ effects: EditorView.scrollIntoView(block, { y: "end" }) });
            scrolled = true;
          }
        }
        if (tries > 0) this.#mountWhenDrawn(at, tries - 1, mayScroll && !scrolled);
        return;
      }
      this.#mount(at);
    });
  }

  #mount(at: number): void {
    const book = noteBook(this.#view);
    const row = rowFor(this.#view, at);
    const span = spanOf(this.#view, at);
    if (book === undefined || row === null || span === null) return;
    const slot = row.querySelector<HTMLElement>(".usfm-note-edit");
    if (slot === null) return;

    const close = (): void => {
      this.#view.dispatch({ effects: setEditing.of(null) });
      this.#view.focus();
    };

    const satellite = mountSatellite({
      parent: slot,
      host: funnelFor(seatedOf(book)),
      range: span,
      editable: true,
      label: `note:${String(at)}`,
      extensions: [
        modeView("note-satellite", "cm-note"),
        analyzer.of(this.#view.state.facet(analyzer)),
        structureField,
        EditorView.decorations.compute(["doc"], (state) =>
          buildNoteApparatus(docText(state), structureAt(state), satelliteRange(state) ?? span),
        ),
        keymap.of([{ key: "Escape", run: () => (close(), true) }]),
      ],
    });

    const done = document.createElement("button");
    done.type = "button";
    done.className = "usfm-note-done";
    done.textContent = "Done";
    done.onmousedown = (event) => {
      event.preventDefault();
      close();
    };
    row.append(done);
    row.classList.add("usfm-note-editing");
    satellite.view.dispatch({ selection: { anchor: caretFor(this.#view, at, span) } });
    satellite.view.focus();

    this.#open = { at, satellite, row, slot };
  }

  #close(): void {
    const held = this.#open;
    this.#open = null;
    if (held === null) return;
    held.satellite.destroy();
    held.row.classList.remove("usfm-note-editing");
    held.row.querySelector(".usfm-note-done")?.remove();
    held.slot.replaceChildren();
    this.#refresh(held.row, held.at);
  }

  #refresh(row: HTMLElement, at: number): void {
    const note = structureAt(this.#view.state).notes.find((held) => held.from === at);
    if (note === undefined) return;
    const doc = docText(this.#view.state);
    const set = (className: string, text: string): void => {
      const span = row.querySelector<HTMLElement>(`.${className}`);
      if (span !== null && span.textContent !== text) span.textContent = text;
    };
    set("usfm-note-ref", noteApparatusText(doc, note, NOTE_PART.ORIGIN));
    const body = row.querySelector<HTMLElement>(".usfm-note-body");
    if (body !== null) paintNoteBody(body, noteApparatusText(doc, note, NOTE_PART.BODY));
  }
}

const books = new WeakMap<EditorView, EditorBook>();

/** Told which Book a mounted view belongs to; see `EditorBook.bindView`. */
export const noteBookIs = (view: EditorView, book: EditorBook): (() => void) => {
  books.set(view, book);
  return () => {
    books.delete(view);
  };
};

const noteBook = (view: EditorView): EditorBook | undefined => books.get(view);

setNoteToggler((view: EditorView, at: number, how: NoteGesture) => {
  if (how === "edit") {
    view.dispatch({ effects: setEditing.of(at) });
    return;
  }
  if (how === "back") {
    view.dispatch({
      effects: [setEditing.of(null), EditorView.scrollIntoView(at, { y: "center" })],
    });
    return;
  }
  const block = apparatusAt(view, at);
  if (block === null) return;
  view.dispatch({ effects: EditorView.scrollIntoView(block, { y: "end" }) });
  requestAnimationFrame(() => flashRow(view, at));
});

/**
 * Callers that follow, rows that go back, and note bodies that can be typed in.
 * Mount it beside the view layer; it is a DOM surface and does nothing headless.
 */
export const noteEditing = (): Extension => [editingField, ViewPlugin.fromClass(NoteSurfaces)];
