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

export function Toolbar() {
  const navigate = useNavigate();
  const [query, setQuery] = createSignal("", { name: "toolbarQuery" });
  const [menuOpen, setMenuOpen] = createSignal(false, { name: "toolbarMenu" });
  const shell = useShell();

  const title = (): string => {
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
  };

  const findings = () => shell.findingCounts();
  const attention = () => findings().errors + findings().warnings;

  const can = (id: string): boolean => findCommand(id)?.available() === true;

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

  const item =
    "flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-start text-small text-on-surface-primary transition-colors hover:bg-surface-secondary disabled:cursor-not-allowed disabled:text-on-surface-tertiary disabled:hover:bg-transparent [&>svg]:size-5";

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
        <Input
          type="search"
          data-testid="toolbar-search"
          wrapperClass="w-44"
          icon={<SearchIcon />}
          aria-label={t("Find in project")}
          placeholder={t("Search…")}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void navigate({
              to: "/project/$slug/find",
              params: { slug: shell.slug() },
              search: { q: query() },
            });
          }}
        />

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

        <Popover
          label={t("Book actions")}
          side="bottom"
          align="end"
          class="w-64 p-1"
          open={menuOpen()}
          onOpenChange={setMenuOpen}
          trigger={
            <IconButton data-testid="toolbar-kebab" label={t("More")} icon={<MoreVertical />} />
          }
        >
          <button
            data-testid="kebab-save-review"
            type="button"
            class={item}
            disabled={!can("book.save")}
            onClick={() => {
              setMenuOpen(false);
              runCommand("book.save");
            }}
          >
            {t("Save & Review")}
          </button>
          <button
            data-testid="kebab-inventory"
            type="button"
            class={item}
            onClick={() => {
              setMenuOpen(false);
              void navigate({
                to: "/project/$slug/inventory",
                params: { slug: shell.slug() },
                search: {},
              });
            }}
          >
            {t("Character inventory")}
          </button>

          <span aria-hidden="true" class="my-1 block h-px bg-surface-border" />

          <button
            data-testid="kebab-format-book"
            type="button"
            class={item}
            onClick={() => {
              setMenuOpen(false);
              runCommand("format.book");
            }}
          >
            {t("Format book")}
          </button>
          <button
            data-testid="kebab-format-project"
            type="button"
            class={item}
            onClick={() => {
              setMenuOpen(false);
              runCommand("format.project");
            }}
          >
            {t("Format project")}
          </button>

          <span aria-hidden="true" class="my-1 block h-px bg-surface-border" />

          <button
            data-testid="kebab-export-zip"
            type="button"
            class={item}
            onClick={() => {
              setMenuOpen(false);
              runCommand("project.export");
            }}
          >
            {t("Export as zip")}
          </button>
          <button
            data-testid="kebab-rename-project"
            type="button"
            class={item}
            onClick={() => {
              setMenuOpen(false);
              runCommand("project.rename");
            }}
          >
            {t("Rename project")}
          </button>
        </Popover>
      </Card>
    </div>
  );
}
