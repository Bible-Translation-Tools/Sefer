import { cx, type ClassValue } from "../primitives";

const BLANK = "␣";

const invisible = (char: string): boolean => char === "" || /^[\p{Z}\p{C}]$/u.test(char);

export interface GlyphTileProps {
  readonly char: string;
  readonly size?: "sm" | "md" | "lg";
  readonly pooled?: boolean;
  readonly class?: ClassValue;
}

const BOX = {
  sm: "size-7 text-body",
  md: "size-9 text-h4",
  lg: "size-14 text-h2",
} as const;

export function GlyphTile(props: GlyphTileProps) {
  const shown = (): string => {
    if (props.pooled === true) return "0-9";
    return invisible(props.char) ? BLANK : props.char;
  };

  return (
    <span
      class={cx(
        "inline-flex shrink-0 items-center justify-center rounded-md bg-brand-light",
        "font-scripture leading-none text-on-surface-primary tabular-nums",
        BOX[props.size ?? "md"],
        props.pooled === true ? "text-smallest font-semibold" : undefined,
        invisible(props.char) && props.pooled !== true ? "text-on-surface-tertiary" : undefined,
        props.class,
      )}
      aria-hidden="true"
    >
      {shown()}
    </span>
  );
}
