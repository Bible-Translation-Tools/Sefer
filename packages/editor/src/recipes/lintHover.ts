import type { Extension } from "@codemirror/state";
import {
  activateHover,
  closeHoverTooltips,
  hasHoverTooltips,
  ViewPlugin,
  type EditorView,
} from "@codemirror/view";

const HOVER_GRACE_MS = 400;

const EDGE = 6;

const near = (rect: DOMRect, x: number, y: number): boolean =>
  x >= rect.left - EDGE &&
  x <= rect.right + EDGE &&
  y >= rect.top - EDGE &&
  y <= rect.bottom + EDGE;

class HoverGrace {
  readonly #view: EditorView;
  #pointer: { x: number; y: number } | null = null;
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
    const pointer = this.#pointer;
    if (pointer === null) return;
    this.#locked = true;
    requestAnimationFrame(() => {
      if (!this.#view.dom.isConnected) return;
      const at = this.#view.posAtCoords(pointer);
      if (at === null) return;
      activateHover(this.#view, at, 1, { until: (tr) => tr.docChanged });
    });
  }

  #tooltipRect(): DOMRect | null {
    const dom = this.#view.dom.querySelector(".cm-tooltip-hover");
    return dom === null ? null : dom.getBoundingClientRect();
  }

  #reconsider(): void {
    if (!this.#locked || this.#pointer === null) return;
    const { x, y } = this.#pointer;
    const tooltip = this.#tooltipRect();
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
