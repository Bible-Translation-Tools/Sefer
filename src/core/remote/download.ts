/**
 * One download (a project or a source text coming from WACS), as a machine.
 *
 * A clone cannot be stopped part-way: once the request is sent the bytes come
 * back regardless, and a half-written folder blocks the next try. So the way
 * to call a download off is BEFORE it starts: `pending` is a short window in
 * which nothing has been asked of the network and Cancel costs nothing. After
 * it the download runs to its end.
 *
 * How far along it is (bytes, a percentage, a step's name) is not a phase: the
 * surface that draws the download keeps that beside this.
 */

export type DownloadPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "pending" }
  | { readonly kind: "fetching" }
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly why: string };

export const idleDownload: DownloadPhase = { kind: "idle" };

export type DownloadEvent =
  /** The person pressed Download, or Try again. */
  | { readonly kind: "ask" }
  /** The person called it off inside the window. */
  | { readonly kind: "cancel" }
  /** The window ended: the request goes out now. */
  | { readonly kind: "elapsed" }
  | { readonly kind: "arrived" }
  | { readonly kind: "failed"; readonly why: string }
  /** The result was read and put away. */
  | { readonly kind: "dismiss" };

type Kind = DownloadPhase["kind"];
type Transitions = Record<Kind, Partial<Record<DownloadEvent["kind"], Kind>>>;

export const downloadTransitions = {
  idle: { ask: "pending" },
  // No second `ask`: one press starts it, another calls it off.
  pending: { cancel: "idle", elapsed: "fetching" },
  // No `cancel`: a clone under way runs to its end.
  fetching: { arrived: "done", failed: "failed" },
  done: { ask: "pending", dismiss: "idle" },
  failed: { ask: "pending", dismiss: "idle" },
} as const satisfies Transitions;

/** The phase after an event. An event the phase has no way out for leaves it as it was. */
export const stepDownload = (phase: DownloadPhase, event: DownloadEvent): DownloadPhase => {
  const ways: Transitions[Kind] = downloadTransitions[phase.kind];
  const kind = ways[event.kind];
  if (kind === undefined) return phase;
  if (kind === "failed") return event.kind === "failed" ? { kind, why: event.why } : phase;
  return { kind };
};
