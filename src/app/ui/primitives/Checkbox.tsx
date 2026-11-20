import { createEffect } from "solid-js";

import { cx, type ClassValue } from "./cx";

export interface CheckboxProps {
  readonly checked: boolean;
  /** Some of what it stands for is ticked: drawn as a dash, and a click ticks it all. */
  readonly indeterminate?: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly "aria-label"?: string;
  readonly "data-testid"?: string;
  readonly id?: string;
  readonly disabled?: boolean;
  readonly class?: ClassValue;
}

/**
 * A native checkbox in the brand colour: the browser keeps its keyboard,
 * focus ring and screen-reader state. `indeterminate` is a DOM property with
 * no attribute, so it is set on the element.
 */
export function Checkbox(props: CheckboxProps) {
  let element: HTMLInputElement | undefined;
  createEffect(
    () => props.indeterminate === true,
    (some) => {
      if (element !== undefined) element.indeterminate = some;
    },
  );
  return (
    <input
      ref={(held) => {
        element = held;
      }}
      type="checkbox"
      id={props.id}
      checked={props.checked}
      disabled={props.disabled}
      aria-label={props["aria-label"]}
      data-testid={props["data-testid"]}
      class={cx(
        "size-4 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed",
        props.class,
      )}
      onChange={(event) => props.onChange(event.currentTarget.checked)}
    />
  );
}
