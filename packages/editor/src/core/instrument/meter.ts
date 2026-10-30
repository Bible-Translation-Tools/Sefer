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
 *  - `gesture` — the DOM event to the last update that carried a
 *    TRANSACTION: the browser taking the input, CodeMirror reading it, and
 *    everything the dispatch then did. Elapsed time, not CPU time. An update
 *    with no transaction — CodeMirror's measure pass reporting that a line
 *    wrapped and its height changed — does not extend it: that runs in the
 *    frame after the key, and counting it billed the wait for that frame to
 *    the keystroke (a 1.5 ms key read 8 ms from the moment the line wrapped).
 *  - `render` — the same event to after the browser PAINTED. The Event Timing
 *    API answers it where the browser offers one, and the frame trick answers
 *    it otherwise; `renderSource` says which, because they are not the same
 *    measurement and the frame one reads a frame high. `null` when neither
 *    observed anything (a headless state, a background tab), never a guess.
 *
 * `render` is always the larger of the two and it is not a sum of anything:
 * between the last update and the paint sit CodeMirror's own measure pass,
 * style and layout. Reporting one number for both was the old note's mistake —
 * it printed a `keystroke=` span that was neither.
 *
 * ## The breakdown adds up
 *
 * `browser` is the DOM event to the first transaction: the browser's own
 * handling of the key (the native insertion into the content-editable, for
 * typing) and CodeMirror reading the change back — time Sefer owns none of and
 * cannot split further, so it is one honest bucket rather than a remainder.
 * `totals` is the exclusive per-span time of everything the editor's timing
 * ring measured after that (`dispatch` — CodeMirror's update and DOM sync,
 * `analyze`, `scan`, `index`, `decorate`, `paint`, `phase:*`), and `other` is
 * what is left. So
 *
 *     browser + dispatch + analyze + … + phase:* + other = gesture
 *
 * exactly, and a reader who wants to know where a slow keystroke went reads
 * one line instead of subtracting spans by hand. The meter deliberately opens
 * NO span of its own: a wrapper span around the whole gesture makes the
 * numbers fail to add up, because its exclusive time runs on past the last
 * update to the macrotask that closes it.
 */

import { EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { analyzeCount } from "../model/analyzer";
import { closeGesture, openGesture, type Gesture } from "./timing";

export interface Measured {
  /** DOM event to the last state update — the JS work, in milliseconds. */
  gesture: number;
  /** DOM event to after the browser painted, or `null` when nothing observed one. */
  render: number | null;
  /** Which instrument answered `render` — see `afterPaint`. */
  renderSource: "event" | "frame" | null;
  analyzes: number;
  /** The DOM event to the first transaction: the browser and CodeMirror taking the input. */
  browser: number;
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

const ms = (value: number): string => value.toFixed(1);

const FLOOR = 0.05;

const noteOf = (measured: Omit<Measured, "note">): string => {
  const parts = [`gesture=${ms(measured.gesture)}ms`];
  if (measured.render !== null)
    parts.push(
      `${measured.renderSource === "event" ? "input" : "render"}=${ms(measured.render)}ms`,
    );
  parts.push(`analyzes=${measured.analyzes}`);
  if (measured.browser >= FLOOR) parts.push(`browser=${ms(measured.browser)}`);
  const spans = [...measured.totals]
    .filter(([, total]) => total.ms >= FLOOR)
    .sort((a, b) => b[1].ms - a[1].ms);
  for (const [name, total] of spans) parts.push(`${name}=${ms(total.ms)}`);
  if (measured.other >= FLOOR) parts.push(`other=${ms(measured.other)}`);
  return parts.join(" ");
};

const EVENT_TIMING =
  typeof PerformanceObserver === "function" &&
  (PerformanceObserver.supportedEntryTypes ?? []).includes("event");

const pending: { at: number; settle: (entry: PerformanceEntry) => void }[] = [];

const EVENT_TIMING_GRACE = 400;

const NEAR = 60;

let observer: PerformanceObserver | undefined;

const observeInputs = (): void => {
  if (observer !== undefined || !EVENT_TIMING) return;
  observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const index = pending.findIndex(
        (want) => entry.startTime <= want.at + 8 && entry.startTime >= want.at - NEAR,
      );
      if (index < 0) continue;
      const [want] = pending.splice(index, 1);
      want?.settle(entry);
    }
  });
  // SAFETY: `durationThreshold` is Event Timing's own option, absent from the DOM lib's `PerformanceObserverInit`; the type is only widened.
  const options: PerformanceObserverInit & { durationThreshold: number } = {
    type: "event",
    buffered: false,
    durationThreshold: 16,
  };
  observer.observe(options);
};

