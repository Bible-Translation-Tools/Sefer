/**
 * The icon rail: the one piece of chrome that is always on screen.
 *
 * Three bands. The mark at the top, inert for now. The MODES in the middle —
 * Form, Refine, Key terms — the three ways of working on a project's text;
 * they are offered with nothing open but disabled, so the rail keeps one shape.
 * Form is not built yet and stays disabled. At the foot: More, Import (the
 * rail slot for bringing a project in, disabled for now), Settings, and Account (a placeholder
 * until there is an account).
 *
 * Every enabled tile is a place: a navigation lit from the pathname, never a
 * setting. The project-wide screens that used to sit here (findings, history,
 * glyphs, compare, cloud) live in the "More" menu at the foot until the rail
 * decides where they belong.
 */

import type { JSX } from "@solidjs/web";
import { useNavigate, useRouterState } from "@tanstack/solid-router";
import Bell from "lucide-solid/icons/bell";
import BookOpen from "lucide-solid/icons/book-open";
import CloudIcon from "lucide-solid/icons/cloud";
import Download from "lucide-solid/icons/download";
import Ellipsis from "lucide-solid/icons/ellipsis";
import GitCompare from "lucide-solid/icons/git-compare";
import HistoryIcon from "lucide-solid/icons/history";
import ListChecks from "lucide-solid/icons/list-checks";
import PenLine from "lucide-solid/icons/pen-line";
import SettingsIcon from "lucide-solid/icons/settings";
import TypeIcon from "lucide-solid/icons/type";
import UserIcon from "lucide-solid/icons/user";
import { createSignal, For } from "solid-js";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Popover } from "../primitives";

/**
 * A rail tile: one 80×80 button holding the icon and the word under it, so
 * the hover and the active fill cover both. Active is the brand blue.
 *
 * The caption is the accessible name already, so there is no tooltip.
 */
function RailButton(props: {
  readonly label: string;
  readonly testId: string;
  readonly icon: JSX.Element;
  readonly pressed?: "true" | "false";
  readonly disabled?: boolean;
  readonly onClick?: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={props.testId}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={() => props.onClick?.()}
      class="flex size-20 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 text-on-surface-invert transition-colors hover:not-disabled:bg-surface-invert-hover aria-pressed:bg-surface-invert-active aria-pressed:hover:bg-surface-invert-active disabled:cursor-not-allowed disabled:opacity-50"
    >
      {props.icon}
      <span class="max-w-full truncate px-1 text-center text-[11px] leading-3">{props.label}</span>
    </button>
  );
}

type ProjectScreen =
  | "/project/$slug/findings"
  | "/project/$slug/history"
  | "/project/$slug/inventory"
  | "/project/$slug/review"
  | "/project/$slug/cloud";

/**
 * The project screens the rail no longer shows, parked in one menu until
 * there is a decision about where each belongs. All need an open project.
 */
function MoreMenu() {
  const navigate = useNavigate();
  const shell = useShell();
  const [open, setOpen] = createSignal(false);
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

  const go = (to: ProjectScreen): void => {
    setOpen(false);
    void navigate({ to, params: { slug: shell.slug() }, search: {} });
  };

  return (
    <Popover
      label={t("More")}
      side="right"
      align="end"
      open={open()}
      onOpenChange={setOpen}
      class="w-52 p-1"
      trigger={
        <RailButton
          label={t("More")}
          testId="rail-more"
          pressed={open() ? "true" : "false"}
          icon={<Ellipsis size={20} />}
        />
      }
    >
      <ul role="menu" class="flex flex-col">
        <For each={items}>
          {(item) => (
            <li role="none">
              <button
                type="button"
                role="menuitem"
                data-testid={`rail-more-${item.to.split("/").pop()}`}
                disabled={shell.project() === undefined}
                class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start hover:not-disabled:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => go(item.to)}
              >
                {item.icon}
                <span class="flex-1">{item.label}</span>
                {item.to === "/project/$slug/findings" && attention() > 0 ? (
                  <span class="min-w-4 rounded-full bg-on-surface-error px-1 text-center text-smallest leading-4 font-semibold text-surface-error">
                    {attention() > 99 ? "99+" : attention()}
                  </span>
                ) : null}
              </button>
            </li>
          )}
        </For>
      </ul>
    </Popover>
  );
}

