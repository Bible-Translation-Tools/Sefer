/**
 * The design frame: the screen, and nothing else.
 *
 * There is deliberately no header, no picker bar and no dial row. The screen
 * picker, the variant switch, every tweak and the whole commenting flow live
 * in the floating panel from `src/dev/annotate`, which sits in a corner and
 * minimises to a puck. A prototyping tool that pins a strip of controls across
 * the top of the thing being judged has misunderstood its own job — the
 * designer is here to look at spacing, and the tool was eating forty pixels of
 * it.
 *
 * The frame's whole remaining job is three things:
 *
 *   * choose the screen the URL asks for;
 *   * hand the annotator a `StateAdapter` pointed at the router, so every
 *     variant and tweak is a query parameter somebody can paste into chat;
 *   * give each screen its own values back.
 *
 * It opens no project. That is the difference from the playground, which sits
 * under `/project/$slug` so an experiment is handed real books: most of what a
 * designer polishes needs no text, and those screens have to run on a deployed
 * worker where there is no filesystem and no project to open.
 */

import { getRouteApi, useNavigate } from "@tanstack/solid-router";
import { Show, createEffect, createMemo, onCleanup } from "solid-js";

import { type StateAdapter } from "../annotate";
import { currentVariant, isOn, readTweak } from "../annotate/state";
import { configureDesignSurface, releaseDesignSurface, syncDesignSurface } from "../designSurface";
import { screenById, screens } from "./registry";
import type { Screen } from "./screen";

// By id, not by importing the route module: that module lazy-loads this
// page, so importing it back would make a cycle.
const Route = getRouteApi("/design");

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
  const chosen = createMemo(
    (): Screen | undefined => screenById(search()[SCREEN_KEY] ?? "") ?? screens[0],
    { name: "designScreen" },
  );

  const ask = (next: Readonly<Record<string, string>>): void => {
    void navigate({ to: "/design", search: { ...next }, replace: true });
  };

  /**
   * The seam. The annotator never learns what a router is; it is handed a
   * thing that reads and writes a flat string map, and in this application
   * that map is the URL. `subscribe` is omitted because the Solid effect below
   * already calls `sync()` whenever search changes — one mechanism, not two
   * racing.
   */
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

  // Solid 2 splits the tracked read from the untracked work: the first
  // argument is what this depends on, the second is what to do about it.
  createEffect(
    () => chosen(),
    (screen) => {
      if (screen === undefined) return;
      const options = {
        namespace: screen.id,
        variants: screen.variants ?? [],
        tweaks: screen.tweaks ?? [],
        state: adapter,
        /**
         * The header of a copied batch, and it is nearly empty on purpose.
         *
         * The screen is not named: the URL is right there and reproduces it
         * exactly, and the source location names the file. The build id is
         * named ONLY in a deployed design build, where it is the answer to
         * "which version was the product owner looking at" — in dev it is the
         * sha of a commit whose working tree has almost certainly moved on, so
         * it is worse than nothing. Whoever reads the comment in dev is
         * looking at the same checkout that produced it.
         */
        context: (): Readonly<Record<string, string>> =>
          import.meta.env.DEV ? {} : { build: __SEFER_BUILD__ },
        nav: {
          label: "Screen",
          items: screens.map((one) => ({ value: one.id, label: one.title })),
          active: screen.id,
          // Switching screen drops every parameter: they are namespaced to the
          // screen leaving, so keeping them would put keys in the URL that
          // nothing on the page can explain.
          choose: (id: string) => {
            ask(id === screens[0]?.id ? {} : { [SCREEN_KEY]: id });
          },
        },
      };
      // The root already mounted the one annotator; this screen borrows it
      // rather than raising a second panel beside it.
      configureDesignSurface({ ...options, hotkey: "c" });
    },
  );

  // Reading `search()` is the subscription: any change to the URL redraws the
  // panel, which is what keeps its controls showing what the URL says even when
  // the change came from the Back button rather than from a click on one.
  createEffect(
    () => search(),
    () => {
      syncDesignSurface();
    },
  );

  // Leaving /design hands the panel back: comment-only, no knobs, out of the
  // way. It is not destroyed, because it belongs to the root and the next
  // screen still wants to be commented on.
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
