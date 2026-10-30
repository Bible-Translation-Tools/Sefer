import { type EditorState, type Extension, StateField } from "@codemirror/state";
import { showTooltip, type Tooltip } from "@codemirror/view";

import { footnoteAt } from "../core/commands/insert";
import { isVisual } from "../core/kernel";

/**
 * A Footnote button over a selection in the reading view, an opt-in feature
 * (`editorFeatures`): pressing it puts an empty note at the selection's end
 * and opens it at its letter. `label` is the host's word for it.
 */
export const footnoteButton = (label = "Footnote"): Extension =>
  StateField.define<readonly Tooltip[]>({
    create: (state) => tooltipsFor(state, label),
    update: (held, tr) =>
      tr.docChanged || tr.selection !== undefined ? tooltipsFor(tr.state, label) : held,
    provide: (field) => showTooltip.computeN([field], (state) => state.field(field)),
  });

function tooltipsFor(state: EditorState, label: string): readonly Tooltip[] {
  const sel = state.selection.main;
  if (sel.empty || state.readOnly || !isVisual(state)) return [];
  return [
    {
      pos: sel.to,
      above: true,
      arrow: false,
      create: (view) => {
        const dom = document.createElement("div");
        dom.className = "usfm-footnote-button";
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        // A press must not move the selection the note is placed after.
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", () => {
          view.dispatch(footnoteAt(view.state));
        });
        dom.append(button);
        return { dom };
      },
    },
  ];
}
