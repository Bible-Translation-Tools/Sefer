/**
 * Recording a version and sending it, as one machine. The Save dialog reads
 * the phase and the review panel sends events; nothing else decides. `Line`
 * is whatever the receipt shows: the machine only carries it.
 *
 * A record that fails still ends in `recorded`: its line says what went wrong.
 */

export type RecordPhase<Line> =
  | { readonly kind: "editing" }
  | { readonly kind: "recording" }
  | {
      readonly kind: "recorded";
      readonly line: Line;
      readonly send: Line | "sending" | undefined;
    };

export type RecordEvent<Line> =
  /** The person pressed Save, or Decline. */
  | { readonly kind: "start" }
  /** The run ended with no receipt to show: refused before it wrote, or a decline. */
  | { readonly kind: "stopped" }
  | { readonly kind: "answered"; readonly line: Line }
  | { readonly kind: "sending" }
  | { readonly kind: "sent"; readonly line: Line | undefined }
  /** The receipt was read and put away. */
  | { readonly kind: "close" };

type Kind = RecordPhase<unknown>["kind"];
type Transitions = Record<Kind, Partial<Record<RecordEvent<unknown>["kind"], Kind>>>;

const recordTransitions = {
  editing: { start: "recording" },
  // No way out by `close` or by a second `start`: a run in flight is neither abandoned nor doubled.
  recording: { stopped: "editing", answered: "recorded" },
  recorded: { start: "recording", sending: "recorded", sent: "recorded", close: "editing" },
} as const satisfies Transitions;

/**
 * The phase after an event. An event the phase has no way out for leaves it
 * as it was: a send that answers after its receipt was closed changes nothing.
 */
export const stepRecord = <Line>(
  phase: RecordPhase<Line>,
  event: RecordEvent<Line>,
): RecordPhase<Line> => {
  const ways: Transitions[Kind] = recordTransitions[phase.kind];
  if (ways[event.kind] === undefined) return phase;
  switch (event.kind) {
    case "start":
      return { kind: "recording" };
    case "stopped":
    case "close":
      return { kind: "editing" };
    case "answered":
      return { kind: "recorded", line: event.line, send: undefined };
    case "sending":
      return phase.kind === "recorded" ? { ...phase, send: "sending" } : phase;
    case "sent":
      return phase.kind === "recorded" ? { ...phase, send: event.line } : phase;
  }
};
