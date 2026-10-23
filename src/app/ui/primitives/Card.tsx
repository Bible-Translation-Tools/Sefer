import type { ComponentProps, JSX } from "@solidjs/web";
import { merge, omit } from "solid-js";

import { cx, type ClassValue } from "./cx";
import { usePageDoor } from "./pageLeading";

export interface CardProps extends ComponentProps<"section"> {
  readonly padded?: boolean;
  readonly size?: "md" | "lg";
  readonly raised?: boolean;
}

const padding = (size: CardProps["size"]): string => (size === "lg" ? "p-6" : "p-4");

export function Card(props: CardProps) {
  const rest = omit(props, "padded", "size", "raised", "class");
  const merged = merge(rest, {
    get class() {
      return cx(
        "border border-surface-border bg-surface-primary",
        props.raised === false ? undefined : "shadow-small",
        props.size === "lg" ? "rounded-3xl" : "rounded-lg",
        props.padded === false ? undefined : padding(props.size),
        props.class,
      );
    },
  });
  return <section {...merged} />;
}

export interface PanelHeaderProps {
  readonly title: JSX.Element;
  readonly subtitle?: JSX.Element;
  readonly actions?: JSX.Element;
  readonly level?: 2 | 3;
  readonly door?: boolean;
  readonly class?: ClassValue;
}

export function PanelHeader(props: PanelHeaderProps) {
  const door = usePageDoor();
  return (
    <div class={cx("flex min-h-12 flex-wrap items-center gap-3", props.class)}>
      <div class="min-w-0">
        {props.level === 3 ? (
          <h3 class="truncate text-h4 font-semibold text-on-surface-primary">{props.title}</h3>
        ) : (
          <h2 class="truncate text-h3 font-semibold text-on-surface-primary">{props.title}</h2>
        )}
        {props.subtitle !== undefined && (
          <p class="mt-0.5 text-small text-on-surface-tertiary">{props.subtitle}</p>
        )}
      </div>

      {props.level === 3 || props.door === false ? (
        props.actions !== undefined && (
          <div class="ms-auto flex flex-wrap items-center gap-controls">{props.actions}</div>
        )
      ) : (
        <div class="ms-auto flex flex-wrap items-center gap-controls">
          {props.actions}
          {door()}
        </div>
      )}
    </div>
  );
}
