import type { JSX } from "@solidjs/web";

import { cx, type ClassValue } from "./cx";

export interface KbdProps {
  readonly class?: ClassValue;
  readonly children: JSX.Element;
}

export function Kbd(props: KbdProps) {
  return (
    <kbd
      class={cx(
        "inline-flex items-center rounded-sm border border-kbd-border bg-kbd-surface",
        "px-1.5 py-px font-mono text-smallest text-kbd-on-surface",
        props.class,
      )}
    >
      {props.children}
    </kbd>
  );
}
