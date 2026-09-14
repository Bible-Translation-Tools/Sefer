/**
 * The modal dialog, over `@corvu-next/dialog`.
 *
 * One of the four files allowed to import corvu. corvu owns what is hard —
 * the focus trap, the scroll lock, the Escape and outside-click handling, the
 * `aria-labelledby` wiring — and this file owns the look.
 *
 * `title` is required: a dialog with no accessible name is one a screen reader
 * announces as "dialog" and nothing else. `description` is optional and is
 * wired to `aria-describedby` when present.
 */

import CorvuDialog from "@corvu-next/dialog";
import type { JSX } from "@solidjs/web";

import { cx, type ClassValue } from "./cx";

export interface DialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  /** Buttons, laid out at the end of a footer row. Omit for a bare panel. */
  readonly footer?: JSX.Element;
  /** Classes for the panel — a width, usually. */
  readonly class?: ClassValue;
  readonly children: JSX.Element;
}

export function Dialog(props: DialogProps) {
  return (
    <CorvuDialog open={props.open} onOpenChange={props.onOpenChange}>
      <CorvuDialog.Portal>
        <CorvuDialog.Overlay class="fixed inset-0 z-40 bg-surface-overlay" />
        <CorvuDialog.Content
          class={cx(
            "fixed left-1/2 top-1/2 z-50 w-[min(34rem,90vw)] -translate-x-1/2 -translate-y-1/2",
            "rounded-xl border border-surface-border bg-surface-primary p-5 shadow-large",
            props.class,
          )}
        >
          <CorvuDialog.Label class="text-h4 font-semibold text-on-surface-primary">
            {props.title}
          </CorvuDialog.Label>
          {props.description !== undefined && (
            <CorvuDialog.Description class="mt-1 text-small text-on-surface-tertiary">
              {props.description}
            </CorvuDialog.Description>
          )}
          <div class="mt-4 text-small text-on-surface-primary">{props.children}</div>
          {props.footer !== undefined && (
            <div class="mt-5 flex items-center justify-end gap-2">{props.footer}</div>
          )}
        </CorvuDialog.Content>
      </CorvuDialog.Portal>
    </CorvuDialog>
  );
}
