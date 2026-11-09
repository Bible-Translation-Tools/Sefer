/**
 * Which project the shell has, as one machine: every state it can be in and
 * every way out of each. The shell sends events and reads the phase; nothing
 * else decides. `projectTransitions` is the whole of it as data, so a chart
 * can be drawn from it.
 */

export type OpenFailure = "NotADirectory" | "NoBooks" | "Refused";

export type ProjectPhase =
  | { readonly kind: "closed" }
  | { readonly kind: "opening"; readonly root: string }
  | { readonly kind: "open"; readonly root: string }
  | { readonly kind: "failed"; readonly root: string; readonly reason: OpenFailure };

export type ProjectEvent =
  | { readonly kind: "ask"; readonly root: string }
  | { readonly kind: "opened"; readonly root: string }
  | { readonly kind: "refused"; readonly root: string; readonly reason: OpenFailure }
  | { readonly kind: "close" };

type Transitions = Record<
  ProjectPhase["kind"],
  Partial<Record<ProjectEvent["kind"], ProjectPhase["kind"]>>
>;

const projectTransitions = {
  closed: { ask: "opening" },
  opening: { ask: "opening", opened: "open", refused: "failed", close: "closed" },
  open: { ask: "opening", close: "closed" },
  failed: { ask: "opening", close: "closed" },
} as const satisfies Transitions;

/**
 * The phase after an event. An event the phase has no way out for leaves it
 * as it was, and so does an answer about a root that is no longer the one
 * being opened: asking for another project is what cancels the first.
 */
export const stepProject = (phase: ProjectPhase, event: ProjectEvent): ProjectPhase => {
  const ways: Transitions[ProjectPhase["kind"]] = projectTransitions[phase.kind];
  if (ways[event.kind] === undefined) return phase;
  switch (event.kind) {
    case "ask":
      return { kind: "opening", root: event.root };
    case "close":
      return { kind: "closed" };
    case "opened":
      return phase.kind === "opening" && phase.root === event.root
        ? { kind: "open", root: event.root }
        : phase;
    case "refused":
      return phase.kind === "opening" && phase.root === event.root
        ? { kind: "failed", root: event.root, reason: event.reason }
        : phase;
  }
};
