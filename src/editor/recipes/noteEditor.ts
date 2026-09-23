/**
 * Footnotes you can reach and footnotes you can edit.
 *
 * In regular mode a note is drawn twice: as a superscript CALLER where it is
 * anchored, and as a ROW in the apparatus block at the foot of its chapter
 * (`core/decorations.ts`). Both were inert — `toggleNote` was a stub nothing
 * ever installed, so a caller was a letter you could not follow and the rows at
 * the bottom were a picture of the notes rather than the notes.
 *
 * Three gestures, and they are the ones a reader would guess:
 *
 *  - **Click a caller** and the page goes to that note's row and flashes it.
 *  - **Click a row's mark or its reference** and the page goes back to the
 *    caller, so the two halves of a note are one round trip.
 *  - **Click a row's body** and the body becomes editable in place.
 *
 * The editable body is a SATELLITE (`recipes/satellite.ts`), mounted into the
 * row's own `.usfm-note-edit` slot, which is why it is honest: it holds no copy
 * of the text, every keystroke goes through the `Funnel` to `book.apply`, and
 * the canonical Book hands it back. The row's static text hides while it is
 * open (`usfm-note-editing`) so the note is not on screen twice.
 *
 * Why the body cannot simply be typed into: in regular mode the note's markup
 * and body are ELIDED in the page — `\f + \ft …\f*` collapses to the caller —
 * so there is no visible document position in the flow for a caret to sit in.
 * `buildNoteApparatus` is the projection that unhides exactly one note, and the
 * satellite is the surface that wears it.
 */

import {
  EditorState,
  StateEffect,
  StateField,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import { EditorView, ViewPlugin, keymap } from "@codemirror/view";

import { trustedBy } from "../../core/book/book";
import { NOTE_PART } from "../../core/galley";
import { funnelFor, type EditorBook } from "../book";
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
import { mountSatellite, satelliteRange, type Satellite } from "./satellite";

/** Which note the reader is editing, as a document offset, or nothing. */
const setEditing = StateEffect.define<number | null>();

/**
 * The offset of the note a transaction just inserted, if it was one.
 *
 * `insertFootnote` writes `input.usfm.footnote` (core/insert.ts) and the whole
 * insertion is one change, so the note begins where that change begins in the
 * NEW document. Reading it here rather than having the command say so keeps
 * the command headless: it runs against a state and knows nothing about rows,
 * satellites or the DOM.
 */
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
    // A note you have just made is a note you are about to write, so
    // `Insert footnote` opens its editor. Without this the gesture ended with
    // a caller in the text, an empty row at the foot of the chapter, and no
    // hint that either was the same note.
    const made = insertedNote(tr);
    if (made !== null) return made;
    // A note whose caller moved is still the same note; one that was deleted
    // outright closes the editor rather than pointing at the text beside it.
    if (held === null || !tr.docChanged) return held;
    return tr.changes.mapPos(held, 1);
  },
});

/** The note under the reader's caret in the apparatus, if any. */
const editingNote = (state: EditorState): number | null => state.field(editingField, false) ?? null;

/** How long the flash on a followed note lasts. */
const FLASH_MS = 900;

const rowFor = (view: EditorView, at: number): HTMLElement | null =>
  view.dom.querySelector(`.usfm-note[data-note-row="${String(at)}"]`);

/** Where the apparatus block holding this note sits in the document. */
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

/**
 * Tints the row a followed caller landed on.
 *
 * Retried for a few frames: the row is a widget inside a block CodeMirror has
 * only just been asked to scroll to, and it measures and draws asynchronously,
 * so the first frame after the dispatch usually has no row to find.
 */
const flashRow = (view: EditorView, at: number, tries = 12): void => {
  const row = rowFor(view, at);
  if (row === null) {
    if (tries > 0) requestAnimationFrame(() => flashRow(view, at, tries - 1));
    return;
  }
  row.classList.add("usfm-note-found");
  setTimeout(() => row.classList.remove("usfm-note-found"), FLASH_MS);
};

