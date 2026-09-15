/**
 * The icon rail: the one piece of chrome that is always on screen.
 *
 * It is the collapsed sidebar of the mockups' "STET / Ideal" screen promoted
 * to a permanent column, because the two halves answer different questions.
 * The rail is "where in Sefer am I"; the project sidebar beside it is "where
 * in this project am I". Collapsing the sidebar leaves the rail, which is why
 * `Resizable` deliberately does not implement collapsing — a collapsed pane is
 * a different tree, not a zero-width one (primitives/Resizable.tsx).
 *
 * The mode tiles appear only while a project is open: a projection is
 * something you apply to a book, and offering one with nothing open is an
 * affordance that answers nothing. **Form is not built and has no icon here**
 * — an offered mode that cannot be entered is worse than an absent one
 * (planning/03-ui/design-direction.md).
 */

import { useNavigate, useRouterState } from "@tanstack/solid-router";
import Bell from "lucide-solid/icons/bell";
import BookOpen from "lucide-solid/icons/book-open";
import Code from "lucide-solid/icons/code";
import HistoryIcon from "lucide-solid/icons/history";
import ListChecks from "lucide-solid/icons/list-checks";
import PanelLeft from "lucide-solid/icons/panel-left";
import SettingsIcon from "lucide-solid/icons/settings";
import TypeIcon from "lucide-solid/icons/type";
import { Show } from "solid-js";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { IconButton } from "../primitives";

/** The reader's initials, on the tile the mockup puts at the foot of the rail. */
const INITIALS = "GO";

export function IconRail() {
  const navigate = useNavigate();
  const shell = useShell();

  const go = (to: string, search?: Readonly<Record<string, string>>): void => {
    // SAFETY: these are route literals the generated tree knows; the cast is
    // only needed because one of them (`/find?mode=stet`) is owned by a route
    // still being built and its search schema is not declared yet. A path the
    // router cannot resolve goes through its own not-found boundary.
    void navigate({ to: to as never, search: search as never });
  };

  const findings = () => shell.findingCounts();
  const attention = () => findings().errors + findings().warnings;

  // Where in Sefer the reader is, so the rail can say so. A prefix test and
  // not an equality: `/findings` has no children yet, but `/start/*` is the
  // projects screen's second half and must not read as somewhere else.
  const path = useRouterState({ select: (state) => state.location.pathname });
  const at = (prefix: string): "true" | "false" => (path().startsWith(prefix) ? "true" : "false");
  // `/find` in key-terms mode is the tile's own screen, and the mode is in the
  // URL — which is why the route derives it from the search params rather than
  // seeding a signal from them (src/routes/find.tsx).
  const searchMode = useRouterState({
    select: (state) => {
      // SAFETY: the router types this union over every route's own search
      // schema, and only `/find` declares `mode`. The property is read, never
      // called, and the `startsWith` below is what makes the read meaningful.
      const search = state.location.search as { readonly mode?: string };
      return search.mode;
    },
  });
  const stet = (): boolean => path().startsWith("/find") && searchMode() === "stet";

  return (
    <nav
      aria-label={t("Sefer")}
      class="flex w-13 shrink-0 flex-col items-center gap-1 border-e border-sidebar-border bg-surface-primary py-3"
    >
      {/* Pressed reports what is ON SCREEN, not what the preference says: with
          no project and no history the panel has nothing to show and the shell
          collapses it (`shell.sidebarShowing`), and a toggle lit over a
          collapsed panel would be the rail claiming otherwise. The click still
          writes the reader's own answer, which is waiting when a project opens. */}
      <IconButton
        label={shell.sidebarShowing() ? t("Hide the project panel") : t("Show the project panel")}
        tooltipSide="right"
        icon={<PanelLeft size={18} />}
        aria-pressed={shell.sidebarShowing() ? "true" : "false"}
        onClick={() => shell.setSidebarOpen(!shell.sidebarOpen())}
      />

      <Show when={shell.project() !== undefined}>
        <span aria-hidden="true" class="my-2 h-px w-6 bg-surface-border" />

        <IconButton
          label={t("Refine")}
          tooltipSide="right"
          icon={<BookOpen size={18} />}
          aria-pressed={shell.mode() === "usfm" ? "false" : "true"}
          onClick={() => shell.setMode("default")}
        />
        <IconButton
          label={t("Key terms")}
          tooltipSide="right"
          icon={<ListChecks size={18} />}
          aria-pressed={stet() ? "true" : "false"}
          onClick={() => go("/find", { mode: "stet" })}
        />
        <IconButton
          label={t("USFM")}
          tooltipSide="right"
          icon={<Code size={18} />}
          aria-pressed={shell.mode() === "usfm" ? "true" : "false"}
          onClick={() => shell.setMode("usfm")}
        />
      </Show>

      <div class="mt-auto flex flex-col items-center gap-1">
        {/* Which characters this project actually uses. A project question,
            so the tile is only offered while one is open. */}
        <Show when={shell.project() !== undefined}>
          <IconButton
            label={t("Character inventory")}
            tooltipSide="right"
            aria-pressed={at("/inventory")}
            icon={<TypeIcon size={18} />}
            onClick={() => go("/inventory")}
          />
        </Show>

        {/* The count rides the button rather than sitting beside it: the rail
            is one tile wide, and a badge in the flow would push the icon off
            its own centre line. */}
        <span class="relative inline-flex">
          <IconButton
            label={t("Findings")}
            tooltipSide="right"
            aria-pressed={at("/findings")}
            icon={<Bell size={18} />}
            onClick={() => go("/findings")}
          />
          <Show when={attention() > 0}>
            <span
              aria-hidden="true"
              data-findings={attention()}
              class="pointer-events-none absolute -end-1 -top-1 min-w-4 rounded-full bg-on-surface-error px-1 text-center text-smallest leading-4 font-semibold text-surface-error"
            >
              {attention() > 99 ? "99+" : attention()}
            </span>
          </Show>
        </span>

        <IconButton
          label={t("History")}
          tooltipSide="right"
          aria-pressed={at("/history")}
          icon={<HistoryIcon size={18} />}
          onClick={() => go("/history")}
        />
        <IconButton
          label={t("Settings")}
          tooltipSide="right"
          aria-pressed={at("/settings")}
          icon={<SettingsIcon size={18} />}
          onClick={() => go("/settings")}
        />

        {/* A placeholder until there is an account to read a name from: the
            tile is part of the layout, and leaving a hole where it goes would
            make the rail read differently now than it will later. */}
        <span
          class="mt-1 flex size-8 items-center justify-center rounded-full bg-brand-light text-smallest font-semibold text-brand"
          title={t("Signed out")}
        >
          {INITIALS}
        </span>
      </div>
    </nav>
  );
}
