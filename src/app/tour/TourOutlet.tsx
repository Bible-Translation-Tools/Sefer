import { useNavigate, useRouterState } from "@tanstack/solid-router";
import Ellipsis from "lucide-solid/icons/ellipsis";
import Minimize2 from "lucide-solid/icons/minimize-2";
import { For, Show, createEffect, createSignal, onCleanup, untrack } from "solid-js";

import { registerCommand, runCommand } from "../commands";
import { t } from "../i18n";
import { useShell } from "../ProjectContext";
import { Button, IconButton, Menu, MenuItem, toasts } from "../ui/primitives";
import {
  anchored,
  beginTour,
  jumpTour,
  runningTour,
  startTour,
  stepTour,
  stopTour,
  type PanelAction,
  type Spotlight,
  type TourContext,
} from "./machine";
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
const CARD_WIDTH = 400;
/** Less room than this beside an anchor, and the card goes over it instead. */
const MIN_ROOM = 200;
/** Where a workflow's panel sits: the corner, out of the text's way. */
const DOCKED = { bottom: "24px", right: "24px" };
/** Where a card goes with nothing to anchor it to. */
const CENTRED = { top: "20vh", left: `calc(50vw - ${CARD_WIDTH / 2}px)` };

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
  // One palette command per tutorial and per workflow, registered for as
  // long as the outlet is mounted, which is the life of the app. A workflow
  // is a thing to do, so it is listed by its own name ("Triage verse
  // numbers"); a tutorial says it is one.
  for (const tour of TOURS) {
    onCleanup(
      registerCommand({
        id: `${tour.kind}.${tour.id}`,
        title:
          tour.kind === "workflow"
            ? t(tour.title)
            : t("Start tutorial: {title}", { title: t(tour.title) }),
        when: () => !tour.needsProject || tour.start !== undefined || shell.project() !== undefined,
        run: () => beginTour(context, tour),
      }),
    );
  }

  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const path = useRouterState({ select: (state) => state.location.pathname });

  // The URL names the running tutorial and its step (`?tour=<id>&step=<n>`,
  // `?workflow=` for a workflow, n from 1), so a link or a reload opens on
  // that step. Arriving with them starts it there; moving between steps
  // rewrites them; ending it takes them off.
  // Not on `/r/…`, which hands its query on to the project it opens, and not
  // while a project route is still opening its project: the tutorial waits
  // for the project it needs rather than refusing because it came too early.
  createEffect(
    () => {
      const query = new URLSearchParams(searchStr());
      const id = query.get("tour") ?? query.get("workflow");
      const where = path();
      if (id === null || where.startsWith("/r/")) return null;
      const tour = tourById(id);
      // Opening until the open project is the one the URL names: arriving
      // from another project, the old one is still open for a moment, and a
      // step's `go` would navigate inside it.
      const named = /^\/project\/([^/]+)/u.exec(where)?.[1];
      const opening =
        named !== undefined && (shell.project() === undefined || shell.slug() !== named);
      if (tour?.needsProject === true && opening) return null;
      const step = Number(query.get("step") ?? "1");
      return { id, at: Number.isInteger(step) && step > 0 ? step - 1 : 0 };
    },
    (wanted) => {
      if (wanted === null) return;
      const { id, at } = wanted;
      const now = untrack(runningTour);
      // The URL only says where the running tutorial already is.
      if (now !== undefined && now.tour.id === id) {
        if (now.index !== at) jumpTour(context, at);
        return;
      }
      const tour = tourById(id);
      if (tour === undefined) {
        toasts.error({ title: t("There is no tutorial called {id}", { id }) });
        return;
      }
      if (tour.needsProject && untrack(shell.project) === undefined) {
        toasts.info({ title: t("Open a project to start “{title}”", { title: t(tour.title) }) });
        return;
      }
      startTour(context, tour, at);
    },
  );

  // Keeps the URL naming the running step, through every navigation a step
  // makes, and takes it off when the tutorial ends: only what this wrote,
  // never a `?tour=` still waiting for its project to open.
  let wrote: string | undefined;
  let writing: ReturnType<typeof setTimeout> | undefined;
  /**
   * Written a moment later, from where the router IS then: a step's `go`
   * navigates in the same tick its index changes, and rewriting the URL
   * from the old path at once would cancel that navigation.
   */
  const writeStep = (): void => {
    writing = undefined;
    const where = untrack(path);
    if (where.startsWith("/r/")) return;
    const now = untrack(runningTour);
    const query = new URLSearchParams(untrack(searchStr));
    if (now === undefined) {
      if (wrote === undefined || query.get(wrote) === null) return;
      query.delete(wrote);
      query.delete("step");
      wrote = undefined;
    } else {
      const key = now.tour.kind === "workflow" ? "workflow" : "tour";
      const step = String(now.index + 1);
      // Ours to take off when it ends, even when a link or a reload put it there.
      wrote = key;
      if (query.get(key) === now.tour.id && query.get("step") === step) return;
      query.set(key, now.tour.id);
      query.set("step", step);
    }
    const tail = query.size === 0 ? "" : `?${query.toString()}`;
    void navigate({ href: `${where}${tail}`, replace: true });
  };
  createEffect(
    () => ({
      now: runningTour()?.index,
      tour: runningTour()?.tour,
      search: searchStr(),
      where: path(),
    }),
    () => {
      if (writing !== undefined) clearTimeout(writing);
      writing = setTimeout(writeStep, 300);
    },
  );
  onCleanup(() => {
    if (writing !== undefined) clearTimeout(writing);
  });

  const step = () => {
    const now = runningTour();
    return now === undefined ? undefined : now.steps[now.index];
  };

  // Where the anchor is, measured every frame while a spotlight step shows,
  // and not at all otherwise: the page under a tutorial scrolls, resizes and
  // re-renders, and the ring follows.
  const [box, setBox] = createSignal<Box | undefined>(undefined);
  /**
   * The anchor was on screen this step and is not now (a popup the reader
   * stopped hovering). The card stays where it was, without its ring, rather
   * than jumping to the middle and back each time.
   */
  const [lost, setLost] = createSignal(false, { name: "tourAnchorLost" });
  let frame = 0;
  let scrolledFor: unknown;
  const spotlit = () => {
    const now = runningTour();
    return now?.phase === "showing" ? step()?.spotlight?.anchor : undefined;
  };
  const measure = (): void => {
    const now = runningTour();
    const anchor = spotlit();
    if (anchor === undefined) {
      setBox(undefined);
      return;
    }
    const element = anchored(anchor);
    if (element === null) setLost(true);
    else {
      setLost(false);
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
  createEffect(spotlit, (anchor) => {
    cancelAnimationFrame(frame);
    // A new step measures from scratch: a lost anchor is only kept within one.
    setBox(undefined);
    setLost(false);
    if (anchor === undefined) setBox(undefined);
    else frame = requestAnimationFrame(measure);
  });
  onCleanup(() => cancelAnimationFrame(frame));

  // Escape stops a tutorial: one the person is only reading. Not a workflow,
  // which they work underneath, where Escape closes the editor's palettes and
  // popovers all the time; it stops by its Stop button. And not when
  // something else already took the key, unless it came from the card.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    const now = runningTour();
    if (now === undefined || now.tour.kind === "workflow") return;
    const fromCard =
      event.target instanceof Element && event.target.closest("[data-tour-card]") !== null;
    if (event.defaultPrevented && !fromCard) return;
    stopTour();
  };
  document.addEventListener("keydown", onKeyDown);
  onCleanup(() => document.removeEventListener("keydown", onKeyDown));

  /**
   * The card below the anchor when there is room, else above it; beside it,
   * on the right, when the step asks (`Spotlight.side`), clamped to the
   * window.
   */
  /**
   * Paused: the card, the ring and the dimming put away so the whole screen
   * shows, with a small pill to come back. The step keeps listening, so doing
   * what it asked still moves the tutorial on. A new tutorial starts unpaused.
   */
  const [paused, setPaused] = createSignal(false, { name: "tourPaused" });
  createEffect(
    () => runningTour()?.tour,
    () => {
      setPaused(false);
    },
  );

  /**
   * Below the anchor or above it, whichever has more room, the card's height
   * capped to that room (it scrolls inside); when neither has room (an anchor
   * as tall as the window), inside the anchor's top edge. A card is never
   * placed off the screen.
   */
  const cardStyle = (held: Box, side?: "right"): Record<string, string> => {
    const height = window.innerHeight;
    if (side === "right") {
      // A column beside the anchor, from the top of the window: a card under
      // a menu item low on the screen would otherwise have little room and
      // scroll, and scrolling can close the menu it is about.
      const top = CARD_GAP;
      const right = held.left + held.width + RING_PAD + CARD_GAP;
      // No room on the right (a menu near the window's edge): the left, so
      // the card never covers what it is about.
      const left =
        right + CARD_WIDTH + CARD_GAP <= window.innerWidth
          ? right
          : Math.max(CARD_GAP, held.left - RING_PAD - CARD_GAP - CARD_WIDTH);
      return { top: `${top}px`, left: `${left}px`, "max-height": `${height - top - CARD_GAP}px` };
    }
    const left = Math.min(
      Math.max(CARD_GAP, held.left + held.width / 2 - CARD_WIDTH / 2),
      window.innerWidth - CARD_WIDTH - CARD_GAP,
    );
    const below = height - (held.top + held.height + RING_PAD + CARD_GAP) - CARD_GAP;
    const above = held.top - RING_PAD - CARD_GAP - CARD_GAP;
    if (Math.max(below, above) < MIN_ROOM) {
      const top = Math.max(CARD_GAP, held.top) + CARD_GAP;
      return { top: `${top}px`, left: `${left}px`, "max-height": `${height - top - CARD_GAP}px` };
    }
    return below >= above
      ? {
          top: `${held.top + held.height + RING_PAD + CARD_GAP}px`,
          left: `${left}px`,
          "max-height": `${below}px`,
        }
      : {
          bottom: `${height - held.top + RING_PAD + CARD_GAP}px`,
          left: `${left}px`,
          "max-height": `${above}px`,
        };
  };

  const progress = () => {
    const now = runningTour();
    return now === undefined
      ? ""
      : t("{at} of {count}", { at: now.index + 1, count: now.steps.length });
  };
  const last = () => {
    const now = runningTour();
    return now !== undefined && now.index === now.steps.length - 1;
  };
  /** A workflow skips a step and stops; a tutorial moves on and is skipped. */
  const workflow = () => runningTour()?.tour.kind === "workflow";

  /** The step's work looks done: the card says so, and Next replaces Skip. */
  const fixed = () => runningTour()?.fixed === true;

  const card = (
    title: string,
    body: string,
    style: Record<string, string>,
    actions?: readonly PanelAction[],
    more?: Pick<Spotlight, "try" | "notes">,
  ) => (
    <div
      role="dialog"
      aria-label={title}
      data-tour-card
      class="pointer-events-auto fixed z-50 flex flex-col gap-3 overflow-y-auto overscroll-contain rounded-lg border border-surface-border bg-surface-primary p-4 shadow-large"
      style={{ width: `${CARD_WIDTH}px`, ...style }}
    >
      <div class="flex items-baseline justify-between gap-3">
        <h2 class="text-base font-semibold text-on-surface-primary">{title}</h2>
        <span class="flex shrink-0 items-center gap-1 text-smallest text-on-surface-tertiary tabular-nums">
          {progress()}
          <Menu
            label={t("Go to a step")}
            side="bottom"
            align="end"
            // Above the tutorial's own layer (z-50); a popover sits at z-40.
            class="z-60! w-72"
            fitViewport
            trigger={
              <IconButton
                size="sm"
                variant="quiet"
                label={t("Go to a step")}
                icon={<Ellipsis />}
                data-tour-steps
              />
            }
          >
            <For each={runningTour()?.steps ?? []}>
              {(each, at) => (
                <MenuItem onSelect={() => jumpTour(context, at())}>
                  <span
                    class={
                      at() === runningTour()?.index ? "font-semibold text-brand" : "font-normal"
                    }
                  >
                    {`${at() + 1}. ${t(each.spotlight?.title ?? each.panel?.title ?? "")}`}
                  </span>
                </MenuItem>
              )}
            </For>
          </Menu>
          <IconButton
            size="sm"
            variant="quiet"
            label={t("Pause the tutorial")}
            icon={<Minimize2 />}
            data-tour-pause
            onClick={() => setPaused(true)}
          />
        </span>
      </div>
      <p class="text-small text-on-surface-secondary">{body}</p>
      <Show when={more?.try}>
        {(what) => (
          <p
            class="rounded-md border-s-4 border-brand bg-surface-secondary px-3 py-2 text-small font-medium text-on-surface-primary"
            data-tour-try
          >
            {t(what())}
          </p>
        )}
      </Show>
      <For each={more?.notes ?? []}>
        {(note) => (
          <div class="flex flex-col gap-0.5" data-tour-note>
            <span class="text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase">
              {t(note.label)}
            </span>
            <p class="text-small text-on-surface-secondary">{t(note.text)}</p>
          </div>
        )}
      </For>
      <Show when={fixed()}>
        <p class="text-small font-medium text-on-surface-success" data-tour-fixed>
          {t("Looks fixed. Press Next when you are done here.")}
        </p>
      </Show>
      <Show when={actions !== undefined && actions.length > 0 && !fixed()}>
        <div class="flex flex-wrap gap-2" data-tour-actions>
          <For each={actions ?? []}>
            {(action) => (
              <Show when={action.label()}>
                {(label) => (
                  <Button size="sm" variant="secondary" onClick={() => action.run()}>
                    {label()}
                  </Button>
                )}
              </Show>
            )}
          </For>
        </div>
      </Show>
      <div class="flex items-center justify-between gap-2">
        <Button size="sm" variant="secondary" onClick={stopTour}>
          {last() ? t("Close") : workflow() ? t("Stop") : t("Skip tutorial")}
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
            {last() ? t("Done") : workflow() && !fixed() ? t("Skip") : t("Next")}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <Show when={runningTour()}>
      {(now) => (
        <div class="pointer-events-none fixed inset-0 z-50" data-tour-outlet={now().tour.id}>
          <Show when={paused()}>
            <div
              class="pointer-events-auto fixed bottom-4 left-4 z-50 flex items-center gap-3 rounded-full border border-surface-border bg-surface-primary py-1.5 ps-4 pe-1.5 shadow-large"
              data-tour-paused
            >
              <span class="text-small text-on-surface-secondary">
                {t("Tutorial paused · {progress}", { progress: progress() })}
              </span>
              <Button size="sm" variant="primary" onClick={() => setPaused(false)}>
                {t("Resume")}
              </Button>
            </div>
          </Show>
          <Show when={!paused() && now().phase === "showing" && step()?.spotlight}>
            {(spotlight) => (
              // Fail open: an anchor that vanishes after the step showed (a
              // re-render, a screen that moved on) leaves the card in the
              // middle of the screen, still readable and still dismissable,
              // rather than taking every control away with the ring.
              <Show
                when={box()}
                fallback={card(
                  t(spotlight().title),
                  t(spotlight().body),
                  CENTRED,
                  undefined,
                  spotlight(),
                )}
              >
                {(held) => (
                  <>
                    <div
                      aria-hidden="true"
                      hidden={lost()}
                      data-tour-ring
                      class="fixed rounded-lg outline-2 outline-brand shadow-[0_0_0_9999px_rgba(0,0,0,0.25)] transition-all duration-150"
                      style={{
                        top: `${held().top - RING_PAD}px`,
                        left: `${held().left - RING_PAD}px`,
                        width: `${held().width + RING_PAD * 2}px`,
                        height: `${held().height + RING_PAD * 2}px`,
                      }}
                    />
                    {card(
                      t(spotlight().title),
                      t(spotlight().body),
                      cardStyle(held(), spotlight().side),
                      undefined,
                      spotlight(),
                    )}
                  </>
                )}
              </Show>
            )}
          </Show>
          {/* A workflow's panel: docked, no ring, no dimming, because the
              person is working in the screen underneath it. */}
          <Show when={!paused() && now().phase === "showing" && step()?.panel}>
            {(panel) => card(panel().title, panel().body, DOCKED, panel().actions)}
          </Show>
          <Show when={!paused() && now().phase === "timedOut"}>
            {card(
              t("This step could not be shown"),
              t(
                "What it points at is not on screen; the app has probably changed since this tutorial was written. Next skips this step.",
              ),
              CENTRED,
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}
