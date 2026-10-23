import { mountDiffView } from "@sefer/editor";
import { For, createEffect, createSignal, untrack } from "solid-js";

import { t } from "../../i18n";
import { wasBlock, type DiffSides } from "../diff/DiffCard";
import type { Hunk } from "../diff/hunks";
import { hunkPaint } from "../diff/paint";

export function YoursRow(props: {
  readonly sides: DiffSides;
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
