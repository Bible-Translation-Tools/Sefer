/**
 * A globe turned to face a region, for the WACS table's region filter.
 *
 * lucide has no region globes (`earth` always shows the Americas), so these
 * are drawn in its idiom — a 24×24 box, a 2px round stroke, outline only — and
 * sit beside its icons without looking borrowed. The continents are
 * deliberately rough: at 16px a glyph has to say "this side of the world",
 * not be a map. A region the langnames data grows later falls back to the
 * plain globe, as "no region" does.
 */

import type { JSX } from "@solidjs/web";
import Globe from "lucide-solid/icons/globe";
import { For } from "solid-js";

/** Continent outlines per region, inside the globe's r=10 circle. */
const LANDS: Readonly<Record<string, readonly string[]>> = {
  // Africa, with the Arabian corner at its top right.
  Africa: [
    "M8.6 5.2 12.4 4.6l2.8 1 1.5 2.1.2 2.3 2 1.5-.6 2.4-2.4 2.2-.9 3.1-1.8 1.9-1.5-.6-.9-2.8-.4-2.8-1.7-1.7-2-.7-.8-2.2.9-2.4z",
  ],
  // North America over South America, the isthmus between them.
  Americas: [
    "M4.2 6.4 7.8 4.4l3.8.8 1.4 1.8-.6 2.4-2.4 1.8-1.4 1.9-1.5-.2-1.2-2-1.9-.9z",
    "M11.6 12.2l2.8.3 2.3 2.1-.6 2.7-2.1 2.6-1.2-.2-.8-2.8-.9-2.6z",
  ],
  // The long northern mass, India hanging below, and the peninsula east.
  Asia: [
    "M3.4 9 6 6.6l4.2-1.4 4.4.2 3.4 1.2 2.4 2.4-.4 2.2-2.4.2-1.6 1.6-.6 2.4-1.4-.8-.2-1.8-2 .2-1 2.8-1.6-2.6-2.4-.8-1.4-1.8z",
    "M17 14.4l1.2 1.8-.9 1.6",
  ],
  // Scandinavia above, Iberia to the left, Italy's boot below.
  Europe: [
    "M12.6 4.4 14.4 4l.8 2.6-1.2 2.2",
    "M6.8 11.2 9 9.6l2.4.2 2-1 2.6.4 1.4 1.8-1 1.8-2.2.2-.8 2.6 1 2.2-1.4.2-1.2-2.4-2 .2-.8-2-2.6.4-.8-1.8z",
  ],
  // Australia, and the scatter of islands north and east of it.
  Pacific: [
    "M9.6 13.4 13 12l3 .6 1.6 2.3-1.2 2.6-2.8.5-2.6-1-1.6-2z",
    "M6.8 8.4h.01M9.6 6.6h.01M14.6 7.8h.01M17.6 9.8h.01M18.8 12.6h.01",
  ],
};

export function RegionIcon(props: {
  readonly region: string;
  readonly size?: number;
}): JSX.Element {
  const lands = (): readonly string[] | undefined => LANDS[props.region];
  const size = (): number => props.size ?? 16;
  return (
    <>
      {lands() === undefined ? (
        <Globe size={size()} aria-hidden="true" class="shrink-0" />
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={size()}
          height={size()}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          class="shrink-0"
        >
          <circle cx="12" cy="12" r="10" />
          <For each={lands()}>{(path) => <path d={path} stroke-width="1.5" />}</For>
        </svg>
      )}
    </>
  );
}
