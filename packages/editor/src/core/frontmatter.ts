import { StateEffect, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

import { blockHost } from "./blockHost";
import { structureField, type DocStructure } from "./docStructure";
import { isVisual, modeFacet, trusted } from "./kernel";

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
  return Decoration.set([
    Decoration.replace({ widget: new FrontMatterWidget(rows), block: true }).range(from, to),
  ]);
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
  EditorView.decorations.compute(["doc", structureField, modeFacet], cardDecorations),
  frontMatterFocus,
];
