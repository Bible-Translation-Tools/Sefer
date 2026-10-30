import { StateEffect, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

import { pickField, visibleClipAt } from "./guards/clip";
import { isVisual, modeFacet, trusted } from "./kernel";
import { structureField, type DocStructure } from "./model/docStructure";
import { blockHost } from "./paint/blockHost";
import { inPlaceWords } from "./paint/inPlace";
import { phrase } from "./words";

const FRONT_MARKERS = [
  "id",
  "ide",
  "usfm",
  "h",
  "toc1",
  "toc2",
  "toc3",
  "toca1",
  "toca2",
  "toca3",
  "mt",
  "mt1",
  "mt2",
  "mt3",
] as const;

const FRONT = new Set<string>(FRONT_MARKERS);

const LABELS: Record<string, string> = {
  id: "Book",
  ide: "Encoding",
  usfm: "USFM",
  h: "Running head",
  toc1: "Long name",
  toc2: "Short name",
  toc3: "Abbreviation",
  toca1: "Long name (alt)",
  toca2: "Short name (alt)",
  toca3: "Abbreviation (alt)",
  mt: "Main title",
  mt1: "Main title",
  mt2: "Subtitle",
  mt3: "Subtitle",
};

interface FrontRow {
  readonly marker: string;
  readonly label: string;
  readonly value: string;
  readonly from: number;
  readonly to: number;
  readonly valueFrom: number;
}

function frontMatterRows(state: EditorState, structure: DocStructure): FrontRow[] {
  const out: FrontRow[] = [];
  const doc = state.doc;
  for (let i = 0; i < structure.lines.length; i++) {
    const line = structure.lines.at(i);
    const marker = line.marker;
    if (marker === null) {
      if (doc.sliceString(line.from, line.to).trim() === "") continue;
      break;
    }
    if (!FRONT.has(marker)) break;
    out.push({
      marker,
      label: LABELS[marker] ?? `\\${marker}`,
      value: doc.sliceString(line.contentFrom, line.to),
      from: line.from,
      to: line.to,
      valueFrom: line.contentFrom,
    });
  }
  return out;
}

const cleanValue = (s: string): string => s.replace(/[\\\n\r]+/g, " ").replace(/\s+$/, "");

const rowsKey = (rows: readonly FrontRow[]): string => rows.map((r) => r.marker).join("|");

const valuesKey = (rows: readonly FrontRow[]): string => rows.map((r) => r.value).join("\u0000");

class FrontMatterWidget extends WidgetType {
  readonly rows: readonly FrontRow[];

  constructor(rows: readonly FrontRow[]) {
    super();
    this.rows = rows;
  }

  eq(other: FrontMatterWidget): boolean {
    return (
      rowsKey(this.rows) === rowsKey(other.rows) && valuesKey(this.rows) === valuesKey(other.rows)
    );
  }

  ignoreEvent(): boolean {
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const card = document.createElement("div");
    card.className = "usfm-frontcard";
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", "Book front matter");
    for (let i = 0; i < this.rows.length; i++) card.append(this.#field(view, i));
    return blockHost(card);
  }

  updateDOM(dom: HTMLElement, _view: EditorView): boolean {
    const inputs = dom.querySelectorAll<HTMLInputElement>(".usfm-front-input");
    if (inputs.length !== this.rows.length) return false;
    for (let i = 0; i < this.rows.length; i++) {
      const input = inputs[i];
      const row = this.rows[i];
      if (input.dataset.marker !== row.marker) return false;
      if (document.activeElement === input) continue;
      if (input.value !== row.value) input.value = row.value;
    }
    return true;
  }

  #field(view: EditorView, index: number): HTMLElement {
    const row = this.rows[index];
    const label = document.createElement("label");
    label.className = "usfm-front-row";

    const name = document.createElement("span");
    name.className = "usfm-front-label";
    name.textContent = row.label;
    name.title = `\\${row.marker} — marker names are locked; use USFM mode to change one`;

    const input = document.createElement("input");
    input.className = "usfm-front-input";
    input.dataset.marker = row.marker;
    input.dataset.index = String(index);
    input.value = row.value;
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("aria-label", `${row.label} (\\${row.marker})`);
    input.onchange = () => {
      write(view, index, row.marker, cleanValue(input.value));
    };
    input.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        input.value = row.value;
        view.focus();
      }
    };

    label.append(name, input);
    return label;
  }
}

function write(view: EditorView, index: number, marker: string, value: string): void {
  const rows = frontMatterRows(view.state, view.state.field(structureField));
  const row = rows[index];
  if (row === undefined || row.marker !== marker) return;
  if (row.value === value) return;
  view.dispatch({
    changes: { from: row.valueFrom, to: row.to, insert: value },
    userEvent: "input.usfm.frontmatter",
    annotations: trusted.of("frontmatter"),
  });
}

