/**
 * Two texts of one book, verse beside verse, chapter by chapter.
 *
 * This is the prototype's chapter view (`DiffModal/DiffModalChapterView.tsx`)
 * on our tokens and our model: a three-column grid — the left text, a gutter
 * holding the reference and the row's one action, the right text — repeated
 * per verse, under a heading per chapter. Nothing about the layout is
 * decorative: the columns are what let a reviewer read one verse across, and
 * the verse-keyed alignment (`core/diff/verses.ts`) is what keeps them level
 * when one side gains or loses a paragraph.
 *
 * Two things it deliberately does NOT do:
 *
 *   * it does not decide what the sides ARE. The Save screen puts the file on
 *     disk on the left and the editor on the right; another screen could put
 *     two other things there. The column titles are props, and they are never
 *     "left" and "right".
 *   * it does not revert. `onRevert` is called with the row, and the caller —
 *     which owns the Book and the confirmation — does the work through
 *     `diff.revert`, the same funnel the unified view uses.
 *
 * Unchanged verses are folded away by default. A review screen that printed
 * all 1,151 verses of Luke to show one changed word would be a search problem
 * rather than a review; the toggle is there for the reader who wants the
 * context back.
 */

import Undo2 from "lucide-solid/icons/undo-2";
import { For, Show, createMemo } from "solid-js";

import { hasInlineChange, inlineDiff, sideOf, type InlineSegment } from "../../../core/diff/inline";
import { byChapter, type VerseRow } from "../../../core/diff/verses";
import { t } from "../../i18n";
import { Badge, EmptyState, IconButton, cx } from "../primitives";

/** The text of one side, with the characters that differ marked more strongly. */
function Text(props: {
  readonly segments: readonly InlineSegment[];
  readonly side: "before" | "after";
  readonly tone: "neutral" | "removed" | "added";
}) {
  return (
    <p
      class={cx(
        "min-w-0 rounded-sm px-2.5 py-1.5 font-mono text-smallest break-words whitespace-pre-wrap",
        props.tone === "removed" && "bg-surface-error text-on-surface-error",
        props.tone === "added" && "bg-surface-success text-on-surface-success",
        props.tone === "neutral" && "text-on-surface-secondary",
      )}
    >
      <Show
        when={props.segments.length > 0}
        fallback={<span class="italic opacity-60">{t("Nothing on this side")}</span>}
      >
        <For each={props.segments}>
          {(segment) => (
            <Show when={segment.kind !== "same"} fallback={<span>{segment.text}</span>}>
              {/* The stronger mark: the same hue, filled in. A reader scanning a
                  coloured row still has to find the word, and this is the answer
                  to "which characters" that a line diff cannot give. */}
              <mark
                class={cx(
                  "rounded-xs px-px font-semibold",
                  props.side === "before"
                    ? "bg-on-surface-error/25 text-on-surface-error"
                    : "bg-on-surface-success/30 text-on-surface-success",
                )}
              >
                {segment.text}
              </mark>
            </Show>
          )}
        </For>
      </Show>
    </p>
  );
}

/** The grid's three tracks, spelled once so the header and the rows agree. */
const GRID = "grid grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)] gap-x-1";

export interface SideBySideProps {
  readonly rows: readonly VerseRow[];
  /** The column titles — never "left" and "right". */
  readonly leftLabel: string;
  readonly rightLabel: string;
  /** Offered per row when the caller can put this one back. */
  readonly onRevert?: (row: VerseRow) => void;
  /** The word on that button, which is not "Revert" on every screen. */
  readonly revertLabel?: string;
  /** Unchanged verses, for context. Off by default — see the file header. */
  readonly showUnchanged?: boolean;
  readonly emptyTitle?: string;
}

export function SideBySide(props: SideBySideProps) {
  /**
   * One pass over the rows: the chapters, their kept rows, and the inline
   * segments for each. A memo because the character diff is the expensive part
   * and a row must not recompute it every time the grid repaints.
   */
  const chapters = createMemo(
    () =>
      byChapter(props.rows)
        .map((chapter) => ({
          chapter: chapter.chapter,
          changed: chapter.changed,
          rows: chapter.rows
            .filter((row) => props.showUnchanged === true || row.kind !== "same")
            .map((row) => {
              const segments = row.kind === "same" ? [] : inlineDiff(row.baseline, row.working);
              return {
                row,
                // A row the character diff found nothing shared in (one side
                // empty, or a wholesale replacement past the cap) shows both
                // columns plainly rather than marking every character.
                marked: hasInlineChange(segments) && segments.some((part) => part.kind === "same"),
                before: sideOf(segments, "before"),
                after: sideOf(segments, "after"),
              };
            }),
        }))
        .filter((chapter) => chapter.rows.length > 0),
    { name: "sideBySideChapters" },
  );

  const changed = () => props.rows.filter((row) => row.kind !== "same").length;

  const plain = (text: string): readonly InlineSegment[] =>
    text === "" ? [] : [{ kind: "same", text }];

  return (
    <Show
      when={changed() > 0}
      fallback={<EmptyState title={props.emptyTitle ?? t("No differences.")} />}
    >
      <div class="space-y-4" data-side-by-side={changed()}>
        <div
          class={cx(
            GRID,
            "text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase",
          )}
        >
          <span class="truncate px-2.5" data-side="left">
            {props.leftLabel}
          </span>
          <span />
          <span class="truncate px-2.5" data-side="right">
            {props.rightLabel}
          </span>
        </div>

        <For each={chapters()}>
          {(chapter) => (
            <section data-chapter={chapter.chapter} class="space-y-1">
              <header class="flex items-baseline gap-2 border-b border-surface-border pb-1">
                <h4 class="text-small font-semibold text-on-surface-primary">
                  <Show when={chapter.chapter > 0} fallback={t("Front matter")}>
                    {t("Chapter {number}", { number: chapter.chapter })}
                  </Show>
                </h4>
                <Badge tone={chapter.changed > 0 ? "warning" : "muted"}>
                  {t("{count} changed", { count: chapter.changed })}
                </Badge>
              </header>

              <div class={cx(GRID, "items-start gap-y-1")}>
                <For each={chapter.rows}>
                  {(entry) => (
                    <>
                      <Text
                        segments={entry.marked ? entry.before : plain(entry.row.baseline)}
                        side="before"
                        tone={entry.row.kind === "same" ? "neutral" : "removed"}
                      />
                      <div
                        class="flex flex-col items-center gap-1 py-1.5"
                        data-verse={entry.row.reference}
                        data-kind={entry.row.kind}
                      >
                        <span class="text-smallest tabular-nums text-on-surface-tertiary">
                          {entry.row.reference}
                        </span>
                        <Show when={props.onRevert !== undefined && entry.row.kind !== "same"}>
                          <IconButton
                            size="sm"
                            label={
                              props.revertLabel ??
                              t("Revert {reference}", { reference: entry.row.reference })
                            }
                            icon={<Undo2 size={12} />}
                            onClick={() => props.onRevert?.(entry.row)}
                          />
                        </Show>
                      </div>
                      <Text
                        segments={entry.marked ? entry.after : plain(entry.row.working)}
                        side="after"
                        tone={entry.row.kind === "same" ? "neutral" : "added"}
                      />
                    </>
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </div>
    </Show>
  );
}
