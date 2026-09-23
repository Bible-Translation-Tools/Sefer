/**
 * A book's hunks, as the +/- lines people expect from a diff.
 *
 * The hunks come from `core/diff` — line-based, ascending, non-overlapping,
 * in working-text offsets — and this file only renders them. The one piece of
 * behaviour it carries is the Revert button, and it does not perform the
 * revert either: it asks its caller, which is the panel that owns the Book and
 * the confirmation. `diff.revert` refuses a hunk whose book has moved, so a
 * stale button is a refusal rather than a splice at the wrong offsets.
 *
 * Long hunks are clipped at `MAX_LINES`. A whole-book replace hunk (what the
 * LCS guard produces above `MAX_LCS_CELLS`) would otherwise put a thousand
 * monospace rows on the page, which is not a diff anybody reads.
 */

import Undo2 from "lucide-solid/icons/undo-2";
import { For, Show } from "solid-js";

import type { Hunk } from "#core/diff/diff";

import { t } from "../../i18n";
import { Badge, Button, Card, EmptyState } from "../primitives";
import { lines } from "./format";

/** The shared shape of one diff line; the tone is chosen beside it. */
const LINE = "flex gap-2 px-2.5 py-px font-mono text-smallest whitespace-pre-wrap";

/** Rows shown per side before the block says how many it kept back. */
const MAX_LINES = 24;

const KIND_LABEL: Record<Hunk["kind"], string> = {
  insert: "added",
  delete: "removed",
  replace: "changed",
};

function Side(props: {
  readonly text: string;
  readonly sign: "+" | "-";
  readonly tone: "added" | "removed";
}) {
  const all = () => lines(props.text);
  const shown = () => all().slice(0, MAX_LINES);
  return (
    <For each={shown()}>
      {(line, index) => (
        <div
          class={[
            LINE,
            props.tone === "added"
              ? "bg-surface-success text-on-surface-success"
              : "bg-surface-error text-on-surface-error",
          ]}
        >
          <span aria-hidden="true" class="select-none opacity-70">
            {props.sign}
          </span>
          <span class="min-w-0 break-all">{line === "" ? " " : line}</span>
          <Show when={index() === shown().length - 1 && all().length > MAX_LINES}>
            <span class="ms-auto shrink-0 opacity-70">
              {t("+{count} more", { count: all().length - MAX_LINES })}
            </span>
          </Show>
        </div>
      )}
    </For>
  );
}

export interface DiffViewProps {
  readonly hunks: readonly Hunk[];
  /** Offered per hunk when the caller can put this one back. */
  readonly onRevert?: (hunk: Hunk) => void;
  /** What the empty case says — "no changes" means something different per panel. */
  readonly emptyTitle?: string;
}

export function DiffView(props: DiffViewProps) {
  return (
    <Show
      when={props.hunks.length > 0}
      fallback={<EmptyState title={props.emptyTitle ?? t("No differences.")} />}
    >
      <ul class="space-y-2">
        <For each={props.hunks}>
          {(hunk) => (
            <li>
              <Card padded={false} class="overflow-hidden">
                <div class="flex items-center gap-2 border-b border-surface-border bg-surface-secondary px-2.5 py-1.5">
                  <Badge
                    tone={
                      hunk.kind === "insert"
                        ? "success"
                        : hunk.kind === "delete"
                          ? "error"
                          : "warning"
                    }
                  >
                    {t(KIND_LABEL[hunk.kind])}
                  </Badge>
                  <code class="font-mono text-smallest text-on-surface-tertiary">
                    {hunk.from}–{hunk.to}
                  </code>
                  <Show when={props.onRevert}>
                    {(revert) => (
                      <Button
                        size="sm"
                        variant="tertiary"
                        class="ms-auto"
                        icon={<Undo2 size={12} />}
                        onClick={() => revert()(hunk)}
                      >
                        {t("Revert")}
                      </Button>
                    )}
                  </Show>
                </div>
                <div class="max-h-96 overflow-auto">
                  <Side text={hunk.baseline} sign="-" tone="removed" />
                  <Side text={hunk.working} sign="+" tone="added" />
                </div>
              </Card>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}
