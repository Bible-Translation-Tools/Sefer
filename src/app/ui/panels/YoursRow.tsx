/**
 * History's third row: your text, against the selected version, for one card.
 *
 * Offered only where your text differs from that version at the card's
 * passage, and opened by the card's "Yours differs". It is the card's own
 * unified view — your text, with this version's wording opened beside a
 * change — clipped to the passages that differ, read-only: what you would
 * replace by adopting either side.
 */

import { For, createEffect, createSignal, untrack } from "solid-js";

import { mountDiffView } from "#editor/index";

import { t } from "../../i18n";
import { wasBlock, type DiffSides } from "../diff/DiffCard";
import type { Hunk } from "../diff/hunks";
import { hunkPaint } from "../diff/paint";

export function YoursRow(props: {
  /** Your text against this version: `baseline` is the version, `current` yours. */
  readonly sides: DiffSides;
  /** Your text's passages that differ, as cards cut them. */
  readonly hunks: readonly Hunk[];
  readonly usfm: boolean;
  readonly label: string;
}) {
  return (
    <div class="border-t border-surface-border" data-history-yours>
      <p class="px-3 py-0.5 text-smallest text-on-surface-tertiary">{props.label}</p>
      <For each={props.hunks}>
        {(hunk) => <YoursClip sides={props.sides} hunk={hunk} usfm={props.usfm} />}
      </For>
    </div>
  );
}

function YoursClip(props: {
  readonly sides: DiffSides;
  readonly hunk: Hunk;
  readonly usfm: boolean;
}) {
  const [host, setHost] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "yoursHost",
  });
  createEffect(
    () => ({ parent: host(), sides: props.sides, hunk: props.hunk, usfm: props.usfm }),
    ({ parent, sides, hunk, usfm }) => {
      if (parent === undefined) return;
      const mode = usfm ? "usfm" : "default";
      // A one-time build of a read-only view; a new comparison rebuilds it.
      const mount = untrack(() =>
        mountDiffView({
          parent,
          text: sides.currentText,
          analyze: () => sides.current,
          mode,
          clip: hunk.current,
          surface: "cm-diff cm-diff-card",
          paint: hunkPaint(
            hunk.all,
            usfm,
            undefined,
            wasBlock(sides.baseline, mode),
            sides.current,
          ),
        }),
      );
      return () => mount.destroy();
    },
  );
  return <div class="min-w-0" ref={setHost} aria-label={t("Your text")} />;
}
