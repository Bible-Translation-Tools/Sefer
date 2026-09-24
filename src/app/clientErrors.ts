// clientErrors.ts
//
// Every client-side failure the app can hear, as one `client.error` note in
// the observability ring, verdict `failed`. There are three doors, and Solid
// is explicit that they do not overlap:
//
//   - `boundary` — Solid's client error hook (`configureClientErrors`): an
//     error boundary caught the error and is rendering its fallback. Nothing
//     else sees these; a rendered fallback never reaches `window.onerror`.
//   - `uncaught` — the browser's `error` event: a throw nothing caught,
//     including a halted reactive graph, which Solid hands to `reportError`.
//   - `rejection` — `unhandledrejection`: a promise nobody awaited failed.
//
// The detail is `describe(error)`, the same reading a toast gets. Owner paths
// are joined labels, present where the runtime keeps owner names (dev).
// `__sefer.observability.errors()` lists them in a dev build.

import { configureClientErrors, type ClientErrorContext } from "solid-js";

import type { ObservabilityService } from "#core/observability";

import { describe } from "./describe";

const CLIENT_ERROR = "client.error";

type Handling = "boundary" | "uncaught" | "rejection";

const path = (labels: readonly string[] | undefined): string | undefined =>
  labels === undefined || labels.length === 0 ? undefined : labels.join(" › ");

/**
 * Starts reporting into `observability`; the returned function stops. A no-op
 * outside a browser (the prerender pass and Node tests have no `window`).
 */
export const reportClientErrors = (observability: ObservabilityService): (() => void) => {
  const note = (handling: Handling, error: unknown, context: ClientErrorContext = {}): void => {
    const owner = path(context.ownerPath);
    const boundary = path(context.boundaryPath);
    observability.note(CLIENT_ERROR, "failed", describe(error), {
      "error.handling": handling,
      ...(owner === undefined ? {} : { "error.owner": owner }),
      ...(boundary === undefined ? {} : { "error.boundary": boundary }),
    });
  };

  configureClientErrors({ onError: (error, context) => note("boundary", error, context) });
  if (typeof window !== "object") return () => configureClientErrors({});

  const onUncaught = (event: ErrorEvent): void => {
    // The browser's notice that a ResizeObserver callback resized something
    // and delivery slipped a frame (the virtualizer and floating-ui both do
    // it). Nothing threw — there is no `error`, only a message.
    if (event.error == null && event.message.startsWith("ResizeObserver loop")) return;
    note("uncaught", event.error ?? event.message);
  };
  const onRejection = (event: PromiseRejectionEvent): void => note("rejection", event.reason);
  window.addEventListener("error", onUncaught);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    configureClientErrors({});
    window.removeEventListener("error", onUncaught);
    window.removeEventListener("unhandledrejection", onRejection);
  };
};
