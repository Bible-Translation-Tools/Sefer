/**
 * One book's differences, each with a side to choose.
 *
 * The pair of buttons IS the decision map's editor and nothing else: clicking
 * one calls back with `left`, `right` or `undecided`, and the panel above
 * holds the map. Nothing here writes, which is the whole reason a reader can
 * change their mind up to the moment they press Apply.
 *
 * `aria-pressed` rather than a SegmentedControl because there are three states
 * and only two buttons: undecided is neither pressed, which a radio group
 * cannot say.
 *
 * ## Neither side is "left", and neither side is wrong
 *
 * The screen says **This project** and the other source's own name, never
 * "left" and "right" — a reader choosing between two copies of their work is
 * not reading a coordinate system, and the buttons say what will happen
 * ("Keep this project's", "Take the zip's") rather than which column wins.
 *
 * The colours follow from the same thought. Red and green are a judgement:
 * they say one side is a deletion and the other an addition, which is true of
 * a diff against your own past and false of a comparison between two people's
 * work. So the tint is by SIDE — the brand tint for this project, a neutral
 * tint for the other — and it carries no verdict. (A `compare.colours` setting
 * to bring red/green back for readers who prefer it is noted but not built;
 * see documentation/architecture/compare.md.)
 *
 * Inside a hunk, `core/diff/inline.ts` marks the characters that actually
 * differ, so a reader does not have to find the changed word in two tinted
 * paragraphs themselves.
 */

import { For, Show, createMemo } from "solid-js";

import type { BookComparison, CompareHunk, Decision, Decisions } from "../../../core/compare";
import { decisionFor, wholeBookHunkId } from "../../../core/compare";
import { hasInlineChange, inlineDiff, sideOf, type InlineSegment } from "../../../core/diff/inline";
import { t } from "../../i18n";
import { Badge, Button, Card, EmptyState, cx } from "../primitives";

/** Rows shown per side before the block says how many it kept back. */
const MAX_LINES = 20;

const LINE = "flex gap-2 px-2.5 py-px font-mono text-smallest break-words whitespace-pre-wrap";

/**
 * The two side tints. `mine` is the brand; `theirs` is neutral. Both carry a
 * start-edge rule so the side is legible without relying on hue alone, which
 * is what makes the pair work for a reader who cannot tell the two apart.
 */
const TINT = {
  mine: "bg-brand-light text-on-surface-primary border-s-2 border-brand",
  theirs: "bg-surface-secondary text-on-surface-secondary border-s-2 border-on-surface-tertiary",
} as const;

const MARK = {
  mine: "bg-brand/25 text-brand-strong",
  theirs: "bg-on-surface-tertiary/30 text-on-surface-primary",
} as const;

type Which = "mine" | "theirs";

const KIND_LABEL: Record<CompareHunk["kind"], string> = {
  insert: "only in the other copy",
  delete: "only in this project",
  replace: "changed",
};

/**
 * One side's lines, with the characters that differ marked.
 *
 * The segments arrive already computed for the whole slice, so they are split
 * back onto lines here rather than diffed a second time per line — one
 * character diff per hunk, however many lines it spans.
 */
const segmentLines = (
  segments: readonly InlineSegment[],
): readonly (readonly InlineSegment[])[] => {
  const out: InlineSegment[][] = [[]];
  for (const segment of segments) {
    const parts = segment.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) out.push([]);
      if (part !== "") out.at(-1)?.push({ kind: segment.kind, text: part });
    });
  }
  // The empty tail a trailing newline leaves, as `lines` drops it.
  if (out.length > 1 && (out.at(-1)?.length ?? 0) === 0) out.pop();
  return out;
};

