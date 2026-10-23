import type { BookId } from "@sefer/text/book";
import type { JSX } from "@solidjs/web";
import BookIcon from "lucide-solid/icons/book";
import CheckIcon from "lucide-solid/icons/check";
import MoreVertical from "lucide-solid/icons/more-vertical";
import { For, Show } from "solid-js";

import type { DecisionUnit, MergeSide } from "#core/galley";

import { t } from "../../../i18n";
import { IconButton, Menu, MenuItem } from "../../primitives";
import { ChangesHistorySidebar } from "../../workspace/ChangesHistorySidebar";
import { bookCount, changeCount } from "./helpers";
import type { Prepared } from "./types";

interface BooksSidebarProps {
  readonly books: readonly Prepared[];
  readonly focused: BookId | undefined;
  readonly decidable: boolean;
  readonly decidedOf: (held: Prepared) => number;
  readonly baselineShort: string;
  readonly currentShort: string;
  readonly onPick: (bookId: BookId) => void;
  readonly onDecide: (
    bookId: BookId,
    units: readonly DecisionUnit[],
    side: MergeSide | undefined,
  ) => void;
}

function BookMenu(props: { readonly sidebar: BooksSidebarProps; readonly held: Prepared }) {
  return (
    <Menu
      label={t("Decide {book}", { book: props.held.book.name })}
      side="bottom"
      align="end"
      class="w-56"
      trigger={
        <IconButton
          size="sm"
          label={t("Decide all of {book}", { book: props.held.book.name })}
          icon={<MoreVertical />}
          data-review-book-menu={props.held.book.bookId}
        />
      }
    >
      <MenuItem
        onSelect={() =>
          props.sidebar.onDecide(props.held.book.bookId, props.held.shown, "baseline")
        }
      >
        {t("Take all of {source}'s", { source: props.sidebar.baselineShort })}
      </MenuItem>
      <MenuItem
        onSelect={() => props.sidebar.onDecide(props.held.book.bookId, props.held.shown, "current")}
      >
        {t("Keep all of {source}'s", { source: props.sidebar.currentShort })}
      </MenuItem>
      <MenuItem
        onSelect={() => props.sidebar.onDecide(props.held.book.bookId, props.held.shown, undefined)}
      >
        {t("Clear")}
      </MenuItem>
    </Menu>
  );
}

function BookRow(props: { readonly sidebar: BooksSidebarProps; readonly held: Prepared }) {
  const here = (): boolean => props.sidebar.focused === props.held.book.bookId;
  const done = (): boolean =>
    props.held.shown.length > 0 && props.sidebar.decidedOf(props.held) === props.held.shown.length;
  return (
    <li class="flex items-center gap-0.5">
      <button
        type="button"
        data-outline={props.held.book.bookId}
        data-focused={here() ? "" : undefined}
        aria-current={here() ? "true" : undefined}
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-small transition-colors data-focused:bg-sidebar-surface-active data-focused:font-medium data-focused:text-brand not-data-focused:text-sidebar-on-surface not-data-focused:hover:bg-sidebar-surface-hover"
        onClick={() => props.sidebar.onPick(props.held.book.bookId)}
      >
        <Show when={done()} fallback={<BookIcon size={15} aria-hidden="true" class="shrink-0" />}>
          <CheckIcon size={15} aria-hidden="true" class="shrink-0 text-brand" />
        </Show>
        <span class="min-w-0 flex-1 truncate">{props.held.book.name}</span>
        <span class="shrink-0 text-smallest tabular-nums text-on-surface-tertiary">
          {props.sidebar.decidable
            ? `${props.sidebar.decidedOf(props.held)}/${props.held.shown.length}`
            : String(props.held.shown.length)}
        </span>
      </button>
      <Show when={props.sidebar.decidable && props.held.shown.length > 0}>
        <BookMenu sidebar={props.sidebar} held={props.held} />
      </Show>
    </li>
  );
}

export function BooksSidebar(props: BooksSidebarProps): JSX.Element {
  return (
    <ChangesHistorySidebar active="changes" changes={props.books.length}>
      <div class="px-4 pt-3 pb-2">
        <p class="px-2 text-small text-on-surface-secondary">
          {(() => {
            const count = props.books.reduce((sum, held) => sum + held.shown.length, 0);
            const books = props.books.length;
            return t("{changes} in {books}", {
              changes: changeCount(count),
              books: bookCount(books),
            });
          })()}
        </p>
      </div>
      <nav aria-label={t("Changes")} class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <ul>
          <For each={props.books}>{(held) => <BookRow sidebar={props} held={held} />}</For>
        </ul>
      </nav>
    </ChangesHistorySidebar>
  );
}
