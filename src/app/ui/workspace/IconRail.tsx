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

import { useNavigate } from "@tanstack/solid-router";
import Bell from "lucide-solid/icons/bell";
import BookOpen from "lucide-solid/icons/book-open";
import Code from "lucide-solid/icons/code";
import HistoryIcon from "lucide-solid/icons/history";
import ListChecks from "lucide-solid/icons/list-checks";
import PanelLeft from "lucide-solid/icons/panel-left";
import SettingsIcon from "lucide-solid/icons/settings";
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

  return (
    <nav
      aria-label={t("Sefer")}
      class="flex w-13 shrink-0 flex-col items-center gap-1 border-e border-sidebar-border bg-surface-primary py-3"
    >
      <IconButton
        label={shell.sidebarOpen() ? t("Hide the project panel") : t("Show the project panel")}
        tooltipSide="right"
        icon={<PanelLeft size={18} />}
        aria-pressed={shell.sidebarOpen() ? "true" : "false"}
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
        {/* The count rides the button rather than sitting beside it: the rail
            is one tile wide, and a badge in the flow would push the icon off
            its own centre line. */}
        <span class="relative inline-flex">
          <IconButton
            label={t("Findings")}
            tooltipSide="right"
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
          icon={<HistoryIcon size={18} />}
          onClick={() => go("/history")}
        />
        <IconButton
          label={t("Settings")}
          tooltipSide="right"
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
