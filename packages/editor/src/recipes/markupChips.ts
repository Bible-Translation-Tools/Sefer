import type { Extension } from "@codemirror/state";

import { type ChipRenderer, chipRenderer } from "../core/unsupported";
import { phrase } from "../core/words";

export type { ChipRenderer };

/**
 * The richer chip: a labelled box, and two markers that read better drawn —
 * a page break as a thin rule across the line, a published chapter's marker
 * as the caption's "published as" (its line is styled by the core).
 */
const richChip: ChipRenderer = (markup, view) => {
  const chip = document.createElement("span");
  chip.title = markup.text.trim();
  if (markup.marker === "pb") {
    chip.className = "usfm-chip-pb";
    chip.textContent = phrase(view.state, "chip.pageBreak");
    return chip;
  }
  if (markup.marker === "cp") {
    chip.className = "usfm-chip-cp";
    chip.textContent = phrase(view.state, "chip.publishedAs");
    return chip;
  }
  chip.className = markup.closing ? "usfm-chip usfm-chip-end" : "usfm-chip";
  chip.textContent = markup.label;
  return chip;
};

/**
 * How unruled markup is drawn, an opt-in feature (`editorFeatures`). The
 * registry's `unruled` class makes every such marker one point the caret
 * steps over and a press deletes whole, drawn as a plain label; this
 * installs the richer chip, or a host's own `render`.
 */
export function markupChips(render: ChipRenderer = richChip): Extension {
  return chipRenderer.of(render);
}