/**
 * The book's name, at the top of the text in Reading even when one chapter is
 * shown, typed into where it reads (Thomas, 2026-10-30). One name, written to
 * each marker that carries it: the main title, the long name and the running
 * head (`\mt1`, `\toc1`, `\h`); one the book lacks is added after its header.
 * An open ruling: the product owner had the whole header hidden in the normal
 * view (`cardDecorations`); this shows the name alone.
 */
const NAME_MARKERS = ["h", "toc1", "mt1"] as const;

function bookName(rows: readonly FrontRow[]): string {
  for (const marker of ["mt1", "mt", "h", "toc1"]) {
    const row = rows.find((r) => r.marker === marker && r.value.trim() !== "");
    if (row !== undefined) return cleanValue(row.value).trim();
  }
  return "";
}

function writeBookName(view: EditorView, name: string): void {
  const rows = frontMatterRows(view.state, view.state.field(structureField));
  const changes: { from: number; to: number; insert: string }[] = [];
  const missing: string[] = [];
  for (const marker of NAME_MARKERS) {
    const row =
      rows.find((r) => r.marker === marker) ??
      (marker === "mt1" ? rows.find((r) => r.marker === "mt") : undefined);
    if (row === undefined) missing.push(marker);
    else if (row.value !== name) changes.push({ from: row.valueFrom, to: row.to, insert: name });
  }
  if (missing.length > 0) {
    const at = rows.length === 0 ? 0 : rows[rows.length - 1].to;
    const lines = missing.map((marker) => `\\${marker} ${name}`);
    changes.push({
      from: at,
      to: at,
      insert: rows.length === 0 ? `${lines.join("\n")}\n` : `\n${lines.join("\n")}`,
    });
  }
  if (changes.length === 0) return;
  view.dispatch({
    changes,
    userEvent: "input.usfm.bookName",
    annotations: trusted.of("book-name"),
  });
}

class BookNameWidget extends WidgetType {
  constructor(readonly name: string) {
    super();
  }
  eq(other: BookNameWidget): boolean {
    return other.name === this.name;
  }
  ignoreEvent(): boolean {
    return true;
  }
  toDOM(view: EditorView): HTMLElement {
    const title = document.createElement("div");
    title.className = "usfm-book-name";
    const words = inPlaceWords({
      value: this.name,
      className: "usfm-book-name-words",
      placeholder: phrase(view.state, "bookName.placeholder"),
      commit: (typed, span) => {
        if (typed === "") span.textContent = this.name;
        else writeBookName(view, typed);
      },
    });
    title.append(words);
    return blockHost(title);
  }
}

function nameDecorations(state: EditorState): DecorationSet {
  if (!isVisual(state)) return Decoration.none;
  const structure = state.field(structureField, false);
  if (structure === undefined) return Decoration.none;
  const clip = visibleClipAt(state);
  const at = clip === null ? 0 : clip.from;
  const widget = new BookNameWidget(bookName(frontMatterRows(state, structure)));
  return Decoration.set([Decoration.widget({ widget, block: true, side: -1 }).range(at)]);
}

/** Ask the card to take focus — `editor.frontmatter.edit`. */
export const focusFrontMatter = StateEffect.define<null>();

function cardDecorations(state: EditorState): DecorationSet {
  if (!isVisual(state)) return Decoration.none;
  const structure = state.field(structureField, false);
  if (structure === undefined) return Decoration.none;
  const rows = frontMatterRows(state, structure);
  if (rows.length === 0) return Decoration.none;
  const from = rows[0].from;
  const to = rows[rows.length - 1].to;
  // Hidden, not drawn: the product owner's ruling is that the book's header
  // never appears in the normal view. USFM mode still shows it as markup.
  // The card (`FrontMatterWidget`) is kept for the day that ruling changes.
  void FrontMatterWidget;
  return Decoration.set([Decoration.replace({ block: true }).range(from, to)]);
}

const frontMatterFocus = ViewPlugin.fromClass(
  class {
    #view: EditorView;

    constructor(view: EditorView) {
      this.#view = view;
    }

    update(update: ViewUpdate): void {
      const asked = update.transactions.some((tr) =>
        tr.effects.some((effect) => effect.is(focusFrontMatter)),
      );
      if (!asked) return;
      const view = this.#view;
      setTimeout(() => {
        if (!view.dom.isConnected) return;
        const first = view.dom.querySelector<HTMLInputElement>(".usfm-front-input");
        first?.focus();
        first?.select();
      }, 0);
    }
  },
);

/**
 * The card, as one extension. Mounted by `BookEditor`, so a headless state (a
 * Book with no view, a satellite) never pays for it.
 */
export const frontMatterCard = (): Extension => [
  hiddenFrontMatter(),
  EditorView.decorations.compute(["doc", structureField, modeFacet, pickField], nameDecorations),
  frontMatterFocus,
];

/**
 * The book's header, hidden in regular mode — on the book being refined and on
 * every read-only gateway pane beside it alike, because the ruling is "nowhere
 * in the normal view", not "nowhere editable".
 */
export const hiddenFrontMatter = (): Extension =>
  EditorView.decorations.compute(["doc", structureField, modeFacet], cardDecorations);
