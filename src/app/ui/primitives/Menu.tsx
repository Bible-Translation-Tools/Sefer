/**
 * The menu: a list of actions or choices that opens from a trigger.
 *
 * Built on our `Popover`, so corvu supplies the floating, the outside click
 * and `Esc`; the first row takes focus on open through `Popover`'s
 * `initialFocus`. Focus does NOT go back to the trigger on close yet — see the
 * note in `Popover.tsx`. What a menu adds over a popover is
 * the keyboard a menu promises: focus lands on the first item, the arrow keys
 * move between items (wrapping), Home and End jump to the ends, and every row
 * says what it is — `menuitem`, `menuitemradio` or `menuitemcheckbox`.
 *
 * Three kinds of row:
 *  - `MenuItem` does something and closes the menu.
 *  - `MenuRadio` chooses one of a set (a sort order) and closes the menu.
 *  - `MenuCheckbox` toggles (a filter) and STAYS open, so several can be set.
 *
 * `MenuLabel` heads a group, `MenuSeparator` divides groups.
 *
 * Two densities. `md` is the compact list (the rail's More, a card's actions);
 * `lg` is the roomy one with body text (a table column's Sort and Filter).
 */

import type { JSX } from "@solidjs/web";
import Check from "lucide-solid/icons/check";
import { createContext, createSignal, useContext } from "solid-js";

import { cx, variants, type ClassValue } from "./cx";
import { Popover, type PopoverAlign, type PopoverSide } from "./Popover";

export type MenuSize = "md" | "lg";

interface MenuContext {
  readonly close: () => void;
  readonly size: () => MenuSize;
}

const MenuContextValue = createContext<MenuContext>();

const useMenu = (): MenuContext => {
  const held = useContext(MenuContextValue);
  if (held === undefined) throw new Error("a menu row must be inside <Menu>");
  return held;
};

const row = variants({
  base: [
    "flex w-full cursor-pointer items-center text-start text-on-surface-primary",
    "outline-none hover:not-disabled:bg-surface-secondary focus-visible:bg-surface-secondary",
    "disabled:cursor-not-allowed disabled:text-on-surface-tertiary",
  ].join(" "),
  variants: {
    size: {
      md: "gap-2 px-3 py-1.5 text-small",
      lg: "gap-4 p-4 text-body font-medium",
    },
  },
  defaults: { size: "md" },
});

const ITEMS = '[role^="menuitem"]:not(:disabled)';

/** Arrow keys, Home and End, over the enabled rows. */
const rove = (event: KeyboardEvent, menu: HTMLElement): void => {
  const items = [...menu.querySelectorAll<HTMLElement>(ITEMS)];
  if (items.length === 0) return;
  const at = items.findIndex((item) => item === document.activeElement);
  const next =
    event.key === "ArrowDown"
      ? items[(at + 1) % items.length]
      : event.key === "ArrowUp"
        ? items[(at - 1 + items.length) % items.length]
        : event.key === "Home"
          ? items[0]
          : event.key === "End"
            ? items.at(-1)
            : undefined;
  if (next === undefined) return;
  event.preventDefault();
  next.focus();
};

export interface MenuProps {
  /** Names the menu for a screen reader. */
  readonly label: string;
  readonly trigger: JSX.Element;
  readonly children: JSX.Element;
  readonly size?: MenuSize;
  readonly side?: PopoverSide;
  readonly align?: PopoverAlign;
  /** Controlled, when the trigger has to show the open state; otherwise leave both out. */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /** Classes for the panel — a width, usually. */
  readonly class?: ClassValue;
  /** Classes for the trigger's wrapper, when it must fill its box (a table header). */
  readonly triggerClass?: ClassValue;
  /** Cap at the room in the viewport and scroll inside, for a long menu. */
  readonly fitViewport?: boolean;
}

