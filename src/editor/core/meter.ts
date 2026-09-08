/**
 * The keystroke instrument: wall time from the DOM event to the last update of
 * the gesture, with exclusive per-span buckets and a parse count.
 *
 * It opens on the event rather than on the transaction because the budget the
 * user feels starts at the key press, and it closes in a macrotask after the
 * last update so a gesture that costs three transactions is measured once.
 */

import { Prec, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { analyzeCount } from "./analyzer";
import { type Gesture, closeGesture, openGesture, span } from "./timing";

export interface Measured {
  ms: number;
  analyzes: number;
  totals: Gesture;
}

export interface Meter {
  extension: Extension;
  open(): void;
}

const NOTHING: Gesture = new Map();

export function keystrokeMeter(sink: (m: Measured) => void): Meter {
  let done: (() => number) | null = null;
  let analyzed = 0;
  let began = 0;
  let last = 0;
  let updates = 0;
  let docChanged = false;
  let fromEvent = false;

  const settle = () => {
    if (!done) return;
    done();
    done = null;
    const totals = closeGesture() ?? NOTHING;
    if (updates && (fromEvent || docChanged))
      sink({ ms: last - began, analyzes: analyzeCount() - analyzed, totals });
  };

  const open = (byEvent = false) => {
    if (done) {
      fromEvent ||= byEvent;
      return;
    }
    openGesture();
    analyzed = analyzeCount();
    began = performance.now();
    last = began;
    updates = 0;
    docChanged = false;
    fromEvent = byEvent;
    done = span("keystroke");
    setTimeout(settle, 0);
  };

  const shut = (u: { docChanged: boolean }) => {
    if (!done) return;
    updates++;
    docChanged ||= u.docChanged;
    last = performance.now();
  };

  const on = () => {
    open(true);
    return false;
  };

  return {
    open: () => open(false),
    extension: [
      Prec.highest(
        EditorView.domEventHandlers({
          keydown: on,
          beforeinput: on,
          paste: on,
          cut: on,
          drop: on,
          mousedown: on,
          compositionstart: on,
        }),
      ),
      Prec.highest(EditorView.updateListener.of(shut)),
    ],
  };
}
