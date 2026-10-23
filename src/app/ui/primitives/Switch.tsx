import { cx, type ClassValue } from "./cx";

export interface SwitchProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label?: string;
  readonly "aria-label"?: string;
  readonly id?: string;
  readonly disabled?: boolean;
  readonly class?: ClassValue;
  readonly labelFirst?: boolean;
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
      {props.labelFirst === true && props.label !== undefined && <span>{props.label}</span>}
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
      {props.labelFirst !== true && props.label !== undefined && <span>{props.label}</span>}
    </button>
  );
}
