/**
 * The on/off switch — a real `<button role="switch">`, with an optional label
 * that is part of the hit area.
 *
 * A switch, not a checkbox: it takes effect the moment it moves, and there is
 * no form to submit. Where a preference IS a form field (`/settings` writes
 * through `Settings.set` on change), the switch is still the honest control,
 * because the write happens on the click.
 */

import { cx, type ClassValue } from "./cx";

export interface SwitchProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** Shown beside the track and included in the accessible name. */
  readonly label?: string;
  /** Use when the label is rendered elsewhere (a table row, a list item). */
  readonly "aria-label"?: string;
  readonly id?: string;
  readonly disabled?: boolean;
  readonly class?: ClassValue;
}

export function Switch(props: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={props.id}
      aria-checked={props.checked ? "true" : "false"}
      aria-label={props["aria-label"]}
      disabled={props.disabled}
      class={cx(
        "group inline-flex items-center gap-2 text-small text-on-surface-primary",
        "cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
        props.class,
      )}
      onClick={() => props.onChange(!props.checked)}
    >
      <span
        aria-hidden="true"
        class={cx(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
          props.checked ? "border-brand bg-brand" : "border-surface-border bg-surface-tertiary",
        )}
      >
        <span
          class={cx(
            "absolute size-3.5 rounded-full bg-surface-primary shadow-small transition-all",
            props.checked ? "start-4.5" : "start-0.5",
          )}
        />
      </span>
      {props.label !== undefined && <span>{props.label}</span>}
    </button>
  );
}
