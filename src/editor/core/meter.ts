/**
 * The keystroke instrument: what one gesture cost, in two numbers the reader
 * can act on and a breakdown whose arithmetic closes.
 *
 * It opens on the DOM event rather than on the transaction because the budget
 * the user feels starts at the key press, and it closes in a macrotask after
 * the last update so a gesture that costs three transactions is measured once.
 *
 * ## The two numbers
 *
 *  - `gesture` — the JS work: the DOM event to the LAST state update of the
 *    gesture. This is the part Sefer's own code owns, and the part a slow
 *    phase, a re-parse or a decoration rebuild lands in.
 *  - `render` — the same event to after the browser PAINTED, measured by
 *    waiting a frame and then a macrotask. `null` when no frame was observed
 *    (a headless state, a background tab), never a guess.
 *
 * `render` is always the larger of the two and it is not a sum of anything:
 * between the last update and the paint sit CodeMirror's own measure pass,
 * style and layout. Reporting one number for both was the old note's mistake —
 * it printed a `keystroke=` span that was neither.
 *
 * ## The breakdown adds up
 *
 * `totals` is the exclusive per-span time of everything the editor's timing
 * ring measured inside the gesture (`analyze`, `scan`, `index`, `decorate`,
 * `paint`, `phase:*`), and `other` is `gesture` minus all of it. So
 *
 *     analyze + scan + index + decorate + paint + phase:* + other = gesture
 *
 * exactly, and a reader who wants to know where a slow keystroke went reads
 * one line instead of subtracting spans by hand. The meter deliberately opens
 * NO span of its own: a wrapper span around the whole gesture is what used to
 * make the numbers fail to add up, because its exclusive time ran on past the
 * last update to the macrotask that closed it.
 */

import { Prec, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { analyzeCount } from "./analyzer";
import { type Gesture, closeGesture, openGesture } from "./timing";

export interface Measured {
  /** DOM event to the last state update — the JS work, in milliseconds. */
  gesture: number;
  /** DOM event to after the browser painted, or `null` when no frame ran. */
  render: number | null;
  analyzes: number;
  /** Exclusive per-span totals inside the gesture. */
  totals: Gesture;
  /** Gesture milliseconds no span accounted for. Never negative. */
  other: number;
  /** The one bounded line the Observability ring gets. */
  note: string;
}

export interface Meter {
  extension: Extension;
  open(): void;
}

const NOTHING: Gesture = new Map();

/** Milliseconds, one decimal — the precision a person reads at. */
const ms = (value: number): string => value.toFixed(1);

/** Below this, a bucket is noise and printing it only lengthens the line. */
const FLOOR = 0.05;

/**
 * The note: the two wall numbers, the parse count, then every span that cost
 * something and the unattributed remainder. Ordered biggest-first after the
 * fixed head, so the first thing past `analyzes=` is where the time went.
 */
const noteOf = (m: Omit<Measured, "note">): string => {
  const parts = [`gesture=${ms(m.gesture)}ms`];
  if (m.render !== null) parts.push(`render=${ms(m.render)}ms`);
  parts.push(`analyzes=${m.analyzes}`);
  const spans = [...m.totals]
    .filter(([, total]) => total.ms >= FLOOR)
    .sort((a, b) => b[1].ms - a[1].ms);
  for (const [name, total] of spans) parts.push(`${name}=${ms(total.ms)}`);
  if (m.other >= FLOOR) parts.push(`other=${ms(m.other)}`);
  return parts.join(" ");
};

/**
 * After the next paint: a frame, and then a macrotask inside it — a
 * `requestAnimationFrame` callback runs BEFORE the browser paints, so the
 * timeout scheduled from it is the first moment that can honestly say the
 * pixels are on screen. A host with no `requestAnimationFrame` answers `null`
 * rather than a number that means something else.
 */
const afterPaint = (then: (at: number | null) => void): void => {
  if (typeof requestAnimationFrame !== "function") {
    then(null);
    return;
  }
  requestAnimationFrame(() => {
    setTimeout(() => then(performance.now()), 0);
  });
};

export function keystrokeMeter(sink: (m: Measured) => void): Meter {
  let live = false;
  let analyzed = 0;
  let began = 0;
  let last = 0;
  let updates = 0;
  let docChanged = false;
  let fromEvent = false;

  const settle = () => {
    if (!live) return;
    live = false;
    const totals = closeGesture() ?? NOTHING;
    if (!(updates && (fromEvent || docChanged))) return;
    // Everything the paint callback needs is read HERE: a second gesture may
    // open before the frame lands, and it resets every one of these.
    const gesture = +(last - began).toFixed(3);
    const analyzes = analyzeCount() - analyzed;
    const startedAt = began;
    let attributed = 0;
    for (const total of totals.values()) attributed += total.ms;
    const other = +Math.max(0, gesture - attributed).toFixed(3);
    afterPaint((paintedAt) => {
      const render = paintedAt === null ? null : +(paintedAt - startedAt).toFixed(3);
      const measured = { gesture, render, analyzes, totals, other };
      sink({ ...measured, note: noteOf(measured) });
    });
  };

  const open = (byEvent = false) => {
    if (live) {
      fromEvent ||= byEvent;
      return;
    }
    live = true;
    openGesture();
    analyzed = analyzeCount();
    began = performance.now();
    last = began;
    updates = 0;
    docChanged = false;
    fromEvent = byEvent;
    setTimeout(settle, 0);
  };

  const shut = (u: { docChanged: boolean }) => {
    if (!live) return;
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