/**
 * The note's editable span: its CONTENT, not the whole `\f … \f*`.
 *
 * The opener, the caller sigil and the closer are markup — renaming `\ft` to
 * `\fq` is a USFM-mode edit, the same ruling the front matter card makes about
 * marker names — so the satellite is given the origin and the body and nothing
 * else. `buildNoteApparatus` hides whatever is left on the line around it.
 *
 * A note with no content parts at all — a note the engine could not close (the
 * `99-BAD` fixture has one), and every note the moment `Insert footnote` makes
 * it — gets a zero-width window where its body belongs. See below.
 */
const spanOf = (view: EditorView, at: number): { from: number; to: number } | null => {
  const note = structureAt(view.state).notes.find((row) => row.from === at);
  if (note === undefined) return null;
  const content = note.parts.filter(
    (part) => part.kind === NOTE_PART.ORIGIN || part.kind === NOTE_PART.BODY,
  );
  const first = content[0];
  const last = content[content.length - 1];
  if (first !== undefined && last !== undefined) return { from: first.from, to: last.to };
  // A note with NOTHING in it — which is every note the moment `Insert
  // footnote` makes one — has no origin part and no body part, so there is no
  // content to point at. The whole note was returned instead, and its end is
  // past the closing `\f*`: the reader's first keystroke landed OUTSIDE the
  // note, in the verse. The empty body's position is where the closer begins,
  // so that is the span — a zero-width window at exactly the place the text
  // belongs. Found by the closer's own extent rather than by spelling `\f*`
  // here, which is the engine's word and not the editor's.
  const closer = note.parts.findLast(
    (part) => part.kind === NOTE_PART.MARKUP && part.to === note.to,
  );
  const empty = closer?.from ?? note.to;
  return { from: empty, to: empty };
};

/**
 * Where the caret goes when the editor opens: the start of the note's text.
 *
 * Clamped into `span`, and never null — and that is not defensive tidying, it
 * was a bug with teeth. A note with nothing in it yet has no BODY part at all,
 * so this answered "nowhere", the satellite kept CodeMirror's default
 * selection of 0, and its first keystroke was submitted as an edit at offset
 * ZERO: the reader typed into a fresh footnote and the letter appeared at the
 * top of the book. The note then mapped one character to the right, its row no
 * longer matched, and the editor closed itself. The end of the span is the
 * honest fallback: it is where the body would be.
 */
const caretFor = (view: EditorView, at: number, span: { from: number; to: number }): number => {
  const note = structureAt(view.state).notes.find((row) => row.from === at);
  const body = note?.parts.find((part) => part.kind === NOTE_PART.BODY);
  const wanted = body === undefined ? span.to : body.from;
  return Math.min(span.to, Math.max(span.from, wanted));
};

