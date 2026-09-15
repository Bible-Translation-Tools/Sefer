/**
 * How long a diagnostic popover stays up — the show/hide half of the lint
 * tooltip, separate from what it says (`recipes/lint.ts`).
 *
 * CodeMirror's hover tooltip closes the INSTANT the pointer leaves the range it
 * was opened for. A diagnostic's range is often one character — eight pixels —
 * so the popover vanished under any hand that was not perfectly still, and
 * reading it, never mind pressing its Fix button, was a matter of luck. The
 * same handler also hid it on a re-lint, and this editor re-lints whenever the
 * corpus publishes, which is every second or so while typing has just stopped.
 *
 * The rule here is the one a reader would state: the popover stays while the
 * pointer is over the diagnostic or over the popover, and for a moment after it
 * has left both, so crossing the gap between them is not a race.
 *
 * It is built out of `activateHover`, which is CodeMirror's own door for this:
 * a tooltip activated that way is LOCKED — the mousemove handler skips it, and
 * so does the `hideOn` re-lint test — and stays until the `until` predicate
 * says otherwise. So this plugin does not fight the built-in behaviour; it
 * re-opens the tooltip the built-in opened, locked, and then owns the closing.
 */

import type { Extension } from "@codemirror/state";
import {
  activateHover,
  closeHoverTooltips,
  hasHoverTooltips,
  ViewPlugin,
  type EditorView,
} from "@codemirror/view";

/** How long the popover survives after the pointer has left it and its range. */
export const HOVER_GRACE_MS = 400;

/** How far outside the popover still counts as "on" it, in pixels. */
const EDGE = 6;

const near = (rect: DOMRect, x: number, y: number): boolean =>
  x >= rect.left - EDGE &&
  x <= rect.right + EDGE &&
  y >= rect.top - EDGE &&
  y <= rect.bottom + EDGE;

class HoverGrace {
  readonly #view: EditorView;
  #pointer: { x: number; y: number } | null = null;
  /** The last position a tooltip was opened for, and its own rectangle. */
  #anchor: DOMRect | null = null;
  #locked = false;
  #closing: ReturnType<typeof setTimeout> | undefined;
  readonly #move: (event: MouseEvent) => void;

  constructor(view: EditorView) {
    this.#view = view;
    this.#move = (event) => {
      this.#pointer = { x: event.clientX, y: event.clientY };
      this.#reconsider();
    };
    view.dom.addEventListener("mousemove", this.#move);
  }

  update(): void {
    const showing = hasHoverTooltips(this.#view.state);
    if (!showing) {
      this.#locked = false;
      this.#anchor = null;
      this.#cancel();
      return;
    }
    if (this.#locked) return;
    // Re-open it as a LOCKED tooltip, at the position the pointer is on. The
    // dispatch cannot happen inside an update, so it is deferred by a frame;
    // `until` is what releases the lock, and an edit is the one thing that
    // makes a diagnostic's offsets a lie.
    const pointer = this.#pointer;
    if (pointer === null) return;
    this.#locked = true;
    requestAnimationFrame(() => {
      if (!this.#view.dom.isConnected) return;
      // Measured HERE and not in the update: reading the layout during one is
      // an exception CodeMirror raises on purpose.
      const at = this.#view.posAtCoords(pointer);
      if (at === null) return;
      activateHover(this.#view, at, 1, { until: (tr) => tr.docChanged });
    });
  }

  /** The popover's own box, measured lazily — it moves with the tooltip. */
  #tooltipRect(): DOMRect | null {
    const dom = this.#view.dom.querySelector(".cm-tooltip-hover");
    return dom === null ? null : dom.getBoundingClientRect();
  }

  #reconsider(): void {
    if (!this.#locked || this.#pointer === null) return;
    const { x, y } = this.#pointer;
    const tooltip = this.#tooltipRect();
    // The anchor is remembered rather than re-measured, because once the
    // pointer has left the line the position under it is a different range.
    this.#anchor ??= this.#lineRectUnder(x, y);
    const inside =
      (tooltip !== null && near(tooltip, x, y)) ||
      (this.#anchor !== null && near(this.#anchor, x, y));
    if (inside) {
      this.#cancel();
      return;
    }
    if (this.#closing !== undefined) return;
    this.#closing = setTimeout(() => {
      this.#closing = undefined;
      this.#locked = false;
      this.#anchor = null;
      if (this.#view.dom.isConnected) this.#view.dispatch({ effects: closeHoverTooltips });
    }, HOVER_GRACE_MS);
  }

  /**
   * The box the pointer must stay near: the diagnostic's own mark if there is
   * one under the pointer, and otherwise the text line, which is the smallest
   * honest answer when the mark is a single character.
   */
  #lineRectUnder(x: number, y: number): DOMRect | null {
    const element = document.elementFromPoint(x, y);
    if (element === null || !this.#view.dom.contains(element)) return null;
    const mark = element.closest(".cm-lintRange, .cm-line");
    return mark === null ? null : mark.getBoundingClientRect();
  }

  #cancel(): void {
    if (this.#closing === undefined) return;
    clearTimeout(this.#closing);
    this.#closing = undefined;
  }

  destroy(): void {
    this.#cancel();
    this.#view.dom.removeEventListener("mousemove", this.#move);
  }
}

/**
 * Keeps the diagnostic popover up while the pointer is on it or on the thing it
 * describes, and for `HOVER_GRACE_MS` after it has left both.
 */
export const lintHoverGrace = (): Extension => ViewPlugin.fromClass(HoverGrace);