function Side(props: {
  readonly text: string;
  /** Marked-up lines, when the two sides were compared character by character. */
  readonly marked?: readonly (readonly InlineSegment[])[];
  readonly which: Which;
  readonly dimmed: boolean;
}) {
  const all = () => props.marked ?? segmentLines([{ kind: "same", text: props.text }]);
  const shown = () => all().slice(0, MAX_LINES);
  return (
    <div class={cx("min-w-0", props.dimmed && "opacity-40")} data-side={props.which}>
      <Show
        when={props.text !== ""}
        fallback={
          <p class="px-2.5 py-1 text-smallest text-on-surface-tertiary italic">
            {t("Nothing on this side")}
          </p>
        }
      >
        <For each={shown()}>
          {(line, index) => (
            <div class={cx(LINE, TINT[props.which])}>
              <span class="min-w-0 break-all">
                <Show when={line.length > 0} fallback={<span> </span>}>
                  <For each={line}>
                    {(segment) => (
                      <Show when={segment.kind !== "same"} fallback={<span>{segment.text}</span>}>
                        <mark class={cx("rounded-xs px-px font-semibold", MARK[props.which])}>
                          {segment.text}
                        </mark>
                      </Show>
                    )}
                  </For>
                </Show>
              </span>
              <Show when={index() === shown().length - 1 && all().length > MAX_LINES}>
                <span class="ms-auto shrink-0 opacity-70">
                  {t("+{count} more", { count: all().length - MAX_LINES })}
                </span>
              </Show>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

interface ChoiceProps {
  readonly decision: Decision;
  readonly mineLabel: string;
  readonly theirsLabel: string;
  readonly mineDisabled?: boolean;
  readonly theirsDisabled?: boolean;
  readonly onChoose: (decision: Decision) => void;
}

/** Keep this project's / Take theirs, with a click on the chosen one clearing it. */
function Choice(props: ChoiceProps) {
  const choose = (side: Decision) => () =>
    props.onChoose(props.decision === side ? "undecided" : side);
  return (
    <div class="ms-auto flex shrink-0 items-center gap-1">
      <Button
        size="sm"
        variant={props.decision === "left" ? "primary" : "tertiary"}
        aria-pressed={props.decision === "left" ? "true" : "false"}
        disabled={props.mineDisabled === true}
        onClick={choose("left")}
      >
        {props.mineLabel}
      </Button>
      <Button
        size="sm"
        variant={props.decision === "right" ? "primary" : "tertiary"}
        aria-pressed={props.decision === "right" ? "true" : "false"}
        disabled={props.theirsDisabled === true}
        onClick={choose("right")}
      >
        {props.theirsLabel}
      </Button>
    </div>
  );
}

export interface BookReviewProps {
  readonly book: BookComparison;
  readonly decisions: Decisions;
  /** The open project's own name — the title of the first column. */
  readonly mineLabel: string;
  /** What the other source calls itself — the title of the second. */
  readonly theirsLabel: string;
  /** A short name for the other source, for a button: "the zip", "the folder". */
  readonly theirsShort: string;
  /**
   * True when this project could not carry out the choice — adding a book it
   * does not have, or removing one it does. The button is shown disabled with
   * the reason rather than hidden: the reader asked a real question and the
   * honest answer is "not yet".
   */
  readonly cannotAdd: boolean;
  readonly onDecide: (id: string, decision: Decision) => void;
}

export function BookReview(props: BookReviewProps) {
  const oneSided = () => props.book.presence !== "both";
  const wholeBook = () => wholeBookHunkId(props.book.bookId);

  const keepLabel = () => t("Keep this project's");
  const takeLabel = () => t("Take {source}'s", { source: props.theirsShort });

  /**
   * The character diff of every hunk, once. A memo because it is the expensive
   * part of drawing this list and a decision click must not recompute it.
   */
  const marked = createMemo(
    () => {
      const out = new Map<
        string,
        {
          readonly mine: readonly (readonly InlineSegment[])[];
          readonly theirs: readonly (readonly InlineSegment[])[];
        }
      >();
      for (const hunk of props.book.hunks) {
        const segments = inlineDiff(hunk.left, hunk.right);
        // Nothing shared means nothing worth marking — a whole-slice swap, or
        // one side empty. The plain tinted text says that better than marking
        // every character does.
        if (!hasInlineChange(segments) || !segments.some((part) => part.kind === "same")) continue;
        out.set(hunk.id, {
          mine: segmentLines(sideOf(segments, "before")),
          theirs: segmentLines(sideOf(segments, "after")),
        });
      }
      return out;
    },
    { name: "compareInlineMarks" },
  );

  return (
    <Show
      when={!props.book.identical}
      fallback={
        <EmptyState
          title={t("No differences in {book}.", { book: props.book.bookId })}
          description={t("Both sides hold exactly the same text.")}
        />
      }
    >
      <Show when={oneSided()}>
        <Card
          padded={false}
          class="overflow-hidden"
          data-compare-hunk={wholeBook()}
          data-decision={decisionFor(props.decisions, wholeBook())}
        >
          <div class="flex items-center gap-2 border-b border-surface-border bg-surface-secondary px-2.5 py-1.5">
            <Badge tone={props.book.presence === "left" ? "brand" : "neutral"}>
              {props.book.presence === "left"
                ? t("only in this project")
                : t("only in {source}", { source: props.theirsShort })}
            </Badge>
            <span class="text-smallest text-on-surface-tertiary">
              {props.book.presence === "left"
                ? t("{book} is in {mine} and not in {theirs}.", {
                    book: props.book.bookId,
                    mine: props.mineLabel,
                    theirs: props.theirsLabel,
                  })
                : t("{book} is in {theirs} and not in {mine}.", {
                    book: props.book.bookId,
                    mine: props.mineLabel,
                    theirs: props.theirsLabel,
                  })}
            </span>
            <Choice
              decision={decisionFor(props.decisions, wholeBook())}
              mineLabel={props.book.presence === "left" ? t("Keep it") : t("Leave it out")}
              theirsLabel={props.book.presence === "left" ? t("Drop it") : t("Bring it in")}
              theirsDisabled={props.cannotAdd}
              onChoose={(decision) => props.onDecide(wholeBook(), decision)}
            />
          </div>
          <Show when={props.cannotAdd}>
            <p class="border-b border-surface-border px-2.5 py-1.5 text-smallest text-on-surface-tertiary">
              {props.book.presence === "left"
                ? t("Compare cannot remove a book from this project yet.")
                : t("Compare cannot add a book to this project yet.")}
            </p>
          </Show>
          <div class="max-h-96 overflow-auto">
            <Side
              text={props.book.leftText ?? props.book.rightText ?? ""}
              which={props.book.presence === "left" ? "mine" : "theirs"}
              dimmed={false}
            />
          </div>
        </Card>
      </Show>

      <Show when={!oneSided()}>
        <ul class="space-y-2">
          <For each={props.book.hunks}>
            {(hunk) => {
              const decision = () => decisionFor(props.decisions, hunk.id);
              const inline = () => marked().get(hunk.id);
              return (
                <li>
                  <Card
                    padded={false}
                    class="overflow-hidden"
                    data-compare-hunk={hunk.id}
                    data-decision={decision()}
                  >
                    <div class="flex items-center gap-2 border-b border-surface-border bg-surface-secondary px-2.5 py-1.5">
                      <Badge
                        tone={
                          hunk.kind === "insert"
                            ? "neutral"
                            : hunk.kind === "delete"
                              ? "brand"
                              : "warning"
                        }
                      >
                        {t(KIND_LABEL[hunk.kind])}
                      </Badge>
                      <code class="font-mono text-smallest text-on-surface-tertiary">
                        {hunk.leftFrom}–{hunk.leftTo}
                      </code>
                      <Choice
                        decision={decision()}
                        mineLabel={keepLabel()}
                        theirsLabel={takeLabel()}
                        onChoose={(next) => props.onDecide(hunk.id, next)}
                      />
                    </div>
                    <div class="grid gap-px border-t border-surface-border sm:grid-cols-2">
                      <div class="max-h-96 min-w-0 overflow-auto">
                        <p
                          class="truncate px-2.5 py-1 text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase"
                          data-column="mine"
                        >
                          {props.mineLabel}
                        </p>
                        <Side
                          text={hunk.left}
                          marked={inline()?.mine}
                          which="mine"
                          dimmed={decision() === "right"}
                        />
                      </div>
                      <div class="max-h-96 min-w-0 overflow-auto">
                        <p
                          class="truncate px-2.5 py-1 text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase"
                          data-column="theirs"
                        >
                          {props.theirsLabel}
                        </p>
                        <Side
                          text={hunk.right}
                          marked={inline()?.theirs}
                          which="theirs"
                          dimmed={decision() === "left"}
                        />
                      </div>
                    </div>
                  </Card>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    </Show>
  );
}
