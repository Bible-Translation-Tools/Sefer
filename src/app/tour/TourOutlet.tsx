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

interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

const RING_PAD = 6;
const CARD_GAP = 12;
const CARD_WIDTH = 400;
const MIN_ROOM = 200;
const DOCKED = { bottom: "24px", right: "24px" };
const CENTRED = { top: "20vh", left: `calc(50vw - ${CARD_WIDTH / 2}px)` };

export const useTourContext = (): TourContext => {
  const shell = useShell();
  const navigate = useNavigate();
  return { shell, navigate, run: runCommand };
};

export function TourOutlet() {
  const shell = useShell();
  const navigate = useNavigate();
  const context = useTourContext();
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

  createEffect(
    () => {
      const query = new URLSearchParams(searchStr());
      const id = query.get("tour") ?? query.get("workflow");
      const where = path();
      if (id === null || where.startsWith("/r/")) return null;
      const tour = tourById(id);
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

  let wrote: string | undefined;
  let writing: ReturnType<typeof setTimeout> | undefined;
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

  const [box, setBox] = createSignal<Box | undefined>(undefined);
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
    setBox(undefined);
    setLost(false);
    if (anchor === undefined) setBox(undefined);
    else frame = requestAnimationFrame(measure);
  });
  onCleanup(() => cancelAnimationFrame(frame));

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

  const [paused, setPaused] = createSignal(false, { name: "tourPaused" });
  createEffect(
    () => runningTour()?.tour,
    () => {
      setPaused(false);
    },
  );

  const cardStyle = (held: Box, side?: "right"): Record<string, string> => {
    const height = window.innerHeight;
    if (side === "right") {
      const top = CARD_GAP;
      const right = held.left + held.width + RING_PAD + CARD_GAP;
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
  const workflow = () => runningTour()?.tour.kind === "workflow";

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
