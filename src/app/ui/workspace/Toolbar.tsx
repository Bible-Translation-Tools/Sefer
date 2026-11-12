import type { JSX } from "@solidjs/web";
import { useNavigate } from "@tanstack/solid-router";
import MoreVertical from "lucide-solid/icons/more-vertical";
import SearchIcon from "lucide-solid/icons/search";
import { Show, createEffect, createSignal } from "solid-js";

import { m } from "#app/paraglide/messages";

import { findCommand, runCommand } from "../../commands";
import { useShell } from "../../ProjectContext";
import { IconButton, Input, Popover, Switch } from "../primitives";
import { bookName } from "./books";

const can = (id: string): boolean => findCommand(id)?.available() === true;

const kebabItem =
  "flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-start text-small text-on-surface-primary transition-colors hover:bg-surface-secondary disabled:cursor-not-allowed disabled:text-on-surface-tertiary disabled:hover:bg-transparent [&>svg]:size-5";

function ToolbarSearch(props: { query: string; onQuery: (value: string) => void }) {
  const navigate = useNavigate();
  const shell = useShell();
  return (
    <Input
      type="search"
      data-testid="toolbar-search"
      wrapperClass="w-44"
      icon={<SearchIcon />}
      aria-label={m.common_find_in_project()}
      placeholder={m.common_search()}
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

function KebabMenu(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasSource: boolean;
}) {
  const navigate = useNavigate();
  const shell = useShell();
  return (
    <Popover
      label={m.workspace_book_actions()}
      side="bottom"
      align="end"
      class="w-64 p-1"
      open={props.open}
      onOpenChange={props.onOpenChange}
      trigger={
        <IconButton data-testid="toolbar-kebab" label={m.common_more()} icon={<MoreVertical />} />
      }
    >
      {/* How the book shows: switches, so the menu stays open while they flip. */}
      <Switch
        class="min-h-12 w-full justify-between rounded-lg px-3 hover:bg-surface-secondary"
        labelFirst
        label="USFM"
        checked={shell.mode() === "usfm"}
        onChange={(on) => shell.setMode(on ? "usfm" : "default")}
      />
      <Switch
        class="min-h-12 w-full justify-between rounded-lg px-3 hover:bg-surface-secondary"
        labelFirst
        label={m.refine_scope_chapter()}
        checked={shell.preferChapterView()}
        onChange={(one) => shell.setChapterScope(one)}
      />
      <Show when={props.hasSource}>
        <KebabItem
          testId="toolbar-overlay"
          label={m.workspace_match_formatting_from_source()}
          disabled={!can("overlay.book")}
          onSelect={() => {
            props.onOpenChange(false);
            runCommand("overlay.book");
          }}
        />
      </Show>

      <span aria-hidden="true" class="my-1 block h-px bg-surface-border" />

      <KebabItem
        testId="kebab-save-review"
        label={m.common_save_review()}
        disabled={!can("book.save")}
        onSelect={() => {
          props.onOpenChange(false);
          runCommand("book.save");
        }}
      />
      <KebabItem
        testId="kebab-inventory"
        label={m.common_character_inventory()}
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
        label={m.common_format_book()}
        onSelect={() => {
          props.onOpenChange(false);
          runCommand("format.book");
        }}
      />
      <KebabItem
        testId="kebab-format-project"
        label={m.workspace_format_project()}
        onSelect={() => {
          props.onOpenChange(false);
          runCommand("format.project");
        }}
      />

      <span aria-hidden="true" class="my-1 block h-px bg-surface-border" />

      <KebabItem
        testId="kebab-export-zip"
        label={m.common_export_as_zip()}
        onSelect={() => {
          props.onOpenChange(false);
          runCommand("project.export");
        }}
      />
      <KebabItem
        testId="kebab-rename-project"
        label={m.common_rename_project()}
        onSelect={() => {
          props.onOpenChange(false);
          runCommand("project.rename");
        }}
      />
    </Popover>
  );
}

/**
 * The book's tools, at the end of the editor's own header: search, what the
 * header puts between (Show reference), and the book's kebab — USFM and One chapter switches, Match formatting from source
 * (when the project has one), Save & Review, inventory, formatting, export,
 * rename.
 */
export function BookTools(props: { readonly children?: JSX.Element }) {
  const [query, setQuery] = createSignal("", { name: "toolbarQuery" });
  const [menuOpen, setMenuOpen] = createSignal(false, { name: "toolbarMenu" });
  const shell = useShell();

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
    <>
      <ToolbarSearch query={query()} onQuery={setQuery} />
      {props.children}
      <KebabMenu open={menuOpen()} onOpenChange={setMenuOpen} hasSource={hasSource()} />
    </>
  );
}

/**
 * Where the reader is, at the head of the editor: the book, and the chapter
 * shown (One chapter) or the one at the top of the view — "Psalms 3".
 */
export function BookTitle() {
  const shell = useShell();
  const title = (): string => {
    const book = shell.focused();
    if (book === undefined) return "";
    const named = bookName(book.id, shell.metadata());
    const chapters = book.structure().chapters;
    const clipped = shell.chapter();
    const root = shell.project()?.root;
    const held = root === undefined ? undefined : shell.lastLocation(root);
    const at = clipped ?? (held?.bookId === book.id ? held.at : undefined);
    const label = at === undefined || at === 0 ? undefined : chapters[at]?.label;
    return label === undefined || label === "" ? named : `${named} ${label}`;
  };
  return (
    <strong
      class="block min-w-0 truncate text-h3 font-semibold text-on-surface-primary"
      data-workspace-title
    >
      {title()}
    </strong>
  );
}
