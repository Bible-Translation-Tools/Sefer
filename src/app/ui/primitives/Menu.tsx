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
      md: "min-h-12 gap-3 p-3 text-small font-medium [&>svg]:size-5",
      lg: "gap-4 p-4 text-body font-medium",
    },
  },
  defaults: { size: "md" },
});

const ITEMS = '[role^="menuitem"]:not(:disabled)';

const itemForKey = (
  key: string,
  items: readonly HTMLElement[],
  at: number,
): HTMLElement | undefined => {
  if (key === "ArrowDown") return items[(at + 1) % items.length];
  if (key === "ArrowUp") return items[(at - 1 + items.length) % items.length];
  if (key === "Home") return items[0];
  if (key === "End") return items.at(-1);
  return undefined;
};

const rove = (event: KeyboardEvent, menu: HTMLElement): void => {
  const items = [...menu.querySelectorAll<HTMLElement>(ITEMS)];
  if (items.length === 0) return;
  const at = items.findIndex((item) => item === document.activeElement);
  const next = itemForKey(event.key, items, at);
  if (next === undefined) return;
  event.preventDefault();
  next.focus();
};

export interface MenuProps {
  readonly label: string;
  readonly trigger: JSX.Element;
  readonly children: JSX.Element;
  readonly size?: MenuSize;
  readonly side?: PopoverSide;
  readonly align?: PopoverAlign;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly class?: ClassValue;
  readonly triggerClass?: ClassValue;
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
  readonly icon?: JSX.Element;
  readonly disabled?: boolean;
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

      <span
        aria-hidden="true"
        class="flex size-4 shrink-0 items-center justify-center rounded-sm border-2 border-on-surface-tertiary text-transparent transition-colors group-aria-checked:border-brand group-aria-checked:bg-brand group-aria-checked:text-button-primary-on-surface"
      >
        <Check size={12} strokeWidth={3} />
      </span>
    </button>
  );
}

export function MenuLabel(props: { readonly children: JSX.Element; readonly inset?: string }) {
  const menu = useMenu();
  return (
    <p
      role="presentation"
      class={cx(
        "pb-1 font-semibold tracking-wide text-on-surface-tertiary uppercase",
        menu.size() === "lg" ? "pt-2 text-small" : "pt-1 text-smallest",
        props.inset ?? (menu.size() === "lg" ? "px-4" : "px-3"),
      )}
    >
      {props.children}
    </p>
  );
}

export function MenuSeparator() {
  return <div role="separator" class="my-2 border-t border-surface-border" />;
}
