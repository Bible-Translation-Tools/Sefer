/**
 * The design frame: a screen picker, whatever dials that screen declared, and
 * the screen itself. Everything it knows is in the URL.
 *
 * It is not a screen of the application and it does not open a project. That
 * is the difference from the playground, which sits under `/project/$slug` so
 * an experiment is handed real books: most of what a designer polishes —
 * onboarding, settings, empty states, the shape of a list — needs no text, and
 * those screens have to run on a deployed worker where there is no filesystem
 * and no project to open.
 *
 * The whole of the state is query parameters, which is the point rather than a
 * detail. A designer's workflow is sending two links and asking which is
 * better, so a screen and its dials have to survive copy, paste and reload —
 * and, because the route validates search loosely, adding a dial costs a line
 * in the screen and nothing anywhere else.
 */

import { useNavigate } from "@tanstack/solid-router";
import { For, Show } from "solid-js";

import { Select, SegmentedControl, Switch } from "../../app/ui/primitives";
import { Route } from "../../routes/design";
import { dialValues, withDial, type Dials } from "../dials";
import { screenById, screens } from "./registry";

const SCREEN_KEY = "screen";

/**
 * A string that exists here and nowhere else, so `pnpm verify:design` can ask
 * a real build whether the design surface got into it. Do not delete it while
 * tidying: it is the only thing standing between a bundler changing its mind
 * and this page quietly shipping to production. It is rendered as an attribute
 * rather than kept as a dead constant so that no minifier can decide it is
 * unused.
 */
const SENTINEL = "__sefer_design_surface__";

export function DesignHome() {
  const navigate = useNavigate();
  const search = Route.useSearch();

  /** The first committed screen is the landing one, so `/design` is never blank. */
  const chosen = () => screenById(search()[SCREEN_KEY] ?? "") ?? screens[0];

  const ask = (next: Record<string, string>): void => {
    void navigate({ to: "/design", search: next, replace: true });
  };

  const chooseScreen = (id: string): void => {
    // A screen change drops the previous screen's dials rather than carrying
    // them: they are namespaced, so they would be invisible but still in the
    // URL, and a link nobody can read is the thing this frame is trying to
    // avoid.
    ask(id === screens[0]?.id ? {} : { [SCREEN_KEY]: id });
  };

  const dialsOf = (): Dials => chosen()?.dials ?? {};
  const values = () => dialValues(chosen()?.id ?? "", dialsOf(), search);

  const setDial = (key: string, value: string): void => {
    ask(withDial(search(), chosen()?.id ?? "", dialsOf(), key, value));
  };

  return (
    <main
      class="flex min-h-dvh min-w-0 flex-col"
      data-design-surface={SENTINEL}
      data-design-screen={chosen()?.id ?? ""}
    >
      <header class="flex flex-wrap items-center gap-3 border-b border-outline-subtle px-4 py-2">
        <Show
          when={screens.length > 0}
          fallback={
            <p class="text-smallest text-on-surface-tertiary">
              No design screens yet — add one under <code>screens/</code> or <code>local/</code>.
            </p>
          }
        >
          <SegmentedControl
            size="sm"
            label="Screen"
            value={chosen()?.id ?? ""}
            onChange={chooseScreen}
            items={screens.map((screen) => ({
              value: screen.id,
              label: screen.title,
              title: screen.blurb,
            }))}
          />
        </Show>

        <For each={Object.entries(dialsOf())}>
          {([key, dial]) => (
            <Show
              when={dial.kind === "choice" ? dial : undefined}
              fallback={
                <Switch
                  class="text-smallest text-on-surface-secondary"
                  checked={values().toggle(key)}
                  onChange={(on) => setDial(key, String(on))}
                  label={dial.label}
                />
              }
            >
              {(choice) => (
                <label class="flex items-center gap-1.5 text-smallest text-on-surface-secondary">
                  {choice().label}
                  <Select
                    size="sm"
                    wrapperClass="w-36"
                    value={values().choice(key)}
                    onChange={(event) => setDial(key, event.currentTarget.value)}
                  >
                    <For each={choice().options}>
                      {(option) => <option value={option}>{option}</option>}
                    </For>
                  </Select>
                </label>
              )}
            </Show>
          )}
        </For>
      </header>

      <Show when={chosen()}>
        {(screen) => (
          <div class="min-w-0 flex-1" data-screen={screen().id}>
            {screen().view({ dials: values() })}
          </div>
        )}
      </Show>
    </main>
  );
}
