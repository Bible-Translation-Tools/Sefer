import type { JSX } from "@solidjs/web";
import { useNavigate, useRouterState } from "@tanstack/solid-router";
import Bell from "lucide-solid/icons/bell";
import CloudDownload from "lucide-solid/icons/cloud-download";
import CloudUpload from "lucide-solid/icons/cloud-upload";
import FileText from "lucide-solid/icons/file-text";
import GitCompare from "lucide-solid/icons/git-compare";
import HistoryIcon from "lucide-solid/icons/history";
import ListChecks from "lucide-solid/icons/list-checks";
import MenuIcon from "lucide-solid/icons/menu";
import Redo2 from "lucide-solid/icons/redo-2";
import Rows3 from "lucide-solid/icons/rows-3";
import Save from "lucide-solid/icons/save";
import SettingsIcon from "lucide-solid/icons/settings";
import Share2 from "lucide-solid/icons/share-2";
import TypeIcon from "lucide-solid/icons/type";
import Undo2 from "lucide-solid/icons/undo-2";
import { For, Show, createSignal } from "solid-js";

import { findCommand, runCommand } from "../../commands";
import { m } from "../../paraglide/messages";
import { useShell } from "../../ProjectContext";
import { SyncChip } from "../cloud/SyncButton";
import { IconButton, Kbd, Menu, MenuItem, MenuSeparator, SegmentedControl } from "../primitives";
import { AccountButton } from "./AccountButton";
import { SaveStatus } from "./StatusChips";

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

/** Refine is the book as it reads; Form Mode is the same book one verse per line. */
type Mode = "refine" | "form" | "terms";

/**
 * Keys the editor handles itself rather than through a registered command
 * (`packages/editor/src/surfaces/satellite.ts`), so the menu can still show them.
 */
const EDITOR_KEYS: Readonly<Record<string, string>> = {
  "book.undo": "Mod-z",
  "book.redo": "Mod-Shift-z",
};

const ORDER = ["Ctrl", "Alt", "Shift", "Mod"];

/**
 * A command's shortcut as the person's keyboard says it, one key per box:
 * ⇧ ⌘ Z on a Mac (Apple's order, Shift before Command), Ctrl Shift Z elsewhere.
 */
const shortcut = (id: string): readonly string[] => {
  const keys = findCommand(id)?.keys ?? EDITOR_KEYS[id];
  if (keys === undefined) return [];
  const mac = typeof navigator === "object" && /Mac|iPhone|iPad/u.test(navigator.platform);
  const parts = keys.split("-");
  const key = parts.pop() ?? "";
  const modifiers = mac ? [...parts].sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y)) : parts;
  return [
    ...modifiers.map((part) => {
      if (part === "Mod") return mac ? "⌘" : "Ctrl";
      if (part === "Shift") return mac ? "⇧" : "Shift";
      if (part === "Alt") return mac ? "⌥" : "Alt";
      return part;
    }),
    key.toUpperCase(),
  ];
};

/** The ☰ menu's rows: 24px at the sides, 12px between icon and words. */
const MENU_ROW = "gap-3! px-6!";

const can = (id: string): boolean => findCommand(id)?.available() === true;

function CommandItem(props: {
  readonly id: string;
  readonly label: string;
  readonly icon: JSX.Element;
  readonly testId: string;
  readonly children?: JSX.Element;
}) {
  return (
    <MenuItem
      class={MENU_ROW}
      data-testid={props.testId}
      disabled={!can(props.id)}
      icon={props.icon}
      onSelect={() => runCommand(props.id)}
    >
      <span class="flex-1">{props.label}</span>
      {props.children}
      <Show when={shortcut(props.id).length > 0}>
        <span class="ms-auto flex shrink-0 items-center gap-1" aria-hidden="true">
          <For each={shortcut(props.id)}>
            {(key) => (
              <Kbd class="h-6 min-w-6 justify-center rounded-md border-transparent px-1.5 font-sans font-semibold">
                {key}
              </Kbd>
            )}
          </For>
        </span>
      </Show>
    </MenuItem>
  );
}

/**
 * The app bar's one menu (☰): what used to sit on the bar as separate buttons
 * — Redo, History, sending and receiving, Save, Share, Findings, Settings —
 * in the designer's order. Undo stays on the bar as well.
 */
