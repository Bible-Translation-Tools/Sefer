/**
 * The two formatters the history and save panels share.
 *
 * `Intl.RelativeTimeFormat` rather than a hand-rolled "3 minutes ago": the
 * strings it produces are already localised for the host's locale, which is
 * more than `t()` can do today, and a commit list is the one place in the
 * product where an approximate time reads better than an exact one. The exact
 * one is still available — every row carries `title={exact(at)}`.
 */

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ["second", 1000],
  ["minute", 60_000],
  ["hour", 3_600_000],
  ["day", 86_400_000],
  ["week", 604_800_000],
  ["month", 2_629_800_000],
  ["year", 31_557_600_000],
];

/** "3 minutes ago", in the host's locale. */
export const ago = (at: number, now = Date.now()): string => {
  const elapsed = at - now;
  const magnitude = Math.abs(elapsed);
  let unit: Intl.RelativeTimeFormatUnit = "second";
  let size = 1000;
  for (const [name, ms] of UNITS) {
    if (magnitude < ms) break;
    unit = name;
    size = ms;
  }
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  return format.format(Math.round(elapsed / size), unit);
};

/** The full timestamp, for the `title` a relative one hides. */
export const exact = (at: number): string => new Date(at).toLocaleString();

/**
 * The lines of a text slice, without the empty tail a trailing newline leaves.
 *
 * A diff hunk's text is a slice of whole lines, so it ends with `\n` whenever
 * it is not the last line of the file; splitting it naively would count one
 * phantom line per hunk.
 */
export const lines = (text: string): readonly string[] => {
  if (text === "") return [];
  const split = text.split("\n");
  if (split.at(-1) === "") split.pop();
  return split;
};
