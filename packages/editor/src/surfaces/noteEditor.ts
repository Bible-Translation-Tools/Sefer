import {
  EditorState,
  Prec,
  StateEffect,
  StateField,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap } from "@codemirror/view";
import { NOTE_PART } from "@sefer/text/engine/analysis";

import { funnelFor, seatedOf, type EditorBook } from "../book";
import { planAt } from "../core/editorState";
import { trusted } from "../core/kernel";
import { analyzer } from "../core/model/analyzer";
import { docText, structureAt, structureField } from "../core/model/docStructure";
import {
  buildNoteApparatus,
  noteApparatusText,
  noteReference,
  paintNoteBody,
  setNoteToggler,
  type NoteGesture,
} from "../core/paint/decorations";
import { modeView } from "../views";
import { edgesAreStops, mountSatellite, satelliteRange, type Satellite } from "./satellite";

/**
 * The note open for typing: `at` is its start, `inline` whether it opened in
 * a popover at its caller (a click on the letter, or a note just inserted)
 * rather than in its row at the chapter's foot.
 */
interface Editing {
  readonly at: number;
  readonly inline: boolean;
}

const setEditing = StateEffect.define<Editing | null>();

const insertedNote = (tr: Transaction): number | null => {
  if (!tr.isUserEvent("input.usfm.footnote")) return null;
  let at: number | null = null;
  tr.changes.iterChanges((_fromA, _toA, fromB) => {
    at ??= fromB;
  });
  return at;
};

const editingField = StateField.define<Editing | null>({
  create: () => null,
  update(held, tr) {
    for (const effect of tr.effects) if (effect.is(setEditing)) return effect.value;
    const made = insertedNote(tr);
    if (made !== null) return { at: made, inline: true };
    if (held === null || !tr.docChanged) return held;
    return { ...held, at: tr.changes.mapPos(held.at, 1) };
  },
});

/**
 * The verse a note's reference went back to, lit for a moment so the eye
 * lands on it after the scroll (Thomas, 2026-10-30).
 */
const FLASH_MS = 1600;
const setFlash = StateEffect.define<{ from: number; to: number } | null>();

const flashField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(held, tr) {
    for (const effect of tr.effects) if (effect.is(setFlash)) return effect.value;
    if (held === null || !tr.docChanged) return held;
    return { from: tr.changes.mapPos(held.from, 1), to: tr.changes.mapPos(held.to, -1) };
  },
  provide: (field) =>
    EditorView.decorations.from(field, (held) =>
      held === null || held.to <= held.from
        ? Decoration.none
        : Decoration.set([
            Decoration.mark({ class: "usfm-verse-flash" }).range(held.from, held.to),
          ]),
    ),
});

/** The text of the verse holding `at`: from after its number to the next verse or chapter. */
function verseAround(state: EditorState, at: number): { from: number; to: number } {
  const verses = structureAt(state).verses;
  let from = 0;
  let to = state.doc.length;
  for (const verse of verses) {
    if (verse.markerFrom <= at) from = verse.contentFrom;
    else {
      to = verse.markerFrom;
      break;
    }
  }
  const chapter = state.doc.sliceString(from, to).search(/\\c\s/);
  if (chapter >= 0) to = from + chapter;
  while (to > from && /\s/.test(state.doc.sliceString(to - 1, to))) to--;
  return { from, to };
}

const flashVerse = (view: EditorView, at: number): void => {
  const verse = verseAround(view.state, at);
  view.dispatch({ effects: setFlash.of(verse) });
  setTimeout(() => {
    if (view.state.field(flashField, false) !== null) view.dispatch({ effects: setFlash.of(null) });
  }, FLASH_MS);
};

const editingNote = (state: EditorState): Editing | null =>
  state.field(editingField, false) ?? null;

const callerFor = (view: EditorView, at: number): HTMLElement | null =>
  view.contentDOM.querySelector(`.usfm-caller[data-note-at="${String(at)}"]`);

/**
 * Takes a note out, letter and all: only ever by its Remove button. A note
 * whose text is all gone stays, showing where its words go, until then.
 */
