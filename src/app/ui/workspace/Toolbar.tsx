/**
 * The workspace toolbar: what you are looking at, how it is projected, and the
 * handful of things you do to it without leaving it.
 *
 * Every action is a `runCommand` — the toolbar is one of the three callers
 * every command in `src/app/commands.ts` is required to have, alongside the
 * keystroke and the palette, and it holds no logic of its own.
 *
 * The kebab's items are NOT gated on `findCommand(id)`. `runCommand` already
 * answers for an id it does not hold — an unknown command, or one whose
 * `when()` refuses, is a documented no-op — so the menu names the intention
 * and the registry decides whether it happens. That matters while the
 * registry is being filled in by other work: a menu that hid or disabled
 * every id it could not yet see would be the toolbar guessing at the
 * registry's answer instead of asking for it. The one exception is Save,
 * whose `can()` is a real "there is nothing to save right now".
 *
 * The mode control has three segments and not four. Form is not built, so it
 * has no segment (planning/03-ui/design-direction.md); Key terms is a
 * NAVIGATION dressed as a mode, because that is what the mockup shows and what
 * the reader means — it is the same corpus seen as a term list, on `/terms`.
 */

import { useNavigate } from "@tanstack/solid-router";
import Bell from "lucide-solid/icons/bell";
import BookOpen from "lucide-solid/icons/book-open";
import Code from "lucide-solid/icons/code";
import ListChecks from "lucide-solid/icons/list-checks";
import MoreVertical from "lucide-solid/icons/more-vertical";
import Redo2 from "lucide-solid/icons/redo-2";
import SearchIcon from "lucide-solid/icons/search";
import Undo2 from "lucide-solid/icons/undo-2";
import { Show, createSignal } from "solid-js";

import { findCommand, runCommand } from "../../commands";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Card, IconButton, Input, Popover, SegmentedControl } from "../primitives";
import { bookName } from "./books";
import { metadataOf, projectName } from "./project";

/** The three segments, as literal strings so Tailwind and the reader agree. */
type Segment = "regular" | "stet" | "usfm";

