/**
 * The icon rail: the one piece of chrome that is always on screen.
 *
 * A bar across the top of the window, 56px tall, each tile an icon with its
 * word beside it. (It was a column down the left; the top won.)
 *
 * Three bands, left to right. The mark, inert for now. (The panel's show/hide
 * moved into the panel, beside the project button; `ShowPanel` brings a hidden
 * one back.)
 * The MODES in the middle —
 * Form, Refine, Key terms — the three ways of working on a project's text;
 * with no project open they are there but disabled, so the rail keeps one
 * shape — the empty state's included.
 * Form is not built yet and stays disabled. At the end: More, Import (a zip,
 * a folder or a clone, from anywhere), Settings, and Account (disabled until
 * there is an account).
 *
 * Every enabled tile is a place: a navigation lit from the pathname, never a
 * setting. The project-wide screens that used to sit here (findings, history,
 * glyphs, compare, cloud) live in the "More" menu at the foot until the rail
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
import Sheet from "lucide-solid/icons/sheet";
import TypeIcon from "lucide-solid/icons/type";
import UserIcon from "lucide-solid/icons/user";
import { createSignal, For } from "solid-js";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { ImportHub } from "../landing/ImportHub";
import { Menu, MenuItem, SegmentedControl } from "../primitives";

/**
 * A rail tile: a 48px icon button, the mode switcher's height. The word is the button's name for a screen
 * reader and its native tooltip on hover; it is never drawn — the modes, the
 * one group that needs its words, are the segmented control.
 */
function RailButton(props: {
  readonly label: string;
  readonly testId: string;
  readonly icon: JSX.Element;
  readonly pressed?: "true" | "false";
  readonly disabled?: boolean;
  /** The native tooltip; for a disabled tile, the reason. Defaults to the label. */
  readonly title?: string;
  readonly onClick?: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={props.testId}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      title={props.title ?? props.label}
      onClick={() => props.onClick?.()}
      class="flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl text-on-surface-invert transition-colors hover:not-disabled:bg-surface-invert-hover aria-pressed:bg-surface-invert-active disabled:cursor-not-allowed disabled:opacity-50"
    >
      {props.icon}
      <span class="sr-only">{props.label}</span>
    </button>
  );
}

type Mode = "form" | "refine" | "terms";

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
  const [open, setOpen] = createSignal(false, { name: "railMoreOpen" });
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
        <RailButton
          label={t("More")}
          testId="rail-more"
          pressed={open() ? "true" : "false"}
          icon={<Ellipsis size={24} />}
        />
      }
    >
      <For each={items}>
        {(item) => (
          <MenuItem
            data-testid={`rail-more-${item.to.split("/").pop()}`}
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

export function IconRail() {
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
      data-testid="rail"
      aria-label={t("Sefer")}
      class="scrollbar-subtle flex h-18 w-full shrink-0 items-center gap-4 overflow-x-auto overflow-y-hidden bg-surface-invert px-4 py-2"
    >
      <div class="flex shrink-0 items-center gap-2">
        {/* The mark and the name. Deliberately inert for the moment; the
            mark is `public/sefer.svg`, the tab's icon, used as a MASK so it
            takes the rail's `on-surface-invert` white. */}
        <span data-testid="rail-home" class="flex h-14 shrink-0 items-center gap-3 pe-2">
          <span
            aria-hidden="true"
            class="size-8 bg-on-surface-invert"
            style={{
              "mask-image": "url(/sefer.svg)",
              "mask-size": "contain",
              "mask-repeat": "no-repeat",
              "mask-position": "center",
            }}
          />
          <span class="text-h4 font-semibold text-on-surface-invert max-md:sr-only">
            {t("Sefer")}
          </span>
        </span>
      </div>

      {/* The modes. A choice of one of three ways of working on the text, so
          a radio group (`SegmentedControl`), not three buttons; each still
          navigates. Form is not built; the other two need an open project. */}
      <SegmentedControl<Mode>
        label={t("Mode")}
        size="lg"
        tone="invert"
        // Centred, with the space either side taking up the slack: it grows to
        // its widest (three 10rem tabs), and shrinks before going icon-only.
        class="mx-auto w-full max-w-[31rem] max-md:w-auto"
        value={mode()}
        onChange={goTo}
        items={[
          {
            value: "form",
            label: t("Form"),
            icon: <Sheet size={24} aria-hidden="true" />,
            disabled: true,
            title: t("Form is not built yet."),
          },
          {
            value: "refine",
            label: t("Refine"),
            icon: <FileText size={24} aria-hidden="true" />,
            disabled: !open(),
          },
          {
            value: "terms",
            label: t("Key terms"),
            icon: <ListChecks size={24} aria-hidden="true" />,
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
            <RailButton label={t("Import")} testId="rail-import" icon={<Download size={24} />} />
          }
        />
        <RailButton
          label={t("Settings")}
          testId="rail-settings"
          pressed={at("/settings")}
          icon={<SettingsIcon size={24} />}
          onClick={() => void navigate({ to: "/settings" })}
        />
        {/* A placeholder until there is an account to read a name from. */}
        <RailButton
          label={t("Account")}
          testId="rail-account"
          icon={<UserIcon size={24} />}
          title="TODO: WIP"
          disabled
        />
      </div>
    </nav>
  );
}
