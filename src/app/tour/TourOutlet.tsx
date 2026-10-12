import { useNavigate, useRouterState } from "@tanstack/solid-router";
import { Show, createEffect, createSignal, onCleanup, untrack } from "solid-js";

import { registerCommand, runCommand } from "../commands";
import { t } from "../i18n";
import { useShell } from "../ProjectContext";
import { Button, toasts } from "../ui/primitives";
import { beginTour, runningTour, startTour, stepTour, stopTour, type TourContext } from "./machine";
import { TOURS, tourById } from "./tours";

/**
 * The one place a tutorial is drawn, mounted once in the app chrome so a tour
 * can cross routes: a ring around the step's anchor and a card beside it.
 *
 * It also starts one from the URL. `?tour=<id>` on any screen starts that
 * tutorial and is then taken off the address, so a share link can carry it
 * (`/r/owner/repo/book/JUD?tour=findings`) and a reload does not start it
 * again.
 */

interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** Space between the anchor and its ring, and between the ring and the card. */
const RING_PAD = 6;
const CARD_GAP = 12;
const CARD_WIDTH = 320;

/** The context a step reaches the app through. */
export const useTourContext = (): TourContext => {
  const shell = useShell();
  const navigate = useNavigate();
  return { shell, navigate, run: runCommand };
};

