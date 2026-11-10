import { createEffect, createSignal, untrack } from "solid-js";

import type { Shell } from "./ProjectContext";
import { shellKeys } from "./settings";

/**
 * First run (SEFER onboarding): until the person opens a project for the first
 * time, Sefer points at the one thing to do next. Three steps, all read from
 * where the person already is, so there is no tour to start, skip or resume:
 *
 * - `find`: no project yet, on the empty workspace: "Find a project".
 * - `search`: on Projects with nothing loaded: the WACS search box.
 * - `open`: on Projects with a project loaded: that card's Open button.
 *
 * Signing in, going offline or opening the menu changes none of it. Opening a
 * project ends it (`onboarding.done`); deleting every project starts it again,
 * since the person is back where a first run begins.
 */
const [done, setDone] = createSignal<boolean | undefined>(undefined, {
  name: "onboardingDone",
  ownedWrite: true,
});
const [loaded, setLoaded] = createSignal(0, { name: "onboardingLoaded", ownedWrite: true });

type OnboardingStep = "find" | "search" | "open";

export const onboarding = {
  /** Whether first run is still on: until a project has been opened once. */
  active: (): boolean => done() === false,
  /** How many projects the Projects page lists; it tells `search` from `open`. */
  setLoaded,
  step: (where: "workspace" | "projects"): OnboardingStep | undefined => {
    if (done() !== false) return undefined;
    if (where === "workspace") return "find";
    return loaded() > 0 ? "open" : "search";
  },
};

/** Reads the setting once, and ends first run the first time a project opens. */
export const watchOnboarding = (shell: Shell): void => {
  const settings = shell.services.settings;
  const key = shellKeys(settings).onboarded;
  // Someone who already has projects is past first run, setting or not.
  if (done() === undefined)
    setDone(settings.get(key) || untrack(() => shell.recentProjects()).length > 0);
  createEffect(
    () => shell.project() !== undefined,
    (open) => {
      if (!open || done() !== false) return;
      setDone(true);
      void shell.services.run(settings.set(key, true));
    },
  );
  createEffect(
    () => shell.project() === undefined && shell.recentProjects().length === 0,
    (empty) => {
      if (!empty || done() !== true) return;
      setDone(false);
      void shell.services.run(settings.set(key, false));
    },
  );
};
