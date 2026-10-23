import { getRouteApi, useNavigate } from "@tanstack/solid-router";
import { Show, createEffect, createMemo, onCleanup } from "solid-js";

import { type StateAdapter } from "../annotate";
import { currentVariant, isOn, readTweak } from "../annotate/state";
import { configureDesignSurface, releaseDesignSurface, syncDesignSurface } from "../designSurface";
import { screenById, screens } from "./registry";
import type { Screen } from "./screen";

const Route = getRouteApi("/design");

const SCREEN_KEY = "screen";

const SENTINEL = "__sefer_design_surface__";

export function DesignHome() {
  const navigate = useNavigate();
  const search = Route.useSearch();

  const chosen = createMemo(
    (): Screen | undefined => screenById(search()[SCREEN_KEY] ?? "") ?? screens[0],
    { name: "designScreen" },
  );

  const ask = (next: Readonly<Record<string, string>>): void => {
    void navigate({ to: "/design", search: { ...next }, replace: true });
  };

  const adapter: StateAdapter = {
    read: () => search(),
    write: ask,
  };

  const tweakOf = (key: string): string => {
    const screen = chosen();
    if (screen === undefined) return "";
    const state = search();
    const showing = currentVariant(screen.id, screen.variants ?? [], state);
    const own = showing?.tweaks?.find((tweak) => tweak.key === key);
    if (own !== undefined) return readTweak(screen.id, showing?.id ?? null, own, state);
    const shared = screen.tweaks?.find((tweak) => tweak.key === key);
    return shared === undefined ? "" : readTweak(screen.id, null, shared, state);
  };

  createEffect(
    () => chosen(),
    (screen) => {
      if (screen === undefined) return;
      const options = {
        namespace: screen.id,
        variants: screen.variants ?? [],
        tweaks: screen.tweaks ?? [],
        state: adapter,
        context: (): Readonly<Record<string, string>> =>
          import.meta.env.DEV ? {} : { build: __SEFER_BUILD__ },
        nav: {
          label: "Screen",
          items: screens.map((one) => ({ value: one.id, label: one.title })),
          active: screen.id,
          choose: (id: string) => {
            ask(id === screens[0]?.id ? {} : { [SCREEN_KEY]: id });
          },
        },
      };
      configureDesignSurface({ ...options, hotkey: "c" });
    },
  );

  createEffect(
    () => search(),
    () => {
      syncDesignSurface();
    },
  );

  onCleanup(releaseDesignSurface);

  return (
    <main
      class="min-h-dvh min-w-0"
      data-design-surface={SENTINEL}
      data-design-screen={chosen()?.id ?? ""}
    >
      <Show
        when={chosen()}
        fallback={
          <p class="p-6 text-small text-on-surface-tertiary">
            No design screens yet — add one under <code>screens/</code> or <code>local/</code>.
          </p>
        }
      >
        {(screen) => (
          <div class="min-w-0" data-screen={screen().id}>
            {screen().view({
              variant: () =>
                currentVariant(screen().id, screen().variants ?? [], search())?.id ?? "",
              tweak: tweakOf,
              on: (key) => isOn(tweakOf(key)),
            })}
          </div>
        )}
      </Show>
    </main>
  );
}
