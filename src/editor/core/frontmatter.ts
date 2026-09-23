/**
 * The front matter card: `\id`, `\ide`, `\h`, `\toc1-3` and `\mt*` shown in
 * regular mode as labelled fields instead of as lines of markup.
 *
 * Same shape as the aligned-word popover (`recipes/attrs.ts`): the marker name
 * is a LOCKED label and only the value is editable, because a marker is spec
 * vocabulary and renaming one silently changes what the line means. Changing
 * `\h` to `\toc2` is a USFM-mode edit, on purpose.
 *
 * Three decisions worth stating:
 *
 *  - **One block widget, not a Solid island.** The card has to know the
 *    document's offsets on every keystroke and must not hold a second copy of
 *    the text; a CodeMirror widget over the canonical state is already that,
 *    and mounting Solid into it would add a second subscription to the book
 *    for no gain (shell.md's single-subscription rule).
 *  - **Each field writes exactly its own line's value span**, `[contentFrom,
 *    to)`, as one change through the view — so it reaches `book.fromView`,
 *    publishes one receipt, and is one Undo step.
 *  - **The write is `trusted`.** Front matter sits before the first `\c`, so
 *    while the reader is clipped to a chapter `refuseEditsOutsideTheClip`
 *    would refuse every card edit. The card is a structured surface with
 *    hard-edged targets — the same argument that makes the attrs popover
 *    trusted — so it says so rather than being silently inert.
 *
 * The widget updates its inputs IN PLACE (`updateDOM`) rather than being
 * rebuilt, because a rebuild between "type" and "blur" would drop the caret
 * out of the field the reader is using.
 */

import { StateEffect, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

import { structureField, type DocStructure } from "./docStructure";
import { isVisual, modeFacet, trusted } from "./kernel";

/**
 * The markers the card owns, in the order USFM writes them. A line whose
 * marker is not on this list ends the front matter, and so does `\c`: the card
 * is the book's header, not everything before chapter one.
 */
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

/** What each marker is called, for the label. Unknown markers show the marker. */
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
  /** The marker as written, no backslash. */
  readonly marker: string;
  readonly label: string;
  readonly value: string;
  /** The whole line. */
  readonly from: number;
  readonly to: number;
  /** The value span this field writes — after the marker and its delimiter. */
  readonly valueFrom: number;
}

/**
 * The header lines, read off the structure.
 *
 * Stops at the first line that is neither blank nor a front marker, so a book
 * whose `\mt` is followed by `\c 1` gives six rows and a book with an
 * introduction gives the same six — `\ip` is content, and content is the
 * editor's job, not the card's.
 */
function frontMatterRows(state: EditorState, s: DocStructure): FrontRow[] {
  const out: FrontRow[] = [];
  const doc = state.doc;
  for (let i = 0; i < s.lines.length; i++) {
    const line = s.lines.at(i);
    const marker = line.marker;
    if (marker === null) {
      // A blank line between header lines is layout, not a boundary; anything
      // else (text with no marker) is content and ends the header.
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

/** The value a field may write: one line, no markup sigil, no quote games. */
const cleanValue = (s: string): string => s.replace(/[\\\n\r]+/g, " ").replace(/\s+$/, "");

const rowsKey = (rows: readonly FrontRow[]): string => rows.map((r) => r.marker).join("|");

const valuesKey = (rows: readonly FrontRow[]): string => rows.map((r) => r.value).join("\u0000");

class FrontMatterWidget extends WidgetType {
  readonly rows: readonly FrontRow[];

  constructor(rows: readonly FrontRow[]) {
    super();
    this.rows = rows;
  }

  /**
   * Same markers AND same values is the same widget. A different value goes to
   * `updateDOM`, which patches the inputs the reader is not in; a different
   * marker list rebuilds, because the fields themselves changed.
   */
  eq(other: FrontMatterWidget): boolean {
    return (
      rowsKey(this.rows) === rowsKey(other.rows) && valuesKey(this.rows) === valuesKey(other.rows)
    );
  }

  /**
   * The card is one focus region of its own. `ignoreEvent` keeps CodeMirror
   * from treating a click in a field as a click in the document — the document
   * position under the card is markup the card exists to replace.
   */
  ignoreEvent(): boolean {
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement("div");
    dom.className = "usfm-frontcard";
    dom.setAttribute("role", "group");
    dom.setAttribute("aria-label", "Book front matter");
    for (let i = 0; i < this.rows.length; i++) dom.append(this.#field(view, i));
    return dom;
  }

  updateDOM(dom: HTMLElement, _view: EditorView): boolean {
    const inputs = dom.querySelectorAll<HTMLInputElement>(".usfm-front-input");
    if (inputs.length !== this.rows.length) return false;
    for (let i = 0; i < this.rows.length; i++) {
      const input = inputs[i];
      const row = this.rows[i];
      if (input.dataset.marker !== row.marker) return false;
      // Never overwrite what the reader is typing; the field owns its value
      // until it blurs, and the blur is what writes.
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

/**
 * One field's write.
 *
 * The span is resolved from the CURRENT state by position in the row list
 * rather than from the offsets the widget was built with: between building the
 * card and blurring a field, an edit elsewhere in the book may have moved
 * every offset, and writing a stale one would land in the wrong line.
 */
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
  const s = state.field(structureField, false);
  if (s === undefined) return Decoration.none;
  const rows = frontMatterRows(state, s);
  if (rows.length === 0) return Decoration.none;
  const from = rows[0].from;
  const to = rows[rows.length - 1].to;
  return Decoration.set([
    Decoration.replace({ widget: new FrontMatterWidget(rows), block: true }).range(from, to),
  ]);
}

/**
 * The focus door. A `ViewPlugin` and not a command, because focusing is a DOM
 * act and the widget's inputs only exist once the card has been drawn — the
 * effect may arrive in the same transaction that created it.
 */
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
 * Book with no view, a window, a satellite) never pays for it.
 */
export const frontMatterCard = (): Extension => [
  EditorView.decorations.compute(["doc", structureField, modeFacet], cardDecorations),
  frontMatterFocus,
];
