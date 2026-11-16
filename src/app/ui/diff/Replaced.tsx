import type { JSX } from "@solidjs/web";
import { mountStamp } from "@wycliffeassociates/sefer-editor";
import { For, Show, createEffect, onCleanup, untrack } from "solid-js";

import { m } from "#app/paraglide/messages";
import type { Analysis } from "#core/galley";
import type { DecisionUnit } from "#core/galley/diff";

import { cardPolicy } from "../multibuffer/policy";

/**
 * What a decision wrote over: the unit as it stood in the editor when the other
 * side was taken, and the analysis its ranges point into. Kept because taking
 * rewrites the editor, so the live text no longer holds it.
 */
export interface Replaced {
  readonly unit: DecisionUnit;
  readonly analysis: Analysis;
}

const marksOf = (unit: DecisionUnit, usfm: boolean) =>
  (unit.status === "modified" ? (unit.text?.current ?? []) : [])
    .filter((run) => run.kind !== "unchanged" && (run.what === "text" || usfm))
    .map((run) => ({ from: run.from, to: run.to, class: "cm-diff-removed" }));

function Stamp(props: { readonly item: Replaced; readonly usfm: boolean }): JSX.Element {
  let mount: ReturnType<typeof mountStamp> | undefined;
  createEffect(
    () => props.usfm,
    (usfm) => {
      mount?.setPolicy(cardPolicy(usfm ? "usfm" : "regular"));
      mount?.remark(marksOf(props.item.unit, usfm));
    },
  );
  onCleanup(() => mount?.destroy());
  return (
    <div
      class="min-w-0 flex-1 opacity-70 [&_.cm-content]:!text-small [&_.cm-content]:!leading-[1.6]"
      ref={(element) => {
        const { unit, analysis } = untrack(() => props.item);
        const range = unit.current;
        if (range === undefined) return;
        const usfm = untrack(() => props.usfm);
        mount = mountStamp({
          parent: element,
          analysis,
          range,
          policy: cardPolicy(usfm ? "usfm" : "regular"),
          marks: marksOf(unit, usfm),
          surface: "cm-diff",
          label: `replaced:${unit.id}`,
        });
      }}
    />
  );
}

/** "Was …": the editor's words a decision replaced, struck through, under the text that replaced them. */
export function ReplacedLine(props: {
  readonly replaced: readonly Replaced[];
  readonly usfm: boolean;
}): JSX.Element {
  return (
    <Show when={props.replaced.length > 0}>
      <div
        class="mx-3 mb-2 flex items-baseline gap-2 border-t border-dashed border-surface-border pt-1.5"
        data-diff-replaced
      >
        <span class="shrink-0 text-smallest tracking-wide text-on-surface-tertiary uppercase">
          {m.diff_was()}
        </span>
        <div class="flex min-w-0 flex-1 flex-col">
          <For each={props.replaced}>{(item) => <Stamp item={item} usfm={props.usfm} />}</For>
        </div>
      </div>
    </Show>
  );
}
