import type { JSX } from "@solidjs/web";
import { useNavigate, useRouterState } from "@tanstack/solid-router";
import Bell from "lucide-solid/icons/bell";
import Ellipsis from "lucide-solid/icons/ellipsis";
import FileText from "lucide-solid/icons/file-text";
import GitCompare from "lucide-solid/icons/git-compare";
import HistoryIcon from "lucide-solid/icons/history";
import ListChecks from "lucide-solid/icons/list-checks";
import Rows3 from "lucide-solid/icons/rows-3";
import SettingsIcon from "lucide-solid/icons/settings";
import TypeIcon from "lucide-solid/icons/type";
import UserIcon from "lucide-solid/icons/user";
import { Show, createSignal, For } from "solid-js";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { SyncPopover, createSync, syncGlyph, syncHeadline } from "../cloud/SyncButton";
import { IconButton, Menu, MenuItem, MenuSeparator, SegmentedControl, cx } from "../primitives";
import { ProjectTools } from "./Toolbar";

function BarButton(props: {
  readonly label: string;
  readonly testId: string;
  readonly icon: JSX.Element;
  readonly pressed?: "true" | "false";
  readonly disabled?: boolean;
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

/** Refine is the book as it reads; Form Mode is the same book one verse per line (design builds only). */
type Mode = "refine" | "form" | "terms";

type ProjectScreen =
  | "/project/$slug/findings"
  | "/project/$slug/history"
  | "/project/$slug/inventory"
  | "/project/$slug/review";

function MoreMenu() {
  const navigate = useNavigate();
  const shell = useShell();
  const [open, setOpen] = createSignal(false, { name: "appBarMoreOpen" });
  const attention = () => shell.findingCounts().errors + shell.findingCounts().warnings;
  // Sync lives here, first in the menu: the row names its state, and opens
  // the same popover the cloud button did, dropped from this button.
  const sync = createSync(shell);

  const items: ReadonlyArray<{ label: string; to: ProjectScreen; icon: JSX.Element }> = [
    { label: t("Findings"), to: "/project/$slug/findings", icon: <Bell size={16} /> },
    { label: t("History"), to: "/project/$slug/history", icon: <HistoryIcon size={16} /> },
    {
      label: t("Character inventory"),
      to: "/project/$slug/inventory",
      icon: <TypeIcon size={16} />,
    },
    { label: t("Compare"), to: "/project/$slug/review", icon: <GitCompare size={16} /> },
  ];

  return (
    <span class="relative inline-flex">
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
        <Show when={shell.project() !== undefined}>
          <MenuItem
            data-testid="app-bar-sync"
            icon={syncGlyph(sync)}
            class={sync.pop.attention() !== "none" ? "text-on-surface-warning" : undefined}
            onSelect={() => setTimeout(() => sync.pop.openChanged(true))}
          >
            {syncHeadline(sync)}
          </MenuItem>
          <MenuSeparator />
        </Show>
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
      <span class="absolute end-0 bottom-0">
        <Show when={shell.project() !== undefined}>
          <SyncPopover sync={sync} />
        </Show>
      </span>
    </span>
  );
}

function HomeButton() {
  const navigate = useNavigate();
  const shell = useShell();
  const goHome = (): void => {
    if (shell.project() !== undefined)
      void navigate({ to: "/project/$slug", params: { slug: shell.slug() } });
    else void navigate({ to: "/" });
  };

  return (
    <div class="flex shrink-0 items-center gap-2">
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
  );
}

function ModeControl(props: {
  mode: Mode | undefined;
  open: boolean;
  onChange: (next: Mode) => void;
}) {
  return (
    // The id is the line-by-line tour's anchor (tour/tours/lineByLine.ts).
    <div
      id="app-mode-control"
      class={cx(
        "mx-auto w-full max-md:w-auto",
        __SEFER_DESIGN__ ? "max-w-[30rem]" : "max-w-[20.75rem]",
      )}
    >
      <SegmentedControl<Mode>
        label={t("Mode")}
        iconsWhenNarrow
        class="w-full max-md:w-auto"
        value={props.mode}
        onChange={props.onChange}
        items={[
          {
            value: "refine",
            label: t("Refine"),
            icon: <FileText aria-hidden="true" />,
            disabled: !props.open,
          },
          ...(__SEFER_DESIGN__
            ? [
                {
                  value: "form" as const,
                  label: t("Form Mode"),
                  icon: <Rows3 aria-hidden="true" />,
                  disabled: !props.open,
                },
              ]
            : []),
          {
            value: "terms",
            label: t("Spiritual terms"),
            icon: <ListChecks aria-hidden="true" />,
            disabled: !props.open,
          },
        ]}
      />
    </div>
  );
}

export function AppBar() {
  const navigate = useNavigate();
  const shell = useShell();

  const path = useRouterState({ select: (state) => state.location.pathname });
  const within = (): string => path().replace(/^\/project\/[^/]+/, "");
  const at = (prefix: string): "true" | "false" => (within().startsWith(prefix) ? "true" : "false");
  const open = (): boolean => shell.project() !== undefined;

  const refining = (): "true" | "false" =>
    path().startsWith("/project/") && !within().startsWith("/terms") ? "true" : "false";
  const terms = (): "true" | "false" => at("/terms");

  const mode = (): Mode | undefined => {
    if (terms() === "true") return "terms";
    if (refining() !== "true") return undefined;
    return __SEFER_DESIGN__ && shell.lineByLine() ? "form" : "refine";
  };
  const goTo = (next: Mode): void => {
    if (next === "refine" || next === "form") {
      // Choosing a view shows that view: out of USFM, into reading or one verse per line.
      shell.setMode("default");
      shell.setLineByLine(next === "form");
      if (refining() !== "true")
        void navigate({ to: "/project/$slug", params: { slug: shell.slug() } });
    } else if (next === "terms")
      void navigate({ to: "/project/$slug/terms", params: { slug: shell.slug() }, search: {} });
  };

  return (
    <nav
      data-testid="app-bar"
      aria-label={t("Sefer")}
      class="scrollbar-subtle flex h-18 w-full shrink-0 items-center gap-4 overflow-x-auto overflow-y-hidden border-b border-surface-border bg-surface-primary px-4 py-2"
    >
      <HomeButton />

      <ModeControl mode={mode()} open={open()} onChange={goTo} />

      <div class="flex shrink-0 items-center gap-2">
        <ProjectTools />
        <MoreMenu />

        <BarButton
          label={t("Settings")}
          testId="app-bar-settings"
          pressed={at("/settings")}
          icon={<SettingsIcon size={20} />}
          disabled={!open()}
          title={open() ? undefined : t("Open a project to see Settings")}
          onClick={() =>
            void navigate({ to: "/project/$slug/settings", params: { slug: shell.slug() } })
          }
        />

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
