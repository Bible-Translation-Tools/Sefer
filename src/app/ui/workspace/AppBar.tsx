/**
 * The app bar: the one piece of chrome that is always on screen.
 *
 * A bar across the top of the window in the theme's own surface — white in
 * light, the dark surface in dark — with a hairline under it. (It was a
 * column down the left; the top won.)
 *
 * Three bands, left to right. The mark, which is the way home. (The project
 * panel's show/hide is `PanelToggle`, beside the book's title or in its own
 * column, not here.) The MODES in the middle — Refine and Key terms — the
 * ways of working on a project's text; with no project open they are there
 * but disabled, so the bar keeps one shape — the empty state's included. A
 * mode joins when it is built, not before. At the end: More, Import (a zip,
 * a folder or a clone, from anywhere), Settings, and Account (disabled until
 * there is an account).
 *
 * Every enabled tile is a place: a navigation lit from the pathname, never a
 * setting. The project-wide screens that used to sit here (findings, history,
 * glyphs, compare, cloud) live in the "More" menu at the end until the bar
 * decides where they belong.
 */

import type { JSX } from "@solidjs/web";
import { useNavigate, useRouterState } from "@tanstack/solid-router";
import Bell from "lucide-solid/icons/bell";
import CloudIcon from "lucide-solid/icons/cloud";
import Download from "lucide-solid/icons/download";
import Ellipsis from "lucide-solid/icons/ellipsis";
import FileText from "lucide-solid/icons/file-text";
import GitCompare from "lucide-solid/icons/git-compare";
import HistoryIcon from "lucide-solid/icons/history";
import ListChecks from "lucide-solid/icons/list-checks";
import SettingsIcon from "lucide-solid/icons/settings";
import TypeIcon from "lucide-solid/icons/type";
import UserIcon from "lucide-solid/icons/user";
import { createSignal, For } from "solid-js";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { ImportHub } from "../landing/ImportHub";
import { IconButton, Menu, MenuItem, SegmentedControl } from "../primitives";

/**
 * A bar button: the shared `IconButton` at its default (`md`, `subtle`), so
 * the bar's buttons look like every other icon button — the word is its
 * name and its tooltip, never drawn.
 */
function BarButton(props: {
  readonly label: string;
  readonly testId: string;
  readonly icon: JSX.Element;
  readonly pressed?: "true" | "false";
  readonly disabled?: boolean;
  /** The native tooltip; for a disabled tile, the reason. */
  readonly title?: string;
  readonly onClick?: () => void;
}) {
  return (
    <IconButton
      label={props.label}
      data-testid={props.testId}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      title={props.title}
      tooltipSide="bottom"
      icon={props.icon}
      onClick={() => props.onClick?.()}
    />
  );
}

type Mode = "refine" | "terms";

type ProjectScreen =
  | "/project/$slug/findings"
  | "/project/$slug/history"
  | "/project/$slug/inventory"
  | "/project/$slug/review"
  | "/project/$slug/cloud";

/**
 * The project screens the bar no longer shows, parked in one menu until
 * there is a decision about where each belongs. All need an open project.
 */
function MoreMenu() {
  const navigate = useNavigate();
  const shell = useShell();
  const [open, setOpen] = createSignal(false, { name: "appBarMoreOpen" });
  const attention = () => shell.findingCounts().errors + shell.findingCounts().warnings;

  const items: ReadonlyArray<{ label: string; to: ProjectScreen; icon: JSX.Element }> = [
    { label: t("Findings"), to: "/project/$slug/findings", icon: <Bell size={16} /> },
    { label: t("History"), to: "/project/$slug/history", icon: <HistoryIcon size={16} /> },
    {
      label: t("Character inventory"),
      to: "/project/$slug/inventory",
      icon: <TypeIcon size={16} />,
    },
    { label: t("Compare"), to: "/project/$slug/review", icon: <GitCompare size={16} /> },
    { label: t("Cloud"), to: "/project/$slug/cloud", icon: <CloudIcon size={16} /> },
  ];

  return (
    <Menu
      label={t("More")}
      side="bottom"
      align="end"
      open={open()}
      onOpenChange={setOpen}
      class="w-52"
      trigger={
        <BarButton
          label={t("More")}
          testId="app-bar-more"
          pressed={open() ? "true" : "false"}
          icon={<Ellipsis size={20} />}
        />
      }
    >
      <For each={items}>
        {(item) => (
          <MenuItem
            data-testid={`app-bar-more-${item.to.split("/").pop()}`}
            disabled={shell.project() === undefined}
            icon={item.icon}
            onSelect={() =>
              void navigate({ to: item.to, params: { slug: shell.slug() }, search: {} })
            }
          >
            <span class="flex-1">{item.label}</span>
            {item.to === "/project/$slug/findings" && attention() > 0 ? (
              <span class="min-w-4 rounded-full bg-on-surface-error px-1 text-center text-smallest leading-4 font-semibold text-surface-error">
                {attention() > 99 ? "99+" : attention()}
              </span>
            ) : null}
          </MenuItem>
        )}
      </For>
    </Menu>
  );
}

