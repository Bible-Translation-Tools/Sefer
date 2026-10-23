import { configureClientErrors, type ClientErrorContext } from "solid-js";

import type { ObservabilityService } from "#core/observability";

import { describe } from "./describe";

const CLIENT_ERROR = "client.error";

type Handling = "boundary" | "uncaught" | "rejection";

const path = (labels: readonly string[] | undefined): string | undefined =>
  labels === undefined || labels.length === 0 ? undefined : labels.join(" › ");

export const reportClientErrors = (observability: ObservabilityService): (() => void) => {
  const note = (handling: Handling, error: unknown, context: ClientErrorContext = {}): void => {
    const owner = path(context.ownerPath);
    const boundary = path(context.boundaryPath);
    observability.note(CLIENT_ERROR, "failed", describe(error), {
      "error.handling": handling,
      "error.type": error instanceof Error ? error.name : typeof error,
      ...(owner === undefined ? {} : { "error.owner": owner }),
      ...(boundary === undefined ? {} : { "error.boundary": boundary }),
    });
  };

  configureClientErrors({ onError: (error, context) => note("boundary", error, context) });
  if (typeof window !== "object") return () => configureClientErrors({});

  const onUncaught = (event: ErrorEvent): void => {
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