const removeNote = (view: EditorView, at: number): void => {
  const note = structureAt(view.state).notes.find((row) => row.from === at);
  if (note === undefined) return;
  view.dispatch({
    effects: setEditing.of(null),
    changes: { from: note.from, to: note.to },
    annotations: trusted.of("remove-note"),
    userEvent: "delete.footnote",
  });
};

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

/** Where typing picks up in an opened note: after its last word, as in Word. */
const caretFor = (view: EditorView, at: number, span: { from: number; to: number }): number => {
  const note = structureAt(view.state).notes.find((row) => row.from === at);
  const body = note?.parts.findLast((part) => part.kind === NOTE_PART.BODY);
  let end = body === undefined ? span.to : body.to;
  while (end > span.from && /\s/.test(view.state.doc.sliceString(end - 1, end))) end--;
  return Math.min(span.to, Math.max(span.from, end));
};

class NoteSurfaces {
  readonly #view: EditorView;
  #open: {
    at: number;
    inline: boolean;
    satellite: Satellite;
    row: HTMLElement;
    slot: HTMLElement;
    detach: () => void;
  } | null = null;

  /** Where the last press on a note's text at the chapter's foot was, to put the caret there. */
  #pressedAt: { x: number; y: number } | null = null;
  readonly #press = (event: MouseEvent): void => {
    const onBody = event.target instanceof Element && event.target.closest(".usfm-note-body");
    this.#pressedAt = onBody ? { x: event.clientX, y: event.clientY } : null;
  };

  constructor(view: EditorView) {
    this.#view = view;
    view.dom.addEventListener("mousedown", this.#press, true);
    this.#sync();
  }

  update(): void {
    this.#sync();
  }

  destroy(): void {
    this.#view.dom.removeEventListener("mousedown", this.#press, true);
    this.#close();
  }

  #sync(): void {
    const want = editingNote(this.#view.state);
    const orphaned = this.#open !== null && !this.#open.row.isConnected;
    if (
      want !== null &&
      this.#open?.at === want.at &&
      this.#open.inline === want.inline &&
      !orphaned
    ) {
      if (want.inline) this.#place();
      return;
    }
    this.#close();
    if (want === null) return;
    if (want.inline) this.#mountInlineWhenDrawn(want.at, 20);
    else this.#mountWhenDrawn(want.at, 20, true);
  }

  #mountInlineWhenDrawn(at: number, tries: number): void {
    requestAnimationFrame(() => {
      const want = editingNote(this.#view.state);
      if (want?.at !== at || !want.inline || this.#open !== null) return;
      if (callerFor(this.#view, at) === null) {
        if (tries > 0) this.#mountInlineWhenDrawn(at, tries - 1);
        return;
      }
      const pop = document.createElement("div");
      pop.className = "usfm-note-pop usfm-note";
      pop.setAttribute("role", "dialog");
      const slot = document.createElement("span");
      slot.className = "usfm-note-edit";
      pop.append(slot);
      this.#view.dom.append(pop);
      this.#mount(at, pop, true);
      this.#place();
    });
  }

  /** The popover under its caller, kept there as the text scrolls. */
  #place(): void {
    const held = this.#open;
    if (held === null || !held.inline) return;
    const caller = callerFor(this.#view, held.at);
    if (caller === null) return;
    const box = this.#view.dom.getBoundingClientRect();
    const at = caller.getBoundingClientRect();
    const left = Math.max(8, Math.min(at.left - box.left - 12, box.width - 368));
    held.row.style.top = `${String(at.bottom - box.top + 6)}px`;
    held.row.style.left = `${String(left)}px`;
  }

  #mountWhenDrawn(at: number, tries: number, mayScroll: boolean): void {
    requestAnimationFrame(() => {
      const want = editingNote(this.#view.state);
      if (want?.at !== at || want.inline || this.#open !== null) return;
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
      const row = rowFor(this.#view, at);
      if (row !== null) this.#mount(at, row, false);
    });
  }

  #mount(at: number, row: HTMLElement, inline: boolean): void {
    const book = noteBook(this.#view);
    const span = spanOf(this.#view, at);
    if (book === undefined || row === null || span === null) return;
    const slot = row.querySelector<HTMLElement>(".usfm-note-edit");
    if (slot === null) return;

    const close = (): void => {
      this.#view.dispatch({ effects: setEditing.of(null) });
      this.#view.focus();
    };
    // The book keeps a note's last letter (an empty body has no caret stop),
    // so the key that would take it, or a selection of all of it, empties the
    // note itself; the note stays, its placeholder showing.
    const emptied = (sv: EditorView): boolean => {
      const clip = satelliteRange(sv.state);
      if (clip === null || clip.to === clip.from) return false;
      const sel = sv.state.selection.main;
      if (clip.to - clip.from - (sel.empty ? 1 : sel.to - sel.from) > 0) return false;
      this.#view.dispatch({
        changes: { from: clip.from, to: clip.to },
        annotations: trusted.of("empty-note"),
        userEvent: "delete.footnote",
      });
      return true;
    };

    const satellite = mountSatellite({
      parent: slot,
      host: funnelFor(seatedOf(book)),
      range: span,
      editable: true,
      label: `note:${String(at)}`,
      extensions: [
        modeView("note-satellite", "cm-note"),
        edgesAreStops.of(true),
        analyzer.of(this.#view.state.facet(analyzer)),
        structureField,
        EditorView.decorations.compute(["doc"], (state) =>
          buildNoteApparatus(docText(state), structureAt(state), satelliteRange(state) ?? span),
        ),
        Prec.highest(
          keymap.of([
            { key: "Escape", run: () => (close(), true) },
            { key: "Enter", run: () => (close(), true) },
            { key: "Backspace", run: emptied },
            { key: "Delete", run: emptied },
          ]),
        ),
      ],
    });

    const done = document.createElement("button");
    done.type = "button";
    // Saving is what Enter does, so the button wears the return key (Thomas, 2026-10-30).
    done.className = "usfm-note-done usfm-note-save";
    done.title = "Save footnote (Enter)";
    done.innerHTML =
      '<span>Save footnote</span><svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>';
    done.onmousedown = (event) => {
      event.preventDefault();
      close();
    };
    // At the chapter's foot the note is edited where it reads, as text: no
    // button, no box, and the caret where it was clicked (Thomas, 2026-10-30).
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "usfm-note-done usfm-note-remove-pop";
    remove.textContent = "Remove";
    remove.onmousedown = (event) => {
      event.preventDefault();
      removeNote(this.#view, at);
      this.#view.focus();
    };
    if (inline) row.append(remove, done);
    row.classList.add("usfm-note-editing");
    const pressed = inline ? null : this.#pressedAt;
    const clicked = pressed === null ? null : satellite.view.posAtCoords(pressed);
    satellite.view.dispatch({
      selection: { anchor: clicked ?? caretFor(this.#view, at, span) },
    });
    satellite.view.focus();

    // An open note closes on a press anywhere outside it, as a menu does.
    const outside = (event: MouseEvent): void => {
      if (event.target instanceof Node && row.contains(event.target)) return;
      close();
    };
    const follow = (): void => this.#place();
    document.addEventListener("mousedown", outside, true);
    if (inline) this.#view.scrollDOM.addEventListener("scroll", follow);
    const detach = (): void => {
      document.removeEventListener("mousedown", outside, true);
      this.#view.scrollDOM.removeEventListener("scroll", follow);
    };

    this.#open = { at, inline, satellite, row, slot, detach };
  }

  #close(): void {
    const held = this.#open;
    this.#open = null;
    if (held === null) return;
    held.detach();
    held.satellite.destroy();
    if (held.inline) {
      held.row.remove();
      return;
    }
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
    set("usfm-note-ref", noteReference(doc, structureAt(this.#view.state), at));
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
  if (how === "remove") {
    removeNote(view, at);
    return;
  }
  if (how === "edit" || how === "caller") {
    view.dispatch({ effects: setEditing.of({ at, inline: how === "caller" }) });
    return;
  }
  if (how === "back") {
    view.dispatch({
      effects: [setEditing.of(null), EditorView.scrollIntoView(at, { y: "center" })],
    });
    flashVerse(view, at);
    return;
  }
});

/**
 * Callers that open their note in a popover, rows that go back, and note
 * bodies that can be typed in at the chapter's foot. A note left with no text
 * when it closes is deleted.
 * Mount it beside the view layer; it is a DOM surface and does nothing headless.
 */
export const noteEditing = (): Extension => [
  editingField,
  flashField,
  ViewPlugin.fromClass(NoteSurfaces),
];