export function AppBar() {
  const navigate = useNavigate();
  const shell = useShell();

  const path = useRouterState({ select: (state) => state.location.pathname });
  // Project screens are tested on the part after `/project/$slug`, so
  // `at("/terms")` means "this project's terms".
  const within = (): string => path().replace(/^\/project\/[^/]+/, "");
  const at = (prefix: string): "true" | "false" => (within().startsWith(prefix) ? "true" : "false");
  const open = (): boolean => shell.project() !== undefined;

  /** Refine is the text itself: any project route that is not another mode. */
  const refining = (): "true" | "false" =>
    path().startsWith("/project/") && !within().startsWith("/terms") ? "true" : "false";
  const terms = (): "true" | "false" => at("/terms");
  /**
   * Home: with a project open, back to where the reader left off in it —
   * `/project/$slug`, which decides, as Back to editor does; otherwise `/`, which decides —
   * the last project reopens where it was left, an empty device shows the
   * empty state, and projects never opened here show the projects page.
   */
  const goHome = (): void => {
    if (shell.project() !== undefined)
      void navigate({ to: "/project/$slug", params: { slug: shell.slug() } });
    else void navigate({ to: "/" });
  };

  /** Which mode the switcher shows as chosen; none on a screen outside them. */
  const mode = (): Mode | undefined =>
    terms() === "true" ? "terms" : refining() === "true" ? "refine" : undefined;
  const goTo = (next: Mode): void => {
    if (next === "refine") void navigate({ to: "/project/$slug", params: { slug: shell.slug() } });
    else if (next === "terms")
      void navigate({ to: "/project/$slug/terms", params: { slug: shell.slug() }, search: {} });
  };

  return (
    <nav
      data-testid="app-bar"
      aria-label={t("Sefer")}
      class="scrollbar-subtle flex h-18 w-full shrink-0 items-center gap-4 overflow-x-auto overflow-y-hidden border-b border-surface-border bg-surface-primary px-4 py-2"
    >
      <div class="flex shrink-0 items-center gap-2">
        {/* The mark and the name: the way home (see `goHome`). The mark is
            `public/sefer.svg`, the tab's icon, used as a MASK so it takes the
            theme's text colour in light and dark alike. */}
        <button
          type="button"
          data-testid="app-bar-home"
          aria-label={t("Home")}
          title={t("Home")}
          class="flex h-12 shrink-0 cursor-pointer items-center gap-3 rounded-lg px-2 transition-colors hover:bg-surface-secondary"
          onClick={goHome}
        >
          <span
            aria-hidden="true"
            class="size-8 bg-on-surface-primary"
            style={{
              "mask-image": "url(/sefer.svg)",
              "mask-size": "contain",
              "mask-repeat": "no-repeat",
              "mask-position": "center",
            }}
          />
          <span
            aria-hidden="true"
            class="text-h4 font-semibold text-on-surface-primary max-md:sr-only"
          >
            {t("Sefer")}
          </span>
        </button>
      </div>

      {/* The modes. A choice of one way of working on the text, so a radio
          group (`SegmentedControl`), not buttons; each still navigates, and
          each needs an open project. */}
      <SegmentedControl<Mode>
        label={t("Mode")}
        iconsWhenNarrow
        // Centred, with the space either side taking up the slack: it grows to
        // its widest (two 10rem tabs in the track), and shrinks before going
        // icon-only.
        class="mx-auto w-full max-w-[20.75rem] max-md:w-auto"
        value={mode()}
        onChange={goTo}
        items={[
          {
            value: "refine",
            label: t("Refine"),
            icon: <FileText aria-hidden="true" />,
            disabled: !open(),
          },
          {
            value: "terms",
            label: t("Key terms"),
            icon: <ListChecks aria-hidden="true" />,
            disabled: !open(),
          },
        ]}
      />

      <div class="flex shrink-0 items-center gap-2">
        <MoreMenu />
        {/* The import menu from anywhere; a finished import lands on the
            projects page, where the new project is. */}
        <ImportHub
          variant="menu"
          onImported={() => void navigate({ to: "/projects" })}
          trigger={
            <BarButton label={t("Import")} testId="app-bar-import" icon={<Download size={20} />} />
          }
        />
        <BarButton
          label={t("Settings")}
          testId="app-bar-settings"
          pressed={at("/settings")}
          icon={<SettingsIcon size={20} />}
          onClick={() => void navigate({ to: "/settings" })}
        />
        {/* A placeholder until there is an account to read a name from. */}
        <BarButton
          label={t("Account")}
          testId="app-bar-account"
          icon={<UserIcon size={20} />}
          title="TODO: WIP"
          disabled
        />
      </div>
    </nav>
  );
}
