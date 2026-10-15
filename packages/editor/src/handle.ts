/**
 * What a host holds for a mounted editor: methods, never the CodeMirror view.
 *
 * Every mount — the book editor, a satellite, a reader, a diff pane, the
 * reference pane — answers the same few questions the same way, so a host
 * learns them once. The view behind a handle is kept here, in a module-private
 * map, for the package's own recipes (an aligned group, a flash) that need it;
 * nothing outside the package reaches it (`pnpm boundaries`, and the planning
 * item "embeddable editor").
 */

import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { watchLocation, type Where } from "./recipes/whereAmI";

/**
 * Why the viewport moved: the reader scrolled, or the editor was told to go
 * somewhere (a reveal, a jump, a resume, a mode flip, an aligned neighbour).
 * A host that pins a chapter after a jump keeps the pin until the reader
 * scrolls.
 */
export type ViewportSource = "user" | "reveal";

/** Where a revealed range lands in the pane, or `"none"` to leave the scroll alone. */
export type RevealScroll = "start" | "center" | "nearest" | "none";

export interface RevealOptions {
  readonly scroll?: RevealScroll;
  /** Select the range (a caret at `from` when it is empty). Default false. */
  readonly select?: boolean;
}

export interface EditorHandle {
  /** The text the view shows, as it stands now. */
  text(): string;
  /** Its length, without building the string. */
  length(): number;
  focus(): void;
  /**
   * The text offset under a screen point, or undefined when there is none.
   * Best effort: a view that has just been re-clipped can throw before it has
   * measured again, and that is answered as "none".
   */
  offsetAt(point: { readonly x: number; readonly y: number }): number | undefined;
  /** Brings an offset range into view, and selects it when asked. */
  reveal(range: { readonly from: number; readonly to?: number }, options?: RevealOptions): void;
  /**
   * What is on screen, reported on scroll (coalesced to a frame) and once at
   * once. Returns the detach. `null` while there is nothing to read.
   */
  onViewport(report: (where: Where | null, source: ViewportSource) => void): () => void;
  /** The offset at the middle of the pane: where the reader is looking. */
  centerOffset(): number;
}

const views = new WeakMap<EditorHandle, EditorView>();

/** When the package last moved each view itself. */
const movedAt = new WeakMap<EditorView, number>();

/** A scroll this long after the package moved a view is that move, landing. */
const LANDING_MS = 400;

/**
 * Says the package is about to move `view` itself, so the scroll that follows
 * reports as `"reveal"`, not as the reader's. Package-internal.
 */
export const markMoved = (view: EditorView): void => {
  movedAt.set(view, performance.now());
};

const sourceOf = (view: EditorView): ViewportSource =>
  performance.now() - (movedAt.get(view) ?? Number.NEGATIVE_INFINITY) < LANDING_MS
    ? "reveal"
    : "user";

/** The view behind a handle. Package-internal: the index does not export it. */
export const viewOf = (handle: EditorHandle): EditorView => {
  const view = views.get(handle);
  if (view === undefined) throw new Error("not an editor handle");
  return view;
};

/** A handle over `view`, with a mount's own methods beside the shared ones. */
export const handleFor = <Rest extends object>(
  view: EditorView,
  rest: Rest,
): Rest & EditorHandle => {
  const shared: EditorHandle = {
    text: () => view.state.doc.toString(),
    length: () => view.state.doc.length,
    focus: () => view.focus(),
    offsetAt: (point) => {
      try {
        return view.posAtCoords(point) ?? undefined;
      } catch {
        return undefined;
      }
    },
    reveal: (range, options = {}) => {
      const length = view.state.doc.length;
      const from = Math.min(Math.max(range.from, 0), length);
      const to = Math.min(Math.max(range.to ?? from, from), length);
      const scroll = options.scroll ?? "nearest";
      if (scroll !== "none") markMoved(view);
      view.dispatch({
        ...(options.select === true ? { selection: EditorSelection.range(from, to) } : {}),
        ...(scroll === "none" ? {} : { effects: EditorView.scrollIntoView(from, { y: scroll }) }),
      });
    },
    onViewport: (report) => watchLocation(view, (where) => report(where, sourceOf(view))),
    centerOffset: () => {
      const box = view.scrollDOM.getBoundingClientRect();
      const y = box.top + box.height / 2;
      return (
        view.posAtCoords({ x: box.left + box.width / 2, y }, false) ??
        view.lineBlockAtHeight(y - view.documentTop).from
      );
    },
  };
  // Descriptors, not a spread: a mount's own getters (a satellite's `range`)
  // must stay getters.
  // SAFETY: `defineProperties` copies every own property of `rest` onto
  // `shared`, which already holds every `EditorHandle` member, so the result
  // has both; TypeScript types it as `EditorHandle` alone.
  const handle = Object.defineProperties(shared, Object.getOwnPropertyDescriptors(rest)) as Rest &
    EditorHandle;
  views.set(handle, view);
  return handle;
};
