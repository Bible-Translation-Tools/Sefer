/**
 * The step machine that tutorials (and, later, workflows) run on.
 *
 * A step is three things, in order:
 *
 *   go      take the app to the step: navigate, run a command, scroll
 *   ready   wait until the step can be shown: an element is on screen, a
 *           signal says so
 *   effect  what the step does once ready. For a tutorial, a ring around an
 *           element and a card of explanation anchored to it; a workflow
 *           step may have none
 *
 * and then it moves on when the person presses Next (`advance: "user"`) or
 * when its own condition holds.
 *
 * Steps reach the app through `TourContext` and through the DOM, never the
 * other way round: no screen knows a tutorial exists beyond carrying a
 * `data-tour` handle, and no state is lifted for a tutorial's sake. Where the
 * state a step waits on is not reachable, `ready` asks the DOM; that is a
 * hint the state could be lifted later, not a reason to lift it now.
 *
 * `ready` is polled rather than subscribed: one function every 100 ms for
 * the few seconds a step waits, which reads a signal or the DOM equally
 * well, and keeps a step a plain object.
 */

import type { UseNavigateResult } from "@tanstack/solid-router";
import { createSignal } from "solid-js";

import type { Shell } from "../ProjectContext";

/** What a step may reach. */
export interface TourContext {
  readonly shell: Shell;
  readonly navigate: UseNavigateResult<string>;
  /** Runs a palette command by id (`src/app/commands.ts`). */
  readonly run: (command: string, argument?: unknown) => void;
}

/** A ring around an element and a card of explanation beside it. */
export interface Spotlight {
  /** A CSS selector; the first match is the anchor. Prefer `[data-tour=…]`. */
  readonly anchor: string;
  readonly title: string;
  readonly body: string;
}

export interface Step {
  readonly go?: (context: TourContext) => void;
  /** True once the step can be shown. Defaults to "the anchor is on screen". */
  readonly ready?: (context: TourContext) => boolean;
  readonly spotlight?: Spotlight;
  /** "user" waits for Next; a function moves on as soon as it holds. */
  readonly advance?: "user" | ((context: TourContext) => boolean);
  /**
   * How long this step may wait to become ready, when the default is too
   * short: a step that waits on the network (a download, a source text
   * registering) names its own.
   */
  readonly timeoutMs?: number;
}

export interface Tour {
  readonly id: string;
  readonly title: string;
  /** One line for the list in Settings. */
  readonly summary: string;
  /** Whether a project must be open to start it. */
  readonly needsProject: boolean;
  /**
   * Where the tutorial starts, for one written over a particular project: a
   * path (usually a share link, `/r/<owner>/<repo>/…`) that Start navigates to
   * with `?tour=<id>` added, so the project is opened, or downloaded, first.
   */
  readonly start?: string;
  readonly steps: readonly Step[];
}

/** The URL that opens a tutorial's own place and starts it there. */
const startUrl = (tour: Tour, start: string): string =>
  `${start}${start.includes("?") ? "&" : "?"}tour=${encodeURIComponent(tour.id)}`;

/**
 * Starts a tutorial from a button or the palette: at its own `start` when it
 * has one (the outlet picks `?tour=` up there), here otherwise.
 */
export const beginTour = (context: TourContext, tour: Tour): void => {
  if (tour.start === undefined) startTour(context, tour);
  else void context.navigate({ href: startUrl(tour, tour.start) });
};

/** Which tour is running and where it is, or nothing. */
interface Running {
  readonly tour: Tour;
  readonly index: number;
  /** `waiting` until the step's `ready` holds; `timedOut` if it never did. */
  readonly phase: "waiting" | "showing" | "timedOut";
}

const [running, setRunning] = createSignal<Running | undefined>(undefined, {
  name: "tour",
  equals: false,
});
export const runningTour = running;

/**
 * How long a step may wait to become ready before the card says so, unless
 * it names its own `timeoutMs`. A step not ready in this long is almost
 * always one the UI has moved out from under.
 */
