/**
 * The character itself, shown as a character.
 *
 * The whole page is about punctuation, so the one thing every row and every
 * card has to do well is show a mark large enough to recognise, in the family
 * scripture is set in — a comma and a Hebrew maqaf are three pixels apart in a
 * UI sans at 14px. The tile is tinted rather than bordered so a row reads as a
 * specimen, not as a form field.
 *
 * A glyph with no ink of its own — a space, a no-break space, a format
 * character — draws the open-box symbol instead, and the tile says `blank` to
 * a screen reader. Rendering nothing would make two different invisible
 * characters look like the same empty tile.
 */

import { cx, type ClassValue } from "../primitives";

/** U+2423 OPEN BOX: the conventional stand-in for a space you must see. */
const BLANK = "␣";

/** True for anything that would draw no ink: separators, controls, formats. */
export const invisible = (char: string): boolean => char === "" || /^[\p{Z}\p{C}]$/u.test(char);

export interface GlyphTileProps {
  /** The character; empty for the pooled digit lane. */
  readonly char: string;
  readonly size?: "sm" | "md" | "lg";
  /** The pooled digit lane has no character — it draws `0-9`. */
  readonly pooled?: boolean;
  readonly class?: ClassValue;
}

const BOX = {
  sm: "size-7 text-body",
  md: "size-9 text-h4",
  lg: "size-14 text-h2",
} as const;

export function GlyphTile(props: GlyphTileProps) {
  const shown = (): string =>
    props.pooled === true ? "0-9" : invisible(props.char) ? BLANK : props.char;

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
