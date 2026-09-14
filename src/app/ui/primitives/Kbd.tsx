/**
 * A key, or a chord, as the keycap the reader will press.
 *
 * `Mod-` is left exactly as `src/app/commands.ts` writes it — the registry is
 * the source of a command's keys, and rewriting the chord here would put a
 * second spelling of it on screen.
 */

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
