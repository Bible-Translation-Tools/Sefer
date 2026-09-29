/**
 * A book's changes, as the engine's decision units: one card per verse (or
 * bridge, or chapter head) that differs, the earlier text above the current
 * one, the words that changed marked inside each.
 *
 * The units come from `core/diff/units` — the same alignment Review uses — and
 * this file only renders them. The one piece of behaviour it carries is the
 * Revert button, and it does not perform the revert either: it asks its
 * caller, which is the panel that owns the Book and the confirmation.
 * `revertUnits` refuses a unit whose book has moved, so a stale button is a
 * refusal rather than a splice at the wrong offsets.
 *
 * Source text (USFM), as History has always shown it: this list is about what
 * the FILE will hold. Long units are clipped at `MAX_CHARS`.
 */

import Undo2 from "lucide-solid/icons/undo-2";
import { For, Show } from "solid-js";

import type { UnitChanges } from "#core/diff/units";
import { unitReference, type DecisionUnit, type TextRun } from "#core/galley";

import { t } from "../../i18n";
import { Badge, Button, Card, EmptyState, cx } from "../primitives";

/** Characters shown per side before the block says it kept some back. */
const MAX_CHARS = 1600;

const STATUS: Record<
  DecisionUnit["status"],
  { readonly label: string; readonly tone: "success" | "error" | "warning" | "muted" }
> = {
  added: { label: "added", tone: "success" },
  deleted: { label: "removed", tone: "error" },
  modified: { label: "changed", tone: "warning" },
  unchanged: { label: "unchanged", tone: "muted" },
};

/** One side of a unit: its runs, the changed ones marked, or its plain text. */
function Side(props: {
  readonly runs: readonly TextRun[] | undefined;
  readonly text: string;
  readonly tone: "added" | "removed";
}) {
  const clipped = () => props.text.length > MAX_CHARS;
  return (
    <div
      class={cx(
        "px-2.5 py-1 font-mono text-smallest break-words whitespace-pre-wrap",
        props.tone === "added"
          ? "border-s-2 border-on-surface-success bg-surface-success/40"
          : "border-s-2 border-on-surface-error bg-surface-error/40",
      )}
      data-side={props.tone}
    >
      <Show
        when={props.runs !== undefined && !clipped()}
        fallback={
          <>
            {clipped() ? props.text.slice(0, MAX_CHARS) : props.text}
            <Show when={clipped()}>
              <span class="opacity-70"> {t("…and more")}</span>
            </Show>
          </>
        }
      >
        <For each={props.runs}>
          {(run) => (
            <Show when={run.kind !== "unchanged"} fallback={run.text}>
              <mark
                class={cx(
                  "rounded-xs px-px font-semibold",
                  props.tone === "added"
                    ? "bg-surface-success text-on-surface-success"
                    : "bg-surface-error text-on-surface-error line-through",
                )}
              >
                {run.text}
              </mark>
            </Show>
          )}
        </For>
      </Show>
    </div>
  );
}

export interface DiffViewProps {
  readonly changes: UnitChanges | undefined;
  /** Offered per unit when the caller can put this one back. */
  readonly onRevert?: (unit: DecisionUnit) => void;
  /** What the empty case says — "no changes" means something different per panel. */
  readonly emptyTitle?: string;
}

export function DiffView(props: DiffViewProps) {
  const units = () => props.changes?.units ?? [];
  const slice = (text: string | undefined, span: DecisionUnit["current"]): string =>
    text === undefined || span === undefined ? "" : text.slice(span.from, span.to).trimEnd();
  return (
    <Show
      when={units().length > 0}
      fallback={<EmptyState title={props.emptyTitle ?? t("No differences.")} />}
    >
      <ul class="space-y-2">
        <For each={units()}>
          {(unit) => (
            <li>
              <Card padded={false} class="overflow-hidden" data-history-unit={unit.id}>
                <div class="flex items-center gap-2 border-b border-surface-border bg-surface-secondary px-2.5 py-1.5">
                  <strong class="text-small font-semibold tabular-nums">
                    {unitReference(unit)}
                  </strong>
                  <Badge tone={STATUS[unit.status].tone}>{t(STATUS[unit.status].label)}</Badge>
                  <Show when={unit.isUsfmStructureChange}>
                    <Badge tone="muted">{t("markup only")}</Badge>
                  </Show>
                  <Show when={props.onRevert}>
                    {(revert) => (
                      <Button
                        size="sm"
                        variant="tertiary"
                        class="ms-auto"
                        icon={<Undo2 />}
                        onClick={() => revert()(unit)}
                      >
                        {t("Revert")}
                      </Button>
                    )}
                  </Show>
                </div>
                <div class="max-h-96 overflow-auto">
                  <Show when={unit.baseline !== undefined}>
                    <Side
                      runs={unit.text?.baseline}
                      text={slice(props.changes?.baselineText, unit.baseline)}
                      tone="removed"
                    />
                  </Show>
                  <Show when={unit.current !== undefined}>
                    <Side
                      runs={unit.text?.current}
                      text={slice(props.changes?.workingText, unit.current)}
                      tone="added"
                    />
                  </Show>
                </div>
              </Card>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}
