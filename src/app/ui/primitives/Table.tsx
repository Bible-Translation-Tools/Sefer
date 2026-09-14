/**
 * The table, as six thin components.
 *
 * Thin on purpose: a table's shape is the caller's data, not a config object, so
 * these carry the look and nothing else. The one piece of behaviour is the
 * sortable header — `sort` takes `"asc" | "desc" | "none"`, sets
 * `aria-sort` from it, and draws the arrow, so a sortable column cannot be
 * announced one way and drawn another.
 */

import type { ComponentProps, JSX } from "@solidjs/web";
import ArrowDown from "lucide-solid/icons/arrow-down";
import ArrowUp from "lucide-solid/icons/arrow-up";
import ChevronsUpDown from "lucide-solid/icons/chevrons-up-down";
import { merge, omit } from "solid-js";

import { cx } from "./cx";

export type SortDirection = "asc" | "desc" | "none";

export function Table(props: ComponentProps<"table">) {
  const rest = omit(props, "class");
  const merged = merge(rest, {
    get class() {
      return cx("w-full text-small", props.class);
    },
  });
  return (
    <div class="w-full overflow-x-auto">
      <table {...merged} />
    </div>
  );
}

export function TableHead(props: ComponentProps<"thead">) {
  const rest = omit(props, "class");
  const merged = merge(rest, {
    get class() {
      return cx(
        "border-b border-surface-border text-start text-smallest text-on-surface-tertiary",
        props.class,
      );
    },
  });
  return <thead {...merged} />;
}

export function TableBody(props: ComponentProps<"tbody">) {
  const rest = omit(props, "class");
  const merged = merge(rest, {
    get class() {
      return cx("divide-y divide-surface-border", props.class);
    },
  });
  return <tbody {...merged} />;
}

export function TableRow(props: ComponentProps<"tr">) {
  const rest = omit(props, "class");
  const merged = merge(rest, {
    get class() {
      return cx(
        "transition-colors hover:bg-surface-secondary aria-[current=true]:bg-brand-light",
        props.class,
      );
    },
  });
  return <tr {...merged} />;
}

export function TableCell(props: ComponentProps<"td">) {
  const rest = omit(props, "class");
  const merged = merge(rest, {
    get class() {
      return cx("px-3 py-2 align-middle text-on-surface-primary", props.class);
    },
  });
  return <td {...merged} />;
}

export interface TableHeaderProps extends Omit<ComponentProps<"th">, "onClick"> {
  /** Present makes the cell a sort control; `"none"` means "sortable, not sorted". */
  readonly sort?: SortDirection;
  readonly onSort?: () => void;
  readonly children: JSX.Element;
}

export function TableHeader(props: TableHeaderProps) {
  const rest = omit(props, "sort", "onSort", "class", "children");
  const merged = merge(rest, {
    get "aria-sort"() {
      if (props.sort === undefined) return undefined;
      return props.sort === "none" ? "none" : props.sort === "asc" ? "ascending" : "descending";
    },
    get class() {
      return cx("px-3 py-2 text-start font-medium whitespace-nowrap", props.class);
    },
  });

  return (
    <th {...merged}>
      {props.sort === undefined ? (
        props.children
      ) : (
        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1 text-inherit transition-colors hover:text-on-surface-primary"
          onClick={() => props.onSort?.()}
        >
          {props.children}
          {props.sort === "asc" ? (
            <ArrowUp size={12} aria-hidden="true" />
          ) : props.sort === "desc" ? (
            <ArrowDown size={12} aria-hidden="true" />
          ) : (
            <ChevronsUpDown size={12} aria-hidden="true" class="opacity-50" />
          )}
        </button>
      )}
    </th>
  );
}