export function Toolbar() {
  const navigate = useNavigate();
  const [query, setQuery] = createSignal("", { name: "toolbarQuery" });
  const [menuOpen, setMenuOpen] = createSignal(false, { name: "toolbarMenu" });
  const shell = useShell();

  const go = (to: string, search?: Readonly<Record<string, string>>): void => {
    // SAFETY: `/find` and `/history` are route literals, but their search
    // schemas belong to routes still being built, so the shapes are cast
    // rather than declared here. An unknown search key is dropped, never a
    // crash.
    void navigate({ to: to as never, search: search as never });
  };

  /**
   * "Mark 5 (Shila)" — book, where in it, project.
   *
   * The clip is an INDEX into the engine's chapter table, whose first row is
   * the front matter and carries no label. So an empty label is named rather
   * than printed as a blank: it is a place the reader can actually be.
   */
  const title = (): string => {
    const book = shell.focused();
    if (book === undefined) return "";
    const project = shell.project();
    const clipped = shell.chapter();
    const label = clipped === null ? undefined : book.structure().chapters[clipped]?.label;
    const named = bookName(book.id, metadataOf(project));
    const of = projectName(project);
    // A whole book is the ordinary case, so it says nothing: "Philemon
    // (small-nt)". A clip names where you are — "Philemon 1 (small-nt)" — and
    // an empty label is the front matter, which is a place, not a blank.
    if (clipped === null) return t("{book} ({project})", { book: named, project: of });
    const where = label === undefined || label === "" ? t("front") : label;
    return t("{book} {where} ({project})", { book: named, where, project: of });
  };

  const segment = (): Segment => (shell.mode() === "usfm" ? "usfm" : "regular");

  const pick = (value: Segment): void => {
    if (value === "stet") {
      go("/terms");
      return;
    }
    shell.setMode(value === "usfm" ? "usfm" : "default");
  };

  const findings = () => shell.findingCounts();
  const attention = () => findings().errors + findings().warnings;

  /**
   * Is this command possible right now?
   *
   * `shell.tick()` is read FIRST and that is the whole point. A command's
   * `when()` asks a module — Undo asks the book's history for its depth, Save
   * asks the coordinator whether the text moved — and none of those is a
   * signal. Without the tick these buttons only re-evaluated when something
   * else on the toolbar happened to re-render, which in practice was the hover
   * that restyled them: Undo stayed greyed out after a keystroke until the
   * pointer touched it. The tick is the shell's one contract for a derived
   * product (documentation/architecture/shell.md), and the editor bumps it on
   * every receipt.
   */
  const can = (id: string): boolean => {
    shell.tick();
    return findCommand(id)?.available() === true;
  };

  const item =
    "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-small text-on-surface-primary transition-colors hover:bg-surface-secondary disabled:cursor-not-allowed disabled:text-on-surface-tertiary disabled:hover:bg-transparent";

  return (
    <div class="flex flex-wrap items-center gap-3">
      <strong
        class="min-w-0 shrink truncate text-h4 font-semibold text-on-surface-primary"
        data-workspace-title
      >
        {title()}
      </strong>

      <SegmentedControl<Segment>
        class="mx-auto"
        label={t("Mode")}
        size="md"
        items={[
          { value: "regular", label: t("Regular Mode"), icon: <BookOpen size={14} /> },
          { value: "stet", label: t("Key terms"), icon: <ListChecks size={14} /> },
          { value: "usfm", label: t("USFM"), icon: <Code size={14} /> },
        ]}
        value={segment()}
        onChange={pick}
      />

      <Card class="flex items-center gap-1 p-1.5" padded={false}>
        <Input
          size="sm"
          type="search"
          wrapperClass="w-44"
          icon={<SearchIcon size={14} />}
          aria-label={t("Find in project")}
          placeholder={t("Search…")}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            go("/find", { q: query() });
          }}
        />

        <IconButton
          size="sm"
          label={t("Undo")}
          icon={<Undo2 size={16} />}
          disabled={!can("book.undo")}
          onClick={() => runCommand("book.undo")}
        />
        <IconButton
          size="sm"
          label={t("Redo")}
          icon={<Redo2 size={16} />}
          disabled={!can("book.redo")}
          onClick={() => runCommand("book.redo")}
        />

        <span class="relative inline-flex">
          <IconButton
            size="sm"
            label={t("Findings")}
            icon={<Bell size={16} />}
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

        <Popover
          label={t("Book actions")}
          side="bottom"
          align="end"
          class="w-56 p-1"
          open={menuOpen()}
          onOpenChange={setMenuOpen}
          trigger={<IconButton size="sm" label={t("More")} icon={<MoreVertical size={16} />} />}
        >
          <button
            type="button"
            class={item}
            disabled={!can("book.save")}
            onClick={() => {
              setMenuOpen(false);
              runCommand("book.save");
            }}
          >
            {t("Save")}
          </button>
          <button
            type="button"
            class={item}
            disabled={!can("book.save")}
            onClick={() => {
              setMenuOpen(false);
              runCommand("book.save");
              go("/history", { review: "1" });
            }}
          >
            {t("Save & Review")}
          </button>
          <button
            type="button"
            class={item}
            onClick={() => {
              setMenuOpen(false);
              go("/inventory");
            }}
          >
            {t("Character inventory")}
          </button>

          <span aria-hidden="true" class="my-1 block h-px bg-surface-border" />

          {/* Format, for a book or the whole project ("call it 'Format'" —
              design-direction.md, gap list 4). Not match-formatting, which
              needs an Onion overlay of two texts first. */}
          <button
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

          {/* Project-wide, and here rather than on `/project/$id` because the
              editor is where someone is when they decide to hand the work on
              or rename it (gap list 7: "Export as zip … and rename: yes"). */}
          <button
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
