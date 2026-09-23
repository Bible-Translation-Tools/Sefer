// fallow-ignore-file unused-file -- kept for the browser-mode editor tests that will want it.
/**
 * The mounted test surface: a real `EditorView` in a real DOM, for the questions
 * only layout can answer (bidi, measurement, atomic ranges under a caret).
 *
 * Everything that can be asserted headlessly should be; this is for the rest.
 */

import { EditorView } from "@codemirror/view";

import { usfmEditor } from "../core/compose";
import { KEYMAP, type SurfaceOptions, USFM_KEYS, surface } from "./harness";

import "../editor.css";

export interface Mounted {
  view: EditorView;
  destroy(): void;
}

export const DIRECTIONS = ["ltr", "rtl"] as const;
export type Dir = (typeof DIRECTIONS)[number];

export function mount(doc: string, o: Omit<SurfaceOptions, "layers"> & { dir?: Dir }): Mounted {
  const parent = document.createElement("div");
  parent.className = "cm-host";
  parent.style.width = "900px";
  parent.style.height = "700px";
  document.body.appendChild(parent);

  const view = new EditorView({
    state: surface(doc, {
      ...o,
      layers: usfmEditor,
      extensions: [
        ...(o.extensions ?? []),
        EditorView.contentAttributes.of({ dir: o.dir ?? "ltr" }),
      ],
    }),
    parent,
  });
  view.dom.classList.add("cm-mode-regular");
  view.requestMeasure();
  return {
    view,
    destroy() {
      view.destroy();
      parent.remove();
    },
  };
}

export type Handler = "usfm" | "codemirror" | "none";

export function pressKeyIn(view: EditorView, key: string): Handler {
  for (const b of KEYMAP) {
    if (b.key !== key || !b.run) continue;
    if (b.run(view)) return OURS.has(b.run) ? "usfm" : "codemirror";
  }
  return "none";
}

const OURS = new Set(USFM_KEYS.map((b) => b.run));

export const flushLayout = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

export function caretTo(view: EditorView, pos: number): void {
  view.dispatch({ selection: { anchor: pos } });
}
