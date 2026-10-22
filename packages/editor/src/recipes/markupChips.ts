import { type Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

import { decoField } from "../core/editorState";
import { featureAtoms } from "../core/stops";
import { type UnsupportedMarkup, unsupportedMarkup } from "../core/unsupported";

/** How a chip is drawn: the default is a small labelled box; a host may draw its own. */
export type ChipRenderer = (markup: UnsupportedMarkup) => HTMLElement;

/**
 * The default chip: a small labelled box. Two markers read better drawn: a
 * page break is a thin rule across the line, and a published chapter's
 * marker becomes the caption's "published as" (its line is styled too, in
 * `build`).
 */
const defaultChip: ChipRenderer = (markup) => {
  const chip = document.createElement("span");
  chip.title = markup.text.trim();
  if (markup.marker === "pb") {
    chip.className = "usfm-chip-pb";
    chip.textContent = "page break";
    return chip;
  }
  if (markup.marker === "cp") {
    chip.className = "usfm-chip-cp";
    chip.textContent = "published as";
    return chip;
  }
  chip.className = markup.closing ? "usfm-chip usfm-chip-end" : "usfm-chip";
  chip.textContent = markup.label;
  return chip;
};

const CP_LINE = Decoration.line({ class: "usfm-cp" });

class ChipWidget extends WidgetType {
  constructor(
    readonly markup: UnsupportedMarkup,
    readonly render: ChipRenderer,
  ) {
    super();
  }
  eq(other: ChipWidget) {
    return other.markup.text === this.markup.text && other.markup.label === this.markup.label;
  }
  toDOM() {
    return this.render(this.markup);
  }
  ignoreEvent() {
    return false;
  }
}

/**
 * Reading never shows a backslash: markup the editor has no drawing for yet
 * (a table's row and cell markers, `\fig`, `\esb`, `\pb`, a stray `\cat`, an
 * unknown marker) is replaced by a small labelled chip the caret steps over
 * whole, and edited in USFM mode. Generic on purpose: what to chip is read
 * off the editor's own decorations (`core/unsupported.ts`), so a marker that
 * later gets a real drawing stops being chipped with no change here.
 *
 * An opt-in feature (`editorFeatures`). `render` replaces the default chip;
 * a host that wants no chips at all leaves the feature out and reads
 * `BookEditorMount.unsupportedMarkup` instead.
 */
export function markupChips(render: ChipRenderer = defaultChip): Extension {
  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    for (const { from, to } of view.visibleRanges)
      for (const markup of unsupportedMarkup(view.state, from, to)) {
        if (markup.marker === "cp" && render === defaultChip) {
          const line = view.state.doc.lineAt(markup.from);
          if (line.from === markup.from) builder.add(line.from, line.from, CP_LINE);
        }
        builder.add(
          markup.from,
          markup.to,
          Decoration.replace({ widget: new ChipWidget(markup, render) }),
        );
      }
    return builder.finish();
  };

  const chips = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(update: ViewUpdate) {
        const redrawn =
          update.state.field(decoField, false) !== update.startState.field(decoField, false);
        if (update.docChanged || update.viewportChanged || redrawn)
          this.decorations = build(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );

  return [
    chips,
    featureAtoms.of(unsupportedMarkup),
    EditorView.atomicRanges.of((view) => view.plugin(chips)?.decorations ?? Decoration.none),
  ];
}
