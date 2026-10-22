import type { Extension } from "@codemirror/state";

import { figureSource } from "../core/figures";

/** Where a figure's picture is, from its `src`: a URL to show, or `undefined` for none. */
export type FigureSource = (src: string) => string | undefined;

export interface FiguresOptions {
  /** Resolves `src` to a picture; none by default, so a figure draws a frame. */
  readonly resolveSource?: FigureSource;
}

/**
 * Figures' pictures, an opt-in feature (`editorFeatures`). The registry's
 * `figure` class draws every figure, picture or frame, with its caption as
 * ordinary text and its attributes and closer hidden; what a host decides is
 * only where a `src` points. Without this feature a figure draws its frame.
 */
export function figures(options: FiguresOptions = {}): Extension {
  return options.resolveSource === undefined ? [] : [figureSource.of(options.resolveSource)];
}