/**
 * The surfaces, per view: at most one open note editor, and the clean-up that
 * goes with it.
 */
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
    // A row is a WIDGET, and CodeMirror rebuilds one when the block it lives
    // in moves — which an apparatus block does on every keystroke inside the
    // chapter, and which an undo forces outright. A rebuilt row takes the
    // mounted editor's parent element with it, leaving a view attached to
    // nothing: the reader's box vanished mid-note and this object went on
    // believing it was open. So a row that has left the document is not open,
    // whatever is held here, and the editor is mounted again on the new one.
    const orphaned = this.#open !== null && !this.#open.row.isConnected;
    if (this.#open?.at === want && !orphaned) return;
    this.#close();
    if (want === null) return;
    // After the update, not during it: the row's DOM is a widget CodeMirror may
    // not have drawn yet, mounting a view measures, and a plugin may not
    // dispatch into the update that is running it. Retried for a few frames for
    // the same reason `flashRow` is — a scrolled-to block is drawn
    // asynchronously, and the first frame after the dispatch has no row yet.
    this.#mountWhenDrawn(want, 20, true);
  }

  /**
   * Waits for the row to exist, scrolling to it once if it does not.
   *
   * The row is a widget in the apparatus block at the FOOT of the chapter, and
   * CodeMirror renders only what is on screen. A note reached by clicking its
   * own row is on screen by definition; one opened because the reader just
   * INSERTED it is half a chapter above its row, and there was nothing to
   * mount into — which is why a fresh footnote could not be typed in.
   */
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
      host: funnelFor(book),
      range: span,
      editable: true,
      // TRUSTED, for the same reason the front matter card is. In regular mode
      // the whole note is hidden markup, so `refuseKeystrokesInsideHiddenMarkup`
      // guards every offset in it and an untrusted satellite here is a text box
      // that silently refuses every key. This surface is narrow — one note's
      // origin and body, with the opener, the caller sigil and the closer left
      // out of its range — and its targets are hard-edged, which is the trade
      // that argument rests on. A marker rename is still a USFM-mode edit.
      trust: trustedBy("note"),
      label: `note:${String(at)}`,
      extensions: [
        // Through the facet, never `classList`: CodeMirror rewrites the
        // editor's class from `editorAttributes` on every update, so a class
        // added by hand survives until the first keystroke and no longer.
        EditorView.editorAttributes.of({ class: "cm-mode-regular cm-note" }),
        analyzer.of(this.#view.state.facet(analyzer)),
        // The structure only, NOT the whole reading layer. `readingLayer`
        // brings `decoField`, whose regular-mode projection is the one that
        // collapses a note to its caller — inside this view that would hide
        // the very text the reader clicked to write in.
        structureField,
        // The one note, unhidden: markup elided, the origin as `usfm-fr` and
        // the body as `usfm-ft`, which is the apparatus row's own vocabulary.
        //
        // The LIVE window, not the range this mount was given. The satellite
        // maps its own scope through every edit (`satellite.ts`), and a note
        // that started empty is a zero-width window that has to GROW with the
        // first character typed into it. Reading the closed-over `span` meant
        // the window stayed where it was and the reader's own text was hidden
        // from them the instant they wrote it.
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
    // Always, never conditionally: a satellite with no selection of its own
    // starts at offset 0, which in this view is the top of the whole book.
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

  /**
   * Writes the row's static text back from the document.
   *
   * The widget refuses to patch a row whose edit slot is occupied — otherwise
   * it would overwrite what the reader is typing mid-keystroke — and closing
   * the editor is not a decoration change, so nothing would ask it to patch
   * afterwards either. The row would keep showing the note as it was BEFORE
   * the edit until something else in the chapter happened to repaint.
   */
  #refresh(row: HTMLElement, at: number): void {
    const note = structureAt(this.#view.state).notes.find((held) => held.from === at);
    if (note === undefined) return;
    const doc = docText(this.#view.state);
    const set = (cls: string, text: string): void => {
      const span = row.querySelector<HTMLElement>(`.${cls}`);
      if (span !== null && span.textContent !== text) span.textContent = text;
    };
    set("usfm-note-ref", noteApparatusText(doc, note, NOTE_PART.ORIGIN));
    const body = row.querySelector<HTMLElement>(".usfm-note-body");
    if (body !== null) paintNoteBody(body, noteApparatusText(doc, note, NOTE_PART.BODY));
  }
}

/**
 * Which Book this view is bound to.
 *
 * The satellite needs a `Funnel`, and a Funnel is made from the editor-backed
 * Book — not from the view. The binding is recorded by `bookOfView` below,
 * which `editorBook` fills in when it binds a view.
 */
const books = new WeakMap<EditorView, EditorBook>();

/** Told which Book a mounted view belongs to; see `EditorBook.bindView`. */
export const noteBookIs = (view: EditorView, book: EditorBook): (() => void) => {
  books.set(view, book);
  return () => {
    books.delete(view);
  };
};

const noteBook = (view: EditorView): EditorBook | undefined => books.get(view);

/**
 * The toggler the widgets call. One implementation for every view — the view is
 * an argument, so there is no per-view state to keep here.
 */
setNoteToggler((view: EditorView, at: number, how: NoteGesture) => {
  if (how === "edit") {
    view.dispatch({ effects: setEditing.of(at) });
    return;
  }
  if (how === "back") {
    // The caller is where the note is anchored, which IS the note's offset.
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
