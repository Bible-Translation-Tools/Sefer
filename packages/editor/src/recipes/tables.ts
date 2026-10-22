import { Compartment, type Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { structureAt } from "../core/editorState";

/**
 * Tables' aligned columns, an opt-in feature (`editorFeatures`). The registry
 * draws every table (a row a line, cells with separators) with no help; what
 * this adds is the measured layout, which is the one part loaded lazily: the
 * first time the book has a row, `tableLayout` is imported and installed
 * through a compartment. Drawing never waits on the import; until it lands a
 * table is merely unaligned.
 */
export function tables(): Extension {
  const slot = new Compartment();
  const hasTable = (view: EditorView): boolean => {
    const blocks = structureAt(view.state).blocks;
    for (let i = 0; i < blocks.length; i++) if (blocks.clsAt(i) === "table") return true;
    return false;
  };
  const loader = ViewPlugin.fromClass(
    class {
      #asked = false;
      constructor(view: EditorView) {
        this.#load(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged) this.#load(update.view);
      }
      #load(view: EditorView) {
        if (this.#asked || !hasTable(view)) return;
        this.#asked = true;
        void import("./tableLayout").then(({ tableLayout }) => {
          if (view.dom.isConnected) view.dispatch({ effects: slot.reconfigure(tableLayout()) });
        });
      }
    },
  );
  return [slot.of([]), loader];
}