function MainMenu() {
  const navigate = useNavigate();
  const shell = useShell();
  const [open, setOpen] = createSignal(false, { name: "appBarMenuOpen" });
  const attention = () => shell.findingCounts().errors + shell.findingCounts().warnings;
  const go = (to: "/project/$slug/inventory" | "/project/$slug/review"): void =>
    void navigate({ to, params: { slug: shell.slug() }, search: {} });

  return (
    <Menu
      label={m.menu_main()}
      side="bottom"
      align="end"
      open={open()}
      onOpenChange={setOpen}
      class="w-72 rounded-[12px]! py-3!"
      trigger={
        <BarButton
          label={m.menu_main()}
          testId="app-bar-menu"
          pressed={open() ? "true" : "false"}
          icon={<MenuIcon size={20} />}
        />
      }
    >
      <CommandItem id="book.undo" testId="menu-undo" label={m.common_undo()} icon={<Undo2 />} />
      <CommandItem id="book.redo" testId="menu-redo" label={m.common_redo()} icon={<Redo2 />} />
      <CommandItem
        id="git.history"
        testId="menu-history"
        label={m.common_history()}
        icon={<HistoryIcon />}
      />
      <MenuSeparator />
      <CommandItem
        id="remote.push"
        testId="menu-upload"
        label={m.menu_upload_to_wacs()}
        icon={<CloudUpload />}
      />
      <CommandItem
        id="remote.pull"
        testId="menu-check"
        label={m.menu_check_for_updates()}
        icon={<CloudDownload />}
      />
      <MenuSeparator />
      <CommandItem
        id="book.save"
        testId="menu-save"
        label={m.menu_save_changes()}
        icon={<Save />}
      />
      <CommandItem
        id="project.copyLink"
        testId="menu-share"
        label={m.menu_share_project()}
        icon={<Share2 />}
      />
      <MenuSeparator />
      <MenuItem
        class={MENU_ROW}
        data-testid="menu-compare"
        disabled={shell.project() === undefined}
        icon={<GitCompare />}
        onSelect={() => go("/project/$slug/review")}
      >
        {m.common_compare()}
      </MenuItem>
      <MenuItem
        class={MENU_ROW}
        data-testid="menu-inventory"
        disabled={shell.project() === undefined}
        icon={<TypeIcon />}
        onSelect={() => go("/project/$slug/inventory")}
      >
        {m.common_character_inventory()}
      </MenuItem>
      <MenuSeparator />
      <CommandItem id="findings.open" testId="menu-alerts" label={m.menu_alerts()} icon={<Bell />}>
        <Show when={attention() > 0}>
          <span class="min-w-6 rounded-full bg-surface-error px-1.5 text-center text-smallest leading-5 font-semibold text-on-surface-error">
            {attention() > 999 ? "999+" : attention()}
          </span>
        </Show>
      </CommandItem>
      <CommandItem
        id="project.settings"
        testId="menu-settings"
        label={m.common_settings()}
        icon={<SettingsIcon />}
      />
    </Menu>
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
        aria-label={m.workspace_home()}
        title={m.workspace_home()}
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
          {m.common_sefer()}
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
    <div id="app-mode-control" class="mx-auto w-full max-w-[30rem] max-md:w-auto">
      <SegmentedControl<Mode>
        label={m.workspace_mode()}
        iconsWhenNarrow
        class="w-full max-md:w-auto"
        value={props.mode}
        onChange={props.onChange}
        items={[
          {
            value: "refine",
            label: m.workspace_refine(),
            icon: <FileText aria-hidden="true" />,
            disabled: !props.open,
          },
          {
            value: "form",
            label: m.workspace_form_mode(),
            icon: <Rows3 aria-hidden="true" />,
            disabled: !props.open,
          },
          {
            value: "terms",
            label: m.common_spiritual_terms(),
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
    return shell.lineByLine() ? "form" : "refine";
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
      aria-label={m.common_sefer()}
      class="scrollbar-subtle flex h-18 w-full shrink-0 items-center gap-4 overflow-x-auto overflow-y-hidden border-b border-surface-border bg-surface-primary px-4 py-2"
    >
      <HomeButton />

      <Show when={open()}>
        <div class="flex shrink-0 items-center gap-2">
          <SyncChip />
          <SaveStatus />
        </div>
      </Show>

      <ModeControl mode={mode()} open={open()} onChange={goTo} />

      <div class="flex shrink-0 items-center gap-2">
        <Show when={open()}>
          <BarButton
            label={m.common_undo()}
            testId="toolbar-undo"
            icon={<Undo2 size={20} />}
            disabled={!can("book.undo")}
            onClick={() => runCommand("book.undo")}
          />
          <MainMenu />
        </Show>
        <AccountButton />
      </div>
    </nav>
  );
}
