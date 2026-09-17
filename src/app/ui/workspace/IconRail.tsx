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
 * The project tiles appear only while a project is open: a projection, a
 * term list, a character census and a comparison are all things you apply to
 * a project, and offering one with nothing open is an affordance that answers
 * nothing. **Form is not built and has no icon here** — an offered mode that
 * cannot be entered is worse than an absent one
 * (planning/03-ui/design-direction.md).
 *
 * The project-wide screens the rail reaches — `/terms`, `/compare`,
 * `/inventory` — are ROUTES, lit from the pathname, not signals. Key terms
 * used to be `/find?mode=stet`, a mode on the search screen; it is its own
 * pane now ("Find and Key terms are SEPARATE panes/routes with similar UI,
 * not a mode toggle on one page" — design-direction.md, gap list 5), so the
 * tile is a plain navigation and the URL is the whole of its state.
 */

import { useNavigate, useRouterState } from "@tanstack/solid-router";
import Bell from "lucide-solid/icons/bell";
import BookOpen from "lucide-solid/icons/book-open";
import CloudIcon from "lucide-solid/icons/cloud";
import Code from "lucide-solid/icons/code";
import FolderOpen from "lucide-solid/icons/folder-open";
import GitCompare from "lucide-solid/icons/git-compare";
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

  const findings = () => shell.findingCounts();
  const attention = () => findings().errors + findings().warnings;

  // Where in Sefer the reader is, so the rail can say so. A prefix test and
  // not an equality: `/findings` has no children yet, but `/start/*` is the
  // projects screen's second half and must not read as somewhere else.
  const path = useRouterState({ select: (state) => state.location.pathname });
  const at = (prefix: string): "true" | "false" => (path().startsWith(prefix) ? "true" : "false");
  /** Is the reader on the projects side — the list, or bringing one in? */
  const choosing = (): "true" | "false" =>
    path() === "/" || path().startsWith("/start") ? "true" : "false";

  /** Is the reader looking at a project, or at one of the full-page screens? */
  const inProject = (): boolean => path().startsWith("/project/");

  /**
   * The top tile does two jobs, and which one depends on where you are.
   *
   * On a project route it is the panel toggle it has always been. On a
   * full-page screen -- settings, findings, history, compare -- there is no
   * panel to toggle, and what a reader wants from the one tile at the top of
   * the rail is the way BACK: it opens the panel and returns to the book they
   * were in (the remembered location). Left as a plain toggle, pressing it on
   * `/settings` appeared to do nothing at all.
   */
  const togglePanel = (): void => {
    const project = shell.project();
    if (project !== undefined && !inProject()) {
      shell.setSidebarOpen(true);
      void navigate(shell.landingTarget(project.root));
      return;
    }
    shell.setSidebarOpen(!shell.sidebarOpen());
  };

  const panelLabel = (): string => {
    if (shell.project() !== undefined && !inProject()) return t("Back to the book");
    return shell.sidebarShowing() ? t("Hide the project panel") : t("Show the project panel");
  };

  return (
    <nav
      data-testid="rail"
      aria-label={t("Sefer")}
      class="flex w-13 shrink-0 flex-col items-center gap-1 border-e border-sidebar-border bg-surface-primary py-3"
    >
      {/* Pressed reports what is ON SCREEN, not what the preference says: with
          no project and no history the panel has nothing to show and the shell
          collapses it (`shell.sidebarShowing`), and a toggle lit over a
          collapsed panel would be the rail claiming otherwise. The click still
          writes the reader's own answer, which is waiting when a project opens. */}
      <IconButton
        data-testid="rail-panel"
        label={panelLabel()}
        tooltipSide="right"
        icon={<PanelLeft size={18} />}
        aria-pressed={shell.sidebarShowing() ? "true" : "false"}
        onClick={togglePanel}
      />

      <Show when={shell.project() !== undefined}>
        <span aria-hidden="true" class="my-2 h-px w-6 bg-surface-border" />

        <IconButton
          label={t("Refine")}
          data-testid="rail-refine"
          tooltipSide="right"
          icon={<BookOpen size={18} />}
          aria-pressed={shell.mode() === "usfm" ? "false" : "true"}
          onClick={() => shell.setMode("default")}
        />
        <IconButton
          label={t("Key terms")}
          data-testid="rail-terms"
          tooltipSide="right"
          icon={<ListChecks size={18} />}
          aria-pressed={at("/terms")}
          onClick={() =>
            void navigate({
              to: "/project/$slug/terms",
              params: { slug: shell.slug() },
              search: {},
            })
          }
        />
        <IconButton
          label={t("USFM")}
          data-testid="rail-usfm"
          tooltipSide="right"
          icon={<Code size={18} />}
          aria-pressed={shell.mode() === "usfm" ? "true" : "false"}
          onClick={() => shell.setMode("usfm")}
        />
      </Show>

      <div class="mt-auto flex flex-col items-center gap-1">
        {/* The way back out of a project, and the only tile here that means
            something with nothing open. Lit on `/start/*` as well as
            `/projects`: bringing a project in is the chooser's second half,
            and marking only the list would make the rail disagree with the
            screen (`ProjectSidebar` reads the same two prefixes). */}
        <IconButton
          label={t("Projects")}
          data-testid="rail-projects"
          tooltipSide="right"
          aria-pressed={choosing()}
          icon={<FolderOpen size={18} />}
          onClick={() => void navigate({ to: "/" })}
        />

        {/* Which characters this project actually uses, and this project
            against another source. Both are project questions, so the tiles
            are only offered while one is open. */}
        <Show when={shell.project() !== undefined}>
          <IconButton
            label={t("Character inventory")}
            data-testid="rail-inventory"
            tooltipSide="right"
            aria-pressed={at("/inventory")}
            icon={<TypeIcon size={18} />}
            onClick={() =>
              void navigate({
                to: "/project/$slug/inventory",
                params: { slug: shell.slug() },
                search: {},
              })
            }
          />
          <IconButton
            label={t("Compare")}
            data-testid="rail-compare"
            tooltipSide="right"
            aria-pressed={at("/compare")}
            icon={<GitCompare size={18} />}
            onClick={() =>
              void navigate({
                to: "/project/$slug/compare",
                params: { slug: shell.slug() },
                search: {},
              })
            }
          />
          <IconButton
            label={t("Cloud")}
            data-testid="rail-cloud"
            tooltipSide="right"
            aria-pressed={at("/cloud")}
            icon={<CloudIcon size={18} />}
            onClick={() =>
              void navigate({
                to: "/project/$slug/cloud",
                params: { slug: shell.slug() },
                search: {},
              })
            }
          />
        </Show>

        {/* The count rides the button rather than sitting beside it: the rail
            is one tile wide, and a badge in the flow would push the icon off
            its own centre line. */}
        <span class="relative inline-flex">
          <IconButton
            label={t("Findings")}
            data-testid="rail-findings"
            tooltipSide="right"
            aria-pressed={at("/findings")}
            icon={<Bell size={18} />}
            onClick={() =>
              void navigate({
                to: "/project/$slug/findings",
                params: { slug: shell.slug() },
                search: {},
              })
            }
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
          data-testid="rail-history"
          tooltipSide="right"
          aria-pressed={at("/history")}
          icon={<HistoryIcon size={18} />}
          onClick={() =>
            void navigate({
              to: "/project/$slug/history",
              params: { slug: shell.slug() },
              search: {},
            })
          }
        />
        <IconButton
          label={t("Settings")}
          data-testid="rail-settings"
          tooltipSide="right"
          aria-pressed={at("/settings")}
          icon={<SettingsIcon size={18} />}
          onClick={() => void navigate({ to: "/settings" })}
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
