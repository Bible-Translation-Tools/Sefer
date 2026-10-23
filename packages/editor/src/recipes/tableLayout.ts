import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

import { docText, structureAt } from "../core/docStructure";

/**
 * Tables' columns, aligned: loaded only when a book has a table (`tables`).
 *
 * Measured, not mutated. CodeMirror owns its DOM and rewrites lines as it
 * pleases, so nothing here touches a cell's element. In the measure phase
 * each cell's words are measured with a canvas (`measureText`, the font read
 * once from a drawn cell), each column takes its table's widest cell, and the
 * widths go back as CSS variables on the rows' lines (`--usfm-col-1: 112px`),
 * as line decorations this module owns. A cell's `min-width` reads its
 * column's variable (`editor.css`). Measured again only when the text or the
 * visible range changes.
 */

/** One row's line and the column widths its table takes. */
interface RowWidths {
  readonly line: number;
  readonly style: string;
}

const setWidths = StateEffect.define<readonly RowWidths[]>();

const widthsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    for (const effect of tr.effects)
      if (effect.is(setWidths)) {
        const builder = new RangeSetBuilder<Decoration>();
        for (const row of effect.value)
          builder.add(row.line, row.line, Decoration.line({ attributes: { style: row.style } }));
        return builder.finish();
      }
    return tr.docChanged ? set.map(tr.changes) : set;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * A cell's words as drawn, its markup out: spaces kept, since the drawn cell
 * holds the space before the next cell's marker too.
 */
const wordsOf = (text: string): string =>
  text.replace(/\\[+]?[A-Za-z][\w-]*\*?\s?/g, "").replace(/\|[^\\]*/g, "");

interface Row {
  readonly from: number;
  readonly cells: readonly {
    readonly col: number;
    readonly header: boolean;
    readonly text: string;
  }[];
}

/** The tables in `[from, to)`: runs of row lines, each row's cells with their words. */
function tablesIn(state: EditorState, from: number, to: number): Row[][] {
  const structure = structureAt(state);
  const doc = docText(state);
  const tables: Row[][] = [];
  let current: Row[] = [];
  let lastTo = -2;
  for (let i = 0; i < structure.blocks.length; i++) {
    if (structure.blocks.clsAt(i) !== "table") continue;
    const blockFrom = structure.blocks.fromAt(i);
    const blockTo = structure.blocks.toAt(i);
    if (blockTo < from || blockFrom > to) continue;
    const line = state.doc.lineAt(blockFrom);
    const cells = structure.lines.at(line.number - 1).cells;
    const row: Row = {
      from: line.from,
      cells: cells.map((cell, at) => {
        const spelled = /^\\t([hc])[rc]?(\d*)/.exec(doc.slice(cell.from, cell.to));
        return {
          col: Number(spelled?.[2] || String(at + 1)),
          header: spelled?.[1] === "h",
          text: wordsOf(doc.slice(cell.to, cells[at + 1]?.from ?? line.to)),
        };
      }),
    };
    if (line.from > lastTo + 1 && current.length > 0) {
      tables.push(current);
      current = [];
    }
    current.push(row);
    lastTo = line.to;
  }
  if (current.length > 0) tables.push(current);
  return tables;
}

let canvas: CanvasRenderingContext2D | null = null;
const measure = (text: string, font: string): number => {
  canvas ??= document.createElement("canvas").getContext("2d");
  if (canvas === null) return 0;
  canvas.font = font;
  return Math.ceil(canvas.measureText(text).width);
};

const fontOf = (view: EditorView, header: boolean): string => {
  const cell = view.contentDOM.querySelector<HTMLElement>(
    header ? ".usfm-cell.usfm-cell-head" : ".usfm-cell:not(.usfm-cell-head)",
  );
  const style = getComputedStyle(cell ?? view.contentDOM);
  return style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
};

const layout = ViewPlugin.fromClass(
  class {
    #shown = "";
    constructor(readonly view: EditorView) {
      this.#schedule();
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.geometryChanged) this.#schedule();
    }
    #schedule() {
      this.view.requestMeasure({
        key: this,
        read: (view) => {
          const { from, to } = view.viewport;
          const plain = fontOf(view, false);
          const bold = fontOf(view, true);
          const rows: RowWidths[] = [];
          for (const table of tablesIn(view.state, from, to)) {
            const widths = new Map<number, number>();
            for (const row of table)
              for (const cell of row.cells) {
                const width = measure(cell.text, cell.header ? bold : plain);
                widths.set(cell.col, Math.max(widths.get(cell.col) ?? 0, width));
              }
            const style = [...widths]
              .map(([col, width]) => `--usfm-col-${col}: ${width}px`)
              .join("; ");
            for (const row of table) rows.push({ line: row.from, style });
          }
          return rows;
        },
        write: (rows, view) => {
          const key = JSON.stringify(rows);
          if (key === this.#shown) return;
          this.#shown = key;
          // Outside the measure phase: an update may not start inside one.
          queueMicrotask(() => {
            if (view.dom.isConnected) view.dispatch({ effects: setWidths.of(rows) });
          });
        },
      });
    }
  },
);

/** The measured column layout: the module `tables()` loads when a book has a table. */
export const tableLayout = (): Extension => [widthsField, layout];
