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

import { analyzeCount } from "./analyzer";
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
  // Named for the instrument, because the two are not interchangeable: the
  // browser's number is the input's real cost and the frame trick's reads a
  // frame high. A line that called both `render=` would invite comparing them.
  if (m.render !== null)
    parts.push(`${m.renderSource === "event" ? "input" : "render"}=${ms(m.render)}ms`);
  parts.push(`analyzes=${m.analyzes}`);
  if (m.browser >= FLOOR) parts.push(`browser=${ms(m.browser)}`);
  const spans = [...m.totals]
    .filter(([, total]) => total.ms >= FLOOR)
    .sort((a, b) => b[1].ms - a[1].ms);
  for (const [name, total] of spans) parts.push(`${name}=${ms(total.ms)}`);
  if (m.other >= FLOOR) parts.push(`other=${ms(m.other)}`);
  return parts.join(" ");
};

/**
 * Whether the browser will tell us what an input actually cost.
 *
 * The Event Timing API measures from the hardware timestamp of the input to
 * the paint that followed processing it — the same window the frame trick
 * below tries to approximate, except measured by the engine rather than
 * inferred from task ordering. Feature-gated because it is the browser's to
 * offer, and because the headless states this runs in may have neither.
 */
const EVENT_TIMING =
  typeof PerformanceObserver === "function" &&
  (PerformanceObserver.supportedEntryTypes ?? []).includes("event");

/**
 * The gestures waiting for the browser to report what they cost, by the
 * `performance.now()` at which each opened.
 *
 * At most a handful, and each is resolved or dropped within
 * `EVENT_TIMING_GRACE`. Entries arrive after the paint, so a gesture cannot be
 * answered synchronously and cannot wait for ever either.
 */
const pending: { at: number; settle: (entry: PerformanceEntry) => void }[] = [];

/** How long an Event Timing entry has to arrive before the frame trick wins. */
const EVENT_TIMING_GRACE = 400;

/**
 * An entry belongs to a gesture when the input that produced it happened at
 * about the moment the gesture opened. `startTime` is the hardware timestamp
 * and the meter opens in the listener a fraction later, so the entry's start
 * is at or slightly BEFORE the gesture's.
 */
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
  // 16ms is the smallest threshold the specification allows, so an input that
  // was answered inside one frame is reported by NOBODY — which is the reason
  // the frame trick below is kept rather than deleted. A keystroke fast enough
  // not to be reported is also a keystroke nobody is asking about.
  // SAFETY: `durationThreshold` IS Event Timing's own option on
  // `PerformanceObserverInit` and is simply absent from the DOM lib's
  // declaration of it. The type is widened, never narrowed, so nothing is
  // claimed that the runtime will not accept; observing without it takes the
  // default 104ms threshold, which reports nothing a keystroke ever does.
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

export function keystrokeMeter(sink: (m: Measured) => void): Meter {
  let live = false;
  let analyzed = 0;
  let began = 0;
  let last = 0;
  // When the first transaction of the gesture was created; 0 until one is.
  let first = 0;
  let updates = 0;
  let docChanged = false;
  let fromEvent = false;

  const settle = () => {
    if (!live) return;
    live = false;
    const totals = closeGesture();
    // The span ring's gesture bucket is one module-level slot, so if two views
    // are metered at once the second to settle finds it already taken. A meter
    // that did not own the bucket cannot attribute anything, and a second line
    // reading `other=<the whole gesture>` would be a worse answer than none —
    // so it says nothing and lets the meter that DID own it report.
    if (totals === null) return;
    if (!(updates && (fromEvent || docChanged))) return;
    // Everything the paint callback needs is read HERE: a second gesture may
    // open before the frame lands, and it resets every one of these.
    const gesture = +(last - began).toFixed(3);
    const analyzes = analyzeCount() - analyzed;
    const startedAt = began;
    // A gesture with no transaction (a click that only focused) has no
    // input half: all of it is what the spans say, or other.
    const browser = first === 0 ? 0 : +Math.max(0, Math.min(gesture, first - began)).toFixed(3);
    let attributed = browser;
    for (const total of totals.values()) attributed += total.ms;
    const other = +Math.max(0, gesture - attributed).toFixed(3);
    afterPaint(startedAt, (cost, source) => {
      const render = cost === null ? null : +cost.toFixed(3);
      const measured = { gesture, render, renderSource: source, analyzes, browser, totals, other };
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
    first = 0;
    updates = 0;
    docChanged = false;
    fromEvent = byEvent;
    setTimeout(settle, 0);
  };

  const shut = (u: { docChanged: boolean; transactions: readonly unknown[] }) => {
    if (!live) return;
    // CodeMirror's measure pass updates the view with no transaction when a
    // line's height changed — in the frame AFTER the key. It is not this
    // gesture's work, and letting it move `last` billed the frame wait here.
    if (u.transactions.length === 0) return;
    updates++;
    docChanged ||= u.docChanged;
    last = performance.now();
  };

  /** The first transaction of a live gesture: where the browser's half ends. */
  const firstTransaction = (): void => {
    if (live && first === 0) first = performance.now();
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
      // The first thing CodeMirror runs as a transaction is created: change
      // filters go in precedence order (transaction filters and extenders go
      // in reverse), so this sees the transaction before any phase rule does,
      // and its first call is the end of the input's browser half. The
      // extender catches a transaction created with `filter: false`, which
      // skips change filters, at the cost of arriving after its rules.
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
    ],
  };
}
