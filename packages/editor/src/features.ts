import type { Extension } from "@codemirror/state";

import { attributePopover } from "./recipes/attributePopover";
import { type FigureSource, type FiguresOptions, figures } from "./recipes/figures";
import { type ChipRenderer, markupChips } from "./recipes/markupChips";
import { verseMenu } from "./recipes/verseMenu";

/**
 * An opinionated piece of UI a host opts into. The behaviour and the data
 * under each one are always in the package, as commands and queries on the
 * mount (`renumberVerse`, `attributesAt`, `setAttributes`…); a feature is one
 * UI over them. A host passes the ones it wants to `mountBookEditor`; one
 * that passes none gets the editor with no menus and no popovers.
 */
export type EditorFeature = Extension;

export {
  attributePopover,
  figures,
  markupChips,
  verseMenu,
  type ChipRenderer,
  type FigureSource,
  type FiguresOptions,
};

/** What `editorFeatures` passes on to the features that take options. */
export interface FeatureOptions {
  readonly figures?: FiguresOptions;
  readonly chips?: ChipRenderer;
}

/** Every feature, as Sefer mounts the editor: CodeMirror's `basicSetup`, for this editor. */
export const editorFeatures = (options: FeatureOptions = {}): readonly EditorFeature[] => [
  verseMenu(),
  attributePopover(),
  figures(options.figures),
  markupChips(options.chips),
];
