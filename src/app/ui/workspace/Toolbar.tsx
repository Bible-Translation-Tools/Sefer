import { useNavigate } from "@tanstack/solid-router";
import ArrowLeftRight from "lucide-solid/icons/arrow-left-right";
import Bell from "lucide-solid/icons/bell";
import MoreVertical from "lucide-solid/icons/more-vertical";
import Redo2 from "lucide-solid/icons/redo-2";
import SearchIcon from "lucide-solid/icons/search";
import Undo2 from "lucide-solid/icons/undo-2";
import { Show, createEffect, createSignal } from "solid-js";

import { findCommand, runCommand } from "../../commands";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Card, IconButton, Input, Popover } from "../primitives";
import { bookName } from "./books";
import { PanelToggle } from "./PanelToggle";
import { metadataOf, projectName } from "./project";

const can = (id: string): boolean => findCommand(id)?.available() === true;

const kebabItem =
  "flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-start text-small text-on-surface-primary transition-colors hover:bg-surface-secondary disabled:cursor-not-allowed disabled:text-on-surface-tertiary disabled:hover:bg-transparent [&>svg]:size-5";

function toolbarTitle(shell: ReturnType<typeof useShell>): string {
  const book = shell.focused();
  if (book === undefined) return "";
  const project = shell.project();
  const clipped = shell.chapter();
  const label = clipped === null ? undefined : book.structure().chapters[clipped]?.label;
  const named = bookName(book.id, metadataOf(project));
  const of = projectName(project);
  if (clipped === null) return t("{book} ({project})", { book: named, project: of });
  const where = label === undefined || label === "" ? t("front") : label;
  return t("{book} {where} ({project})", { book: named, where, project: of });
}

function ToolbarSearch(props: { query: string; onQuery: (value: string) => void }) {
  const navigate = useNavigate();
  const shell = useShell();
  return (
    <Input
      type="search"
      data-testid="toolbar-search"
      wrapperClass="w-44"
      icon={<SearchIcon />}
      aria-label={t("Find in project")}
      placeholder={t("Search…")}
      value={props.query}
      onInput={(event) => props.onQuery(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        void navigate({
          to: "/project/$slug/find",
          params: { slug: shell.slug() },
          search: { q: props.query },
        });
      }}
    />
  );
}

function KebabItem(props: {
  testId: string;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      data-testid={props.testId}
      type="button"
      class={kebabItem}
      disabled={props.disabled}
      onClick={() => props.onSelect()}
    >
      {props.label}
    </button>
  );
}

function KebabMenu(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const shell = useShell();
  return (
    <Popover
      label={t("Book actions")}
      side="bottom"
      align="end"
      class="w-64 p-1"
      open={props.open}
      onOpenChange={props.onOpenChange}
      trigger={<IconButton data-testid="toolbar-kebab" label={t("More")} icon={<MoreVertical />} />}
    >
      <KebabItem
        testId="kebab-save-review"
        label={t("Save & Review")}
        disabled={!can("book.save")}
        onSelect={() => {
          props.onOpenChange(false);
          runCommand("book.save");
        }}
      />
      <KebabItem
        testId="kebab-inventory"
        label={t("Character inventory")}
        onSelect={() => {
          props.onOpenChange(false);
          void navigate({
            to: "/project/$slug/inventory",
            params: { slug: shell.slug() },
            search: {},
          });
        }}
      />

      <span aria-hidden="true" class="my-1 block h-px bg-surface-border" />

      <KebabItem
        testId="kebab-format-book"
        label={t("Format book")}
        onSelect={() => {
          props.onOpenChange(false);
          runCommand("format.book");
        }}
      />
      <KebabItem
        testId="kebab-format-project"
        label={t("Format project")}
        onSelect={() => {
          props.onOpenChange(false);
          runCommand("format.project");
        }}
      />

      <span aria-hidden="true" class="my-1 block h-px bg-surface-border" />

      <KebabItem
        testId="kebab-export-zip"
        label={t("Export as zip")}
        onSelect={() => {
          props.onOpenChange(false);
          runCommand("project.export");
        }}
      />
      <KebabItem
        testId="kebab-rename-project"
        label={t("Rename project")}
        onSelect={() => {
          props.onOpenChange(false);
          runCommand("project.rename");
        }}
      />
    </Popover>
  );
}

function FindingsBell() {
  const navigate = useNavigate();
  const shell = useShell();
  const findings = () => shell.findingCounts();
  const attention = () => findings().errors + findings().warnings;
  return (
    <span class="relative inline-flex">
      <IconButton
        data-testid="toolbar-findings"
        label={t("Findings")}
        icon={<Bell />}
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
  );
}

export function Toolbar() {
  const [query, setQuery] = createSignal("", { name: "toolbarQuery" });
  const [menuOpen, setMenuOpen] = createSignal(false, { name: "toolbarMenu" });
  const shell = useShell();

  const title = () => toolbarTitle(shell);

  const [hasSource, setHasSource] = createSignal(false, { name: "toolbarHasSource" });
  createEffect(
    () => ({ project: shell.project()?.root, book: shell.focused()?.id }),
    ({ project }) => {
      if (project === undefined) {
        setHasSource(false);
        return;
      }
      void shell.services
        .run(shell.services.library.resolve(project, "source"))
        .then((bound: readonly unknown[]) => {
          setHasSource(bound.length > 0);
        });
    },
  );

  return (
    <div class="flex flex-wrap items-center gap-3" data-testid="toolbar">
      <div class="flex min-w-0 shrink items-center gap-2">
        <PanelToggle />
        <strong
          class="min-w-0 truncate text-h4 font-semibold text-on-surface-primary"
          data-workspace-title
        >
          {title()}
        </strong>
      </div>

      <Card class="ms-auto flex items-center gap-controls p-1.5" padded={false}>
        <ToolbarSearch query={query()} onQuery={setQuery} />

        <IconButton
          data-testid="toolbar-undo"
          label={t("Undo")}
          icon={<Undo2 />}
          disabled={!can("book.undo")}
          onClick={() => runCommand("book.undo")}
        />
        <IconButton
          data-testid="toolbar-redo"
          label={t("Redo")}
          icon={<Redo2 />}
          disabled={!can("book.redo")}
          onClick={() => runCommand("book.redo")}
        />

        <Show when={hasSource()}>
          <IconButton
            data-testid="toolbar-overlay"
            label={t("Match formatting from source")}
            icon={<ArrowLeftRight />}
            disabled={!can("overlay.book")}
            onClick={() => runCommand("overlay.book")}
          />
        </Show>

        <FindingsBell />

        <KebabMenu open={menuOpen()} onOpenChange={setMenuOpen} />
      </Card>
    </div>
  );
}
