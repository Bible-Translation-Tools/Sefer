import { RouterProvider, createRouter } from "@tanstack/solid-router";
import { Result } from "effect";
import { Show } from "solid-js";

import { composeApplication } from "#app/composition";
import { CompositionProvider, useComposition } from "#app/CompositionContext";
import { DelayedSpinner, PENDING_MS } from "#app/ui/primitives";

import "#app/ui/app.css";

import { routeTree } from "./routeTree.gen";

const router = createRouter({
  routeTree,
  defaultPendingMs: PENDING_MS,
  defaultPendingComponent: DelayedSpinner,
});

declare module "@tanstack/solid-router" {
  interface Register {
    router: typeof router;
  }
}

const composition = await composeApplication();

function Shell() {
  const composed = useComposition();
  const booted = Result.isSuccess(composed.boot) ? composed.boot.success : null;
  const bootErrorTag = Result.isFailure(composed.boot) ? composed.boot.failure._tag : "";

  return (
    <Show
      when={booted}
      fallback={<main data-boot-error={bootErrorTag}>boot failed: {bootErrorTag}</main>}
    >
      {(info) => (
        <>
          <div data-host={info().host} data-build={info().build} data-boot-phase={info().phase} />
          <RouterProvider router={router} />
        </>
      )}
    </Show>
  );
}

export default function App() {
  return (
    <CompositionProvider value={composition}>
      <Shell />
    </CompositionProvider>
  );
}