export function TourOutlet() {
  const shell = useShell();
  const navigate = useNavigate();
  const context = useTourContext();
  // One palette command per tutorial, registered for as long as the outlet
  // is mounted, which is the life of the app.
  for (const tour of TOURS) {
    onCleanup(
      registerCommand({
        id: `tour.${tour.id}`,
        title: t("Start tutorial: {title}", { title: t(tour.title) }),
        when: () => !tour.needsProject || tour.start !== undefined || shell.project() !== undefined,
        run: () => beginTour(context, tour),
      }),
    );
  }

  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const path = useRouterState({ select: (state) => state.location.pathname });

  // Started from the URL, then the parameter is taken off so a reload or a
  // copied address does not start it again.
  // Not on `/r/…`, which hands its query on to the project it opens, and not
  // while a project route is still opening its project: the tutorial waits
  // for the project it needs rather than refusing because it came too early.
  createEffect(
    () => {
      const id = new URLSearchParams(searchStr()).get("tour");
      const where = path();
      if (id === null || where.startsWith("/r/")) return null;
      const tour = tourById(id);
      // Opening until the open project is the one the URL names: arriving
      // from another project, the old one is still open for a moment, and a
      // step's `go` would navigate inside it.
      const named = /^\/project\/([^/]+)/u.exec(where)?.[1];
      const opening =
        named !== undefined && (shell.project() === undefined || shell.slug() !== named);
      return tour?.needsProject === true && opening ? null : id;
    },
    (id) => {
      if (id === null) return;
      const rest = new URLSearchParams(untrack(searchStr));
      rest.delete("tour");
      const query = rest.size === 0 ? "" : `?${rest.toString()}`;
      void navigate({ href: `${untrack(path)}${query}`, replace: true });
      const tour = tourById(id);
      if (tour === undefined) {
        toasts.error({ title: t("There is no tutorial called {id}", { id }) });
        return;
      }
      if (tour.needsProject && untrack(shell.project) === undefined) {
        toasts.info({ title: t("Open a project to start “{title}”", { title: t(tour.title) }) });
        return;
      }
      startTour(context, tour);
    },
  );

  const step = () => {
    const now = runningTour();
    return now === undefined ? undefined : now.tour.steps[now.index];
  };

  // Where the anchor is, measured every frame while a step shows: the page
  // under a tutorial scrolls, resizes and re-renders, and the ring follows.
  const [box, setBox] = createSignal<Box | undefined>(undefined);
  let frame = 0;
  let scrolledFor: unknown;
  const measure = (): void => {
    const now = runningTour();
    const anchor = now?.phase === "showing" ? step()?.spotlight?.anchor : undefined;
    const element = anchor === undefined ? null : document.querySelector(anchor);
    if (element === null) setBox(undefined);
    else {
      // Brought into view once per step, not every frame.
      if (scrolledFor !== now) {
        scrolledFor = now;
        element.scrollIntoView({ block: "center", inline: "nearest" });
      }
      const rect = element.getBoundingClientRect();
      const held = box();
      if (
        held === undefined ||
        held.top !== rect.top ||
        held.left !== rect.left ||
        held.width !== rect.width ||
        held.height !== rect.height
      )
        setBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    }
    frame = requestAnimationFrame(measure);
  };
  frame = requestAnimationFrame(measure);
  onCleanup(() => cancelAnimationFrame(frame));

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && runningTour() !== undefined) stopTour();
  };
  document.addEventListener("keydown", onKeyDown);
  onCleanup(() => document.removeEventListener("keydown", onKeyDown));

  /** The card below the anchor when there is room, else above it. */
  const cardStyle = (held: Box): Record<string, string> => {
    const left = Math.min(
      Math.max(CARD_GAP, held.left + held.width / 2 - CARD_WIDTH / 2),
      window.innerWidth - CARD_WIDTH - CARD_GAP,
    );
    const below = held.top + held.height < window.innerHeight * 0.6;
    return below
      ? { top: `${held.top + held.height + RING_PAD + CARD_GAP}px`, left: `${left}px` }
      : {
          bottom: `${window.innerHeight - held.top + RING_PAD + CARD_GAP}px`,
          left: `${left}px`,
        };
  };

  const progress = () => {
    const now = runningTour();
    return now === undefined
      ? ""
      : t("{at} of {count}", { at: now.index + 1, count: now.tour.steps.length });
  };
  const last = () => {
    const now = runningTour();
    return now !== undefined && now.index === now.tour.steps.length - 1;
  };

  const card = (title: string, body: string, style: Record<string, string>) => (
    <div
      role="dialog"
      aria-label={title}
      data-tour-card
      class="pointer-events-auto fixed z-50 flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-primary p-4 shadow-large"
      style={{ width: `${CARD_WIDTH}px`, ...style }}
    >
      <div class="flex items-baseline justify-between gap-3">
        <h2 class="text-base font-semibold text-on-surface-primary">{title}</h2>
        <span class="shrink-0 text-smallest text-on-surface-tertiary tabular-nums">
          {progress()}
        </span>
      </div>
      <p class="text-small text-on-surface-secondary">{body}</p>
      <div class="flex items-center justify-between gap-2">
        <Button size="sm" variant="secondary" onClick={stopTour}>
          {last() ? t("Close") : t("Skip tutorial")}
        </Button>
        <div class="flex gap-2">
          <Show when={(runningTour()?.index ?? 0) > 0}>
            <Button size="sm" variant="secondary" onClick={() => stepTour(context, -1)}>
              {t("Back")}
            </Button>
          </Show>
          <Button
            size="sm"
            variant="primary"
            onClick={() => (last() ? stopTour() : stepTour(context, 1))}
          >
            {last() ? t("Done") : t("Next")}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <Show when={runningTour()}>
      {(now) => (
        <div class="pointer-events-none fixed inset-0 z-50" data-tour-outlet={now().tour.id}>
          <Show when={now().phase === "showing" && step()?.spotlight}>
            {(spotlight) => (
              <Show when={box()}>
                {(held) => (
                  <>
                    <div
                      aria-hidden="true"
                      data-tour-ring
                      class="fixed rounded-lg outline-2 outline-brand shadow-[0_0_0_9999px_rgba(0,0,0,0.25)] transition-all duration-150"
                      style={{
                        top: `${held().top - RING_PAD}px`,
                        left: `${held().left - RING_PAD}px`,
                        width: `${held().width + RING_PAD * 2}px`,
                        height: `${held().height + RING_PAD * 2}px`,
                      }}
                    />
                    {card(t(spotlight().title), t(spotlight().body), cardStyle(held()))}
                  </>
                )}
              </Show>
            )}
          </Show>
          <Show when={now().phase === "timedOut"}>
            {card(
              t("This step could not be shown"),
              t(
                "What it points at is not on screen. The app may have changed since the tutorial was written.",
              ),
              { top: "20vh", left: `calc(50vw - ${CARD_WIDTH / 2}px)` },
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}
