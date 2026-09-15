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
 */

import { For, Show } from "solid-js";

import type { BookComparison, CompareHunk, Decision, Decisions } from "../../../core/compare";
import { decisionFor, wholeBookHunkId } from "../../../core/compare";
import { t } from "../../i18n";
import { Badge, Button, Card, EmptyState, cx } from "../primitives";

/** Rows shown per side before the block says how many it kept back. */
const MAX_LINES = 20;

const LINE = "flex gap-2 px-2.5 py-px font-mono text-smallest whitespace-pre-wrap";

const KIND_LABEL: Record<CompareHunk["kind"], string> = {
  insert: "added on the right",
  delete: "missing on the right",
  replace: "changed",
};

/** The lines of a slice, without the empty tail a trailing newline leaves. */
const lines = (text: string): readonly string[] => {
  const all = text.split("\n");
  return all.length > 1 && all[all.length - 1] === "" ? all.slice(0, -1) : all;
};

function Side(props: {
  readonly text: string;
  readonly tone: "left" | "right";
  readonly dimmed: boolean;
}) {
  const all = () => lines(props.text);
  const shown = () => all().slice(0, MAX_LINES);
  return (
    <div class={cx("min-w-0", props.dimmed && "opacity-40")}>
      <Show
        when={props.text !== ""}
        fallback={
          <p class="px-2.5 py-1 text-smallest italic text-on-surface-tertiary">
            {t("Nothing on this side")}
          </p>
        }
      >
        <For each={shown()}>
          {(line, index) => (
            <div
              class={cx(
                LINE,
                props.tone === "right"
                  ? "bg-surface-success text-on-surface-success"
                  : "bg-surface-error text-on-surface-error",
              )}
            >
              <span aria-hidden="true" class="select-none opacity-70">
                {props.tone === "right" ? "+" : "−"}
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
      </Show>
    </div>
  );
}

interface ChoiceProps {
  readonly decision: Decision;
  readonly leftLabel: string;
  readonly rightLabel: string;
  readonly leftDisabled?: boolean;
  readonly rightDisabled?: boolean;
  readonly onChoose: (decision: Decision) => void;
}

/** Keep left / Take right, with a click on the chosen one clearing it. */
function Choice(props: ChoiceProps) {
  const choose = (side: Decision) => () =>
    props.onChoose(props.decision === side ? "undecided" : side);
  return (
    <div class="ms-auto flex shrink-0 items-center gap-1">
      <Button
        size="sm"
        variant={props.decision === "left" ? "primary" : "tertiary"}
        aria-pressed={props.decision === "left" ? "true" : "false"}
        disabled={props.leftDisabled === true}
        onClick={choose("left")}
      >
        {props.leftLabel}
      </Button>
      <Button
        size="sm"
        variant={props.decision === "right" ? "primary" : "tertiary"}
        aria-pressed={props.decision === "right" ? "true" : "false"}
        disabled={props.rightDisabled === true}
        onClick={choose("right")}
      >
        {props.rightLabel}
      </Button>
    </div>
  );
}

export interface BookReviewProps {
  readonly book: BookComparison;
  readonly decisions: Decisions;
  readonly leftLabel: string;
  readonly rightLabel: string;
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
            <Badge tone={props.book.presence === "left" ? "warning" : "success"}>
              {props.book.presence === "left" ? t("only here") : t("only there")}
            </Badge>
            <span class="text-smallest text-on-surface-tertiary">
              {props.book.presence === "left"
                ? t("{book} is in {left} and not in {right}.", {
                    book: props.book.bookId,
                    left: props.leftLabel,
                    right: props.rightLabel,
                  })
                : t("{book} is in {right} and not in {left}.", {
                    book: props.book.bookId,
                    left: props.leftLabel,
                    right: props.rightLabel,
                  })}
            </span>
            <Choice
              decision={decisionFor(props.decisions, wholeBook())}
              leftLabel={props.book.presence === "left" ? t("Keep it") : t("Leave it out")}
              rightLabel={props.book.presence === "left" ? t("Drop it") : t("Bring it in")}
              rightDisabled={props.cannotAdd}
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
              tone={props.book.presence === "left" ? "left" : "right"}
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
                            ? "success"
                            : hunk.kind === "delete"
                              ? "error"
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
                        leftLabel={t("Keep left")}
                        rightLabel={t("Take right")}
                        onChoose={(next) => props.onDecide(hunk.id, next)}
                      />
                    </div>
                    <div class="max-h-96 overflow-auto">
                      <Side text={hunk.left} tone="left" dimmed={decision() === "right"} />
                      <Side text={hunk.right} tone="right" dimmed={decision() === "left"} />
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
