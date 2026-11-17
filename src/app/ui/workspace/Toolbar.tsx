import type { JSX } from "@solidjs/web";
import MoreVertical from "lucide-solid/icons/more-vertical";
import { createSignal } from "solid-js";

import { m } from "#app/paraglide/messages";

import { useShell } from "../../ProjectContext";
import { IconButton, Popover, Switch } from "../primitives";
import { bookName } from "./books";

/**
 * How the book shows, and its formatting (Thomas, 2026-11-16): Save & Review is
 * the app bar's Save; formatting from the source moves to the reference side,
 * where it is clear which text it means; export, rename and the inventory
 * live elsewhere. The commands stay in the palette.
 */
function KebabMenu(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
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
    </Popover>
  );
}

/**
 * The book's tools, at the end of the editor's own header: search, what the
 * header puts between (Show reference), and the book's kebab — the USFM and
 * One chapter switches, and Formatting.
 */
export function BookTools(props: { readonly children?: JSX.Element }) {
  const [menuOpen, setMenuOpen] = createSignal(false, { name: "toolbarMenu" });

  return (
    <>
      {props.children}
      <KebabMenu open={menuOpen()} onOpenChange={setMenuOpen} />
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
