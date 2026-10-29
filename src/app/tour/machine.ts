import type { UseNavigateResult } from "@tanstack/solid-router";
import { createSignal } from "solid-js";

import type { Shell } from "../ProjectContext";

export interface TourContext {
  readonly shell: Shell;
  readonly navigate: UseNavigateResult<string>;
  readonly run: (command: string, argument?: unknown) => void;
}

export interface Panel {
  readonly title: string;
  readonly body: string;
  readonly actions?: readonly PanelAction[];
}

export interface PanelAction {
  readonly label: () => string | undefined;
  readonly run: () => void;
}

export interface SpotlightNote {
  readonly label: string;
  readonly text: string;
}

export interface Spotlight {
  readonly anchor: string;
  readonly title: string;
  readonly body: string;
  readonly try?: string;
  readonly notes?: readonly SpotlightNote[];
  readonly side?: "right";
}

export interface Step {
  readonly go?: (context: TourContext) => void;
  readonly ready?: (context: TourContext) => boolean;
  readonly spotlight?: Spotlight;
  readonly panel?: Panel;
  readonly done?: (context: TourContext) => boolean;
  readonly advance?: "user" | ((context: TourContext) => boolean);
  readonly timeoutMs?: number;
}

export interface Tour {
  readonly id: string;
  readonly kind: "tutorial" | "workflow";
  /**
   * Who it is for. A `field` tour is part of the product: permanent, and its
   * words are messages, translated. An `internal` tour is a note to the PO
   * and the designer about a design and its trade-offs (Line by line's): it
   * ships only in design builds and stays English, outside the catalog
   * (Will, 2026-10-22: "they are different purposes").
   */
  readonly audience: "field" | "internal";
  readonly title: string;
  readonly summary: string;
  readonly needsProject: boolean;
  readonly start?: string;
  readonly steps: readonly Step[] | ((context: TourContext) => readonly Step[]);
  readonly startable?: (context: TourContext) => boolean;
}

const startUrl = (tour: Tour, start: string): string =>
  `${start}${start.includes("?") ? "&" : "?"}tour=${encodeURIComponent(tour.id)}`;

export const beginTour = (context: TourContext, tour: Tour): void => {
  if (tour.start === undefined) startTour(context, tour);
  else void context.navigate({ href: startUrl(tour, tour.start) });
};

interface Running {
  readonly tour: Tour;
  readonly steps: readonly Step[];
  readonly index: number;
  readonly phase: "waiting" | "showing" | "timedOut";
  readonly fixed: boolean;
  /**
   * The step's `advance` has come true. The tour does not move on by itself:
   * the card says the step is done and Next is for the person to press, so
   * Back is never undone by a condition that is still true (the PO, 2026-10-23).
   */
  readonly reached: boolean;
}

const [running, setRunning] = createSignal<Running | undefined>(undefined, {
  name: "tour",
  equals: false,
});
export const runningTour = running;

const READY_TIMEOUT_MS = 10_000;
const POLL_MS = 100;

let poll: ReturnType<typeof setInterval> | undefined;
const stopPolling = (): void => {
  if (poll !== undefined) clearInterval(poll);
  poll = undefined;
};

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
      ...(running()?.steps[index]?.spotlight === undefined
        ? {}
        : { "tour.anchor": running()?.steps[index]?.spotlight?.anchor ?? "" }),
    },
  );
};

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

export const anchored = (selector: string): Element | null => {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
};

const anchorPresent = (step: Step): boolean =>
  step.spotlight === undefined || anchored(step.spotlight.anchor) !== null;

const enter = (context: TourContext, tour: Tour, steps: readonly Step[], index: number): void => {
  stopPolling();
  const step = steps[index];
  if (step === undefined) {
    setRunning(undefined);
    return;
  }
  const reported = new Set<string>();
  setRunning({ tour, steps, index, phase: "waiting", fixed: false, reached: false });
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
        setRunning({ tour, steps, index, phase: "showing", fixed: false, reached: false });
        if (step.spotlight === undefined && step.panel === undefined && step.advance === undefined)
          enter(context, tour, steps, index + 1);
      } else if (Date.now() - started > (step.timeoutMs ?? READY_TIMEOUT_MS)) {
        stopPolling();
        drifted(context, tour, index, "never became ready");
        setRunning({ tour, steps, index, phase: "timedOut", fixed: false, reached: false });
      }
      return;
    }
    const done = step.done;
    if (done !== undefined) {
      const fixed = safely(context, tour, index, "done", () => done(context), false, reported);
      if (fixed !== now.fixed) setRunning({ ...now, fixed });
    }
    const advance = step.advance;
    if (
      typeof advance === "function" &&
      !now.reached &&
      safely(context, tour, index, "advance", () => advance(context), false, reported)
    )
      setRunning({ ...(running() ?? now), reached: true });
  }, POLL_MS);
};

export const startTour = (context: TourContext, tour: Tour, at = 0): void => {
  stopPolling();
  const startable = tour.startable;
  if (startable !== undefined) {
    const started = Date.now();
    const ready = (): boolean => {
      try {
        return startable(context);
      } catch {
        return true;
      }
    };
    if (!ready()) {
      setRunning(undefined);
      poll = setInterval(() => {
        if (ready() || Date.now() - started > READY_TIMEOUT_MS) {
          stopPolling();
          build(context, tour, at);
        }
      }, POLL_MS);
      return;
    }
  }
  build(context, tour, at);
};

const build = (context: TourContext, tour: Tour, at = 0): void => {
  let steps: readonly Step[] = [];
  try {
    steps = typeof tour.steps === "function" ? tour.steps(context) : tour.steps;
  } catch (error) {
    context.shell.services.composition.observability.note(
      "tour.step",
      "failed",
      `steps threw: ${String(error)}`,
      { "tour.id": tour.id },
    );
  }
  enter(context, tour, steps, Math.min(Math.max(0, at), Math.max(0, steps.length - 1)));
};

export const jumpTour = (context: TourContext, index: number): void => {
  const now = running();
  if (now === undefined) return;
  enter(context, now.tour, now.steps, Math.min(Math.max(0, index), now.steps.length - 1));
};

export const stepTour = (context: TourContext, delta: 1 | -1): void => {
  const now = running();
  if (now === undefined) return;
  enter(context, now.tour, now.steps, Math.max(0, now.index + delta));
};

export const stopTour = (): void => {
  stopPolling();
  setRunning(undefined);
};