export function IconRail() {
  const navigate = useNavigate();
  const shell = useShell();

  const path = useRouterState({ select: (state) => state.location.pathname });
  // Project screens are tested on the part after `/project/$slug`, so
  // `at("/terms")` means "this project's terms".
  const within = (): string => path().replace(/^\/project\/[^/]+/, "");
  const at = (prefix: string): "true" | "false" => (within().startsWith(prefix) ? "true" : "false");
  const open = (): boolean => shell.project() !== undefined;
  /**
   * Nothing installed: the modes still switch, but there is no project to
   * navigate into, so the choice is only remembered here. Refine by default.
   */
  const empty = (): boolean => shell.firstRun();
  const [emptyMode, setEmptyMode] = createSignal<"refine" | "terms">("refine", {
    name: "emptyMode",
  });

  /** Refine is the text itself: any project route that is not another mode. */
  const refining = (): "true" | "false" => {
    if (empty()) return emptyMode() === "refine" ? "true" : "false";
    return path().startsWith("/project/") && !within().startsWith("/terms") ? "true" : "false";
  };
  const terms = (): "true" | "false" => {
    if (empty()) return emptyMode() === "terms" ? "true" : "false";
    return at("/terms");
  };

  return (
    <nav
      data-testid="rail"
      aria-label={t("Sefer")}
      class="scrollbar-subtle flex w-20 shrink-0 flex-col items-center overflow-x-hidden overflow-y-auto bg-surface-invert px-0 py-4"
    >
      {/* The mark. Deliberately inert for the moment; it is the same
          `public/sefer.svg` the tab shows, at 32px in an 80px box, used as a
          MASK so it takes the rail's `on-surface-invert` white. */}
      <span
        data-testid="rail-home"
        role="img"
        aria-label={t("Sefer")}
        class="flex size-20 shrink-0 items-center justify-center"
      >
        <span
          class="size-8 bg-on-surface-invert"
          style={{
            "mask-image": "url(/sefer.svg)",
            "mask-size": "contain",
            "mask-repeat": "no-repeat",
            "mask-position": "center",
          }}
        />
      </span>

      <div class="my-auto flex w-full flex-col items-center">
        <RailButton label={t("Form")} testId="rail-form" icon={<PenLine size={20} />} disabled />
        <RailButton
          label={t("Refine")}
          testId="rail-refine"
          icon={<BookOpen size={20} />}
          pressed={refining()}
          disabled={!empty() && !open()}
          onClick={() => {
            if (empty()) setEmptyMode("refine");
            else void navigate({ to: "/project/$slug", params: { slug: shell.slug() } });
          }}
        />
        <RailButton
          label={t("Key terms")}
          testId="rail-terms"
          icon={<ListChecks size={20} />}
          pressed={terms()}
          disabled={!empty() && !open()}
          onClick={() => {
            if (empty()) setEmptyMode("terms");
            else
              void navigate({
                to: "/project/$slug/terms",
                params: { slug: shell.slug() },
                search: {},
              });
          }}
        />
      </div>

      <div class="flex w-full flex-col items-center">
        <MoreMenu />
        {/* Disabled for now: the one way to the projects page is the
            sidebar's project control. Kept on the rail for its place. */}
        <RailButton
          label={t("Import")}
          testId="rail-import"
          icon={<Download size={20} />}
          disabled
        />
        <RailButton
          label={t("Settings")}
          testId="rail-settings"
          pressed={at("/settings")}
          icon={<SettingsIcon size={20} />}
          onClick={() => void navigate({ to: "/settings" })}
        />
        {/* A placeholder until there is an account to read a name from. */}
        <RailButton label={t("Account")} testId="rail-account" icon={<UserIcon size={20} />} />
      </div>
    </nav>
  );
}