const READY_TIMEOUT_MS = 10_000;
const POLL_MS = 100;

let poll: ReturnType<typeof setInterval> | undefined;
const stopPolling = (): void => {
  if (poll !== undefined) clearInterval(poll);
  poll = undefined;
};

/*
 * Tutorials FAIL OPEN. They are written against screens that are still being
 * redesigned, and nothing at build time can tell that a selector or a route a
 * step names has gone. So nothing a step does may stop the tutorial or the
 * app: a `go`, `ready` or `advance` that throws (an anchor that is no longer a
 * valid selector, a route that moved) is caught and counted as "not ready";
 * a step that is never ready times out to a card that says so and offers
 * Next, Back and Skip; and every such miss is recorded as a failed
 * `tour.step` event, so `__sefer.observability.failures()` names the
 * tutorial and step that drifted.
 */
const drifted = (
  context: TourContext,
  tour: Tour,
  index: number,
  why: string,
  error?: unknown,
): void => {
  context.shell.services.composition.observability.note(
    "tour.step",
    "failed",
    error === undefined ? why : `${why}: ${String(error)}`,
    {
      "tour.id": tour.id,
      "tour.step": index + 1,
      ...(tour.steps[index]?.spotlight === undefined
        ? {}
        : { "tour.anchor": tour.steps[index]?.spotlight?.anchor ?? "" }),
    },
  );
};

/** Runs part of a step, and answers `fallback` (once reported) if it throws. */
const safely = <A>(
  context: TourContext,
  tour: Tour,
  index: number,
  part: string,
  run: () => A,
  fallback: A,
  reported: Set<string>,
): A => {
  try {
    return run();
  } catch (error) {
    if (!reported.has(part)) {
      reported.add(part);
      drifted(context, tour, index, `${part} threw`, error);
    }
    return fallback;
  }
};

/** Whether a selector matches; an invalid one simply does not. */
export const anchored = (selector: string): Element | null => {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
};

const anchorPresent = (step: Step): boolean =>
  step.spotlight === undefined || anchored(step.spotlight.anchor) !== null;

const enter = (context: TourContext, tour: Tour, index: number): void => {
  stopPolling();
  const step = tour.steps[index];
  if (step === undefined) {
    setRunning(undefined);
    return;
  }
  const reported = new Set<string>();
  setRunning({ tour, index, phase: "waiting" });
  safely(context, tour, index, "go", () => step.go?.(context), undefined, reported);
  const started = Date.now();
  poll = setInterval(() => {
    const now = running();
    if (now === undefined || now.tour !== tour || now.index !== index) return stopPolling();
    if (now.phase === "waiting") {
      const ready = safely(
        context,
        tour,
        index,
        "ready",
        () => (step.ready ?? (() => anchorPresent(step)))(context),
        false,
        reported,
      );
      if (ready) {
        setRunning({ tour, index, phase: "showing" });
        // A step with nothing to show and no condition of its own has done
        // its job by being reached.
        if (step.spotlight === undefined && step.advance === undefined)
          enter(context, tour, index + 1);
      } else if (Date.now() - started > (step.timeoutMs ?? READY_TIMEOUT_MS)) {
        stopPolling();
        drifted(context, tour, index, "never became ready");
        setRunning({ tour, index, phase: "timedOut" });
      }
      return;
    }
    const advance = step.advance;
    if (
      typeof advance === "function" &&
      safely(context, tour, index, "advance", () => advance(context), false, reported)
    )
      enter(context, tour, index + 1);
  }, POLL_MS);
};

export const startTour = (context: TourContext, tour: Tour): void => {
  enter(context, tour, 0);
};

export const stepTour = (context: TourContext, delta: 1 | -1): void => {
  const now = running();
  if (now === undefined) return;
  enter(context, now.tour, Math.max(0, now.index + delta));
};

export const stopTour = (): void => {
  stopPolling();
  setRunning(undefined);
};