/**
 * What one gesture cost, from the input to the pixels.
 *
 * TWO INSTRUMENTS, and the answer says which one spoke. The browser's is
 * preferred because it measures what it is actually reporting; the frame trick
 * is the fallback, and it was the only instrument here before.
 *
 *  - `"event"` — `PerformanceEventTiming.duration`: the hardware timestamp of
 *    the input to the paint after it was processed. Rounded to 8ms by the
 *    specification, so it is coarse, and it is the browser's own number.
 *  - `"frame"` — a `requestAnimationFrame` callback runs BEFORE the paint, so
 *    the timeout scheduled from it is the first task that can honestly say the
 *    pixels are up. It is an INFERENCE from task ordering, and it reads high:
 *    the timeout can land a frame later than the paint it is meant to witness,
 *    which is why a keystroke whose JS cost 3ms could report 33ms — two frames
 *    at 60Hz, most of it neither work nor latency.
 *
 * `null` for both when nothing observed a frame at all (a headless state, a
 * background tab), never a guess.
 */
const afterPaint = (
  began: number,
  then: (cost: number | null, source: "event" | "frame" | null) => void,
): void => {
  let answered = false;
  const answer = (cost: number | null, source: "event" | "frame" | null): void => {
    if (answered) return;
    answered = true;
    then(cost, source);
  };

  if (EVENT_TIMING) {
    observeInputs();
    const want = {
      at: began,
      settle: (entry: PerformanceEntry) => answer(entry.duration, "event"),
    };
    pending.push(want);
    setTimeout(() => {
      const index = pending.indexOf(want);
      if (index >= 0) pending.splice(index, 1);
    }, EVENT_TIMING_GRACE);
  }

  if (typeof requestAnimationFrame !== "function") {
    if (!EVENT_TIMING) answer(null, null);
    return;
  }
  requestAnimationFrame(() => {
    setTimeout(() => answer(performance.now() - began, "frame"), 0);
  });
};

function reportAfterPaint(
  sink: (measured: Measured) => void,
  began: number,
  parts: Pick<Measured, "gesture" | "analyzes" | "browser" | "totals" | "other">,
): void {
  afterPaint(began, (cost, source) => {
    const render = cost === null ? null : +cost.toFixed(3);
    const measured = { ...parts, render, renderSource: source };
    sink({ ...measured, note: noteOf(measured) });
  });
}

function attribute(
  totals: NonNullable<ReturnType<typeof closeGesture>>,
  gesture: number,
  first: number,
  began: number,
): { browser: number; other: number } {
  const browser = first === 0 ? 0 : +Math.max(0, Math.min(gesture, first - began)).toFixed(3);
  let attributed = browser;
  for (const total of totals.values()) attributed += total.ms;
  const other = +Math.max(0, gesture - attributed).toFixed(3);
  return { browser, other };
}

function meterExtension(
  on: () => boolean,
  shut: (update: { docChanged: boolean; transactions: readonly unknown[] }) => void,
  firstTransaction: () => void,
): Extension[] {
  return [
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
    Prec.highest(
      EditorState.changeFilter.of(() => {
        firstTransaction();
        return true;
      }),
    ),
    Prec.highest(
      EditorState.transactionExtender.of(() => {
        firstTransaction();
        return null;
      }),
    ),
  ];
}

export function keystrokeMeter(sink: (measured: Measured) => void): Meter {
  let live = false;
  let analyzed = 0;
  let began = 0;
  let last = 0;
  let first = 0;
  let updates = 0;
  let docChanged = false;
  let fromEvent = false;

  const settle = () => {
    if (!live) return;
    live = false;
    const totals = closeGesture();
    if (totals === null) return;
    if (!(updates && (fromEvent || docChanged))) return;
    const gesture = +(last - began).toFixed(3);
    const analyzes = analyzeCount() - analyzed;
    const { browser, other } = attribute(totals, gesture, first, began);
    reportAfterPaint(sink, began, { gesture, analyzes, browser, totals, other });
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
    first = 0;
    updates = 0;
    docChanged = false;
    fromEvent = byEvent;
    setTimeout(settle, 0);
  };

  const shut = (update: { docChanged: boolean; transactions: readonly unknown[] }) => {
    if (!live) return;
    if (update.transactions.length === 0) return;
    updates++;
    docChanged ||= update.docChanged;
    last = performance.now();
  };

  const firstTransaction = (): void => {
    if (live && first === 0) first = performance.now();
  };

  const on = () => {
    open(true);
    return false;
  };

  return {
    open: () => open(false),
    extension: meterExtension(on, shut, firstTransaction),
  };
}
