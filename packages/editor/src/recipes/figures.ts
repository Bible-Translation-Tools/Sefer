import { type Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

import { attributesAt } from "../core/attributes";
import { decoField } from "../core/editorState";
import { type Figure, figuresIn } from "../core/figures";
import { featureAtoms } from "../core/stops";
import { drawnByFeature } from "../core/unsupported";
import { markerWords } from "../core/words";

/** Where a figure's picture is, from its `src`: a URL to show, or `undefined` for none. */
export type FigureSource = (src: string) => string | undefined;

export interface FiguresOptions {
  /** Resolves `src` to a picture; none by default, so a figure shows its file name. */
  readonly resolveSource?: FigureSource;
}

/**
 * USFM's `size`: `col` is one text column, `span` the page's width. Drawn as
 * half the editor's width and its whole width; anything else as `col`.
 */
const sizeOf = (size: string | undefined): "col" | "span" => (size === "span" ? "span" : "col");

class FigureBadge extends WidgetType {
  constructor(
    readonly picture: string | undefined,
    readonly size: "col" | "span",
    readonly title: string,
  ) {
    super();
  }
  eq(other: FigureBadge) {
    return other.picture === this.picture && other.size === this.size && other.title === this.title;
  }
  toDOM(view: EditorView) {
    const figure = document.createElement("span");
    figure.className = "usfm-fig";
    figure.dataset.size = this.size;
    figure.title = this.title;
    if (this.picture !== undefined) {
      const image = document.createElement("img");
      image.src = this.picture;
      image.alt = "";
      image.draggable = false;
      figure.append(image);
    } else {
      const frame = document.createElement("span");
      frame.className = "usfm-fig-frame";
      frame.textContent = markerWords(view.state, "fig", false);
      figure.append(frame);
    }
    return figure;
  }
  ignoreEvent() {
    return false;
  }
}

const CAPTION = Decoration.mark({ class: "usfm-fig-caption" });
const HIDDEN = Decoration.replace({});

/** The spans a figure's drawing replaces: its marker, and its attributes with its closer. */
const replaced = (figure: Figure): { from: number; to: number }[] => [
  { from: figure.from, to: figure.captionFrom },
  { from: figure.captionTo, to: figure.to },
];

/**
 * Figures, an opt-in feature (`editorFeatures`): `\fig Caption|src=… \fig*`
 * draws as the picture on its own row (when `resolveSource` finds one, else a
 * frame), as wide as its `size` says, with the caption under it as ordinary,
 * editable text. The
 * marker, the attributes and the closer are hidden, and the caret steps over
 * each whole; a press on the badge opens the attribute popover, where `src`,
 * `size` and `ref` are edited. The data is `core/figures.ts`.
 */
export function figures(options: FiguresOptions = {}): Extension {
  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    for (const { from, to } of view.visibleRanges)
      for (const figure of figuresIn(view.state, from, to)) {
        const attributes = attributesAt(view.state, figure.from)?.attributes ?? [];
        const src = attributes.find((a) => a.name === "src")?.value ?? "";
        const size = sizeOf(attributes.find((a) => a.name === "size")?.value);
        const title = attributes.map((a) => `${a.name ?? "default"}: ${a.value}`).join("\n");
        const picture = src === "" ? undefined : options.resolveSource?.(src);
        builder.add(
          figure.from,
          figure.captionFrom,
          Decoration.replace({ widget: new FigureBadge(picture, size, title) }),
        );
        if (figure.captionTo > figure.captionFrom)
          builder.add(figure.captionFrom, figure.captionTo, CAPTION);
        builder.add(figure.captionTo, figure.to, HIDDEN);
      }
    return builder.finish();
  };

  const drawing = ViewPlugin.fromClass(
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

  const spans = (state: Parameters<typeof figuresIn>[0], from: number, to: number) =>
    figuresIn(state, from, to).flatMap(replaced);

  return [
    drawing,
    drawnByFeature.of((state, from, to) =>
      figuresIn(state, from, to).map((f) => ({ from: f.from, to: f.to })),
    ),
    featureAtoms.of(spans),
    EditorView.atomicRanges.of((view) => {
      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges)
        for (const span of spans(view.state, from, to))
          if (span.to > span.from) builder.add(span.from, span.to, HIDDEN);
      return builder.finish();
    }),
  ];
}