export function Menu(props: MenuProps) {
  const [own, setOwn] = createSignal(false, { name: "menuOpen" });
  const open = (): boolean => props.open ?? own();
  const change = (next: boolean): void => {
    setOwn(next);
    props.onOpenChange?.(next);
  };

  return (
    <MenuContextValue value={{ close: () => change(false), size: () => props.size ?? "md" }}>
      <Popover
        variant="menu"
        label={props.label}
        side={props.side}
        align={props.align}
        open={open()}
        onOpenChange={change}
        class={props.class}
        triggerClass={props.triggerClass}
        fitViewport={props.fitViewport}
        initialFocus={ITEMS}
        trigger={props.trigger}
      >
        <div
          role="menu"
          aria-label={props.label}
          onKeyDown={(event) => rove(event, event.currentTarget)}
        >
          {props.children}
        </div>
      </Popover>
    </MenuContextValue>
  );
}

interface RowProps {
  readonly children: JSX.Element;
  /** Leading icon, already sized by the caller. */
  readonly icon?: JSX.Element;
  readonly disabled?: boolean;
  /** Why it is disabled, or anything else worth a native tooltip. */
  readonly title?: string;
  readonly class?: ClassValue;
  readonly "data-testid"?: string;
}

export function MenuItem(props: RowProps & { readonly onSelect: () => void }) {
  const menu = useMenu();
  return (
    <button
      type="button"
      role="menuitem"
      tabindex={-1}
      disabled={props.disabled}
      title={props.title}
      data-testid={props["data-testid"]}
      class={row({ size: menu.size() }, props.class)}
      onClick={() => {
        menu.close();
        props.onSelect();
      }}
    >
      {props.icon}
      {props.children}
    </button>
  );
}

export function MenuRadio(
  props: RowProps & { readonly checked: boolean; readonly onSelect: () => void },
) {
  const menu = useMenu();
  return (
    <button
      type="button"
      role="menuitemradio"
      tabindex={-1}
      aria-checked={props.checked ? "true" : "false"}
      disabled={props.disabled}
      title={props.title}
      data-testid={props["data-testid"]}
      class={row({ size: menu.size() }, props.class)}
      onClick={() => {
        menu.close();
        props.onSelect();
      }}
    >
      {props.icon}
      <span class="min-w-0 flex-1">{props.children}</span>
      <Check
        size={16}
        aria-hidden="true"
        class={cx("shrink-0 text-brand", !props.checked && "invisible")}
      />
    </button>
  );
}

export function MenuCheckbox(
  props: RowProps & { readonly checked: boolean; readonly onChange: (checked: boolean) => void },
) {
  const menu = useMenu();
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      tabindex={-1}
      aria-checked={props.checked ? "true" : "false"}
      disabled={props.disabled}
      title={props.title}
      data-testid={props["data-testid"]}
      class={row({ size: menu.size() }, cx("group", props.class))}
      onClick={() => props.onChange(!props.checked)}
    >
      {props.icon}
      <span class="min-w-0 flex-1 truncate">{props.children}</span>
      {/* The drawn box: an outline when off, a brand fill with a check when on. */}
      <span
        aria-hidden="true"
        class="flex size-4 shrink-0 items-center justify-center rounded-sm border-2 border-on-surface-tertiary text-transparent transition-colors group-aria-checked:border-brand group-aria-checked:bg-brand group-aria-checked:text-button-primary-on-surface"
      >
        <Check size={12} strokeWidth={3} />
      </span>
    </button>
  );
}

export function MenuLabel(props: { readonly children: JSX.Element }) {
  const menu = useMenu();
  return (
    <p
      role="presentation"
      class={cx(
        "pb-1 font-semibold tracking-wide text-on-surface-tertiary uppercase",
        menu.size() === "lg" ? "px-4 pt-2 text-small" : "px-3 pt-1 text-smallest",
      )}
    >
      {props.children}
    </p>
  );
}

export function MenuSeparator() {
  return <div role="separator" class="my-2 border-t border-surface-border" />;
}
