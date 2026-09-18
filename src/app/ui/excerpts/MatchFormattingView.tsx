/**
 * Match formatting: the source's block structure beside the target's, and one
 * button that makes the second the first.
 *
 * The job is the reverse of drafting. The words are already right; what has to
 * cross is the SHAPE — where the paragraphs break, which lines are poetry, how
 * far each is indented — from a source the translator worked from to a target
 * that came back as one undifferentiated run.
 *
 * ## Two columns, one address
 *
 * The two texts have different words and different lengths, so nothing about
 * them can be matched by offset. What they share is a BLOCK ADDRESS —
 * `(sid, where, ordinal)`: which verse, whether the block leads the verse or
 * sits inside it, and which one of those it is. Moving through the target
 * therefore highlights the source's block at the same address and vice versa,
 * and the MARKER is deliberately not part of the match: a `\q1` here against a
 * `\q2` there is precisely the difference the reader opened this view to see,
 * and matching on the name would hide it by never pairing them.
 *
 * ## What the transaction does, said before it is applied
 *
 * `overlayReport` is not decoration. Three of its four lists change what a
 * reader should expect:
 *
 *  - **inserted, empty.** A block the source has INSIDE a verse arrives with no
 *    words, because where a verse's text splits is unknowable across languages.
 *    The file gets an empty block and the translator moves the line into it.
 *    Nothing is invented, and the view says so rather than letting it look like
 *    a failed transfer.
 *  - **removed.** A block the target has and the source does not is taken out,
 *    and its text joins the block above it. No words are lost; the shape is.
 *  - **unpaired.** A verse with no counterpart — absent, bridged, ambiguous —
 *    is left alone entirely.
 *
 * So Apply asks first, and the dialog names the CHAPTERS rather than counting
 * the edits: "this will change 14 places" is not a sentence anyone can act on.
 *
 * The apply itself is one `book.apply(…, 'format')`: one revision, one receipt,
 * ONE Undo step. An overlay a reader regrets is one keystroke away from gone,
 * which is the only reason it is safe to offer at all.
 */

import ArrowLeftRightIcon from "lucide-solid/icons/arrow-left-right";
import { For, Show, createMemo, createSignal } from "solid-js";

import type { Skeleton, SkeletonRow } from "../../../core/galley";
import { t } from "../../i18n";
import type { MatchFormatting } from "../../workflows/stet";
import { Badge, Button, Card, Dialog, EmptyState, Select, cx } from "../primitives";

/**
 * The address three things are matched on. The marker is not one of them.
 *
 * NUL separates the parts, written as `\0` rather than as the byte itself:
 * nothing in a sid can collide with it, and the source stays text. A file
 * carrying a raw NUL is binary to `grep` and `file`, which is a trap.
 */
const keyOf = (row: { sid: string; where: string; ordinal: number }): string =>
  `${row.sid}\0${row.where}\0${row.ordinal}`;

/**
 * One block as a line: its marker, and the text the block covers.
 *
 * The span is the marker NODE's, which for a paragraph is the marker plus the
 * text under it — so slicing the document at it is the line a reader sees. A
 * block the engine reports as `empty` has no words by construction and is
 * labelled rather than rendered as a blank row, because a blank row reads as a
 * rendering bug.
 */
function BlockRow(props: {
  readonly row: SkeletonRow;
  readonly text: string;
  readonly active: boolean;
  readonly paired: boolean;
  readonly onSelect?: () => void;
}) {
  const body = (): string => props.text.slice(props.row.from, props.row.to).trim();
  return (
    <button
      type="button"
      onClick={() => props.onSelect?.()}
      data-block={keyOf(props.row)}
      data-active={props.active ? "true" : undefined}
      class={cx(
        "flex w-full flex-col gap-0.5 rounded-md border-s-2 px-2.5 py-1 text-start transition-colors",
        props.onSelect === undefined ? "cursor-default" : "cursor-pointer",
        props.active
          ? "border-brand bg-brand-light"
          : props.paired
            ? "border-surface-border hover:bg-surface-secondary"
            : "border-warning bg-surface-secondary",
      )}
    >
      <span class="flex items-center gap-1.5">
        <code class="text-smallest font-semibold text-on-surface-tertiary">
          \{props.row.marker}
        </code>
        <span class="text-smallest tabular-nums text-on-surface-tertiary">{props.row.sid}</span>
        <Show when={props.row.where === "inside"}>
          <Badge tone="muted" size="sm">
            {t("inside")}
          </Badge>
        </Show>
        <Show when={!props.paired}>
          <Badge tone="warning" size="sm">
            {t("no pair")}
          </Badge>
        </Show>
      </span>
      <Show
        when={body() !== ""}
        fallback={
          <span class="text-smallest text-on-surface-tertiary italic">
            {t("(empty block — the line goes here)")}
          </span>
        }
      >
        <span class="text-small break-words text-on-surface-primary">{body()}</span>
      </Show>
    </button>
  );
}

function Column(props: {
  readonly title: string;
  readonly subtitle: string;
  readonly skeleton: Skeleton;
  readonly text: string;
  readonly otherKeys: ReadonlySet<string>;
  readonly active: string | undefined;
  readonly onSelect?: (row: SkeletonRow) => void;
}) {
  return (
    <div class="flex min-h-0 min-w-0 flex-col gap-1">
      <div class="flex items-baseline gap-2">
        <p class="text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase">
          {props.title}
        </p>
        <p class="truncate text-smallest text-on-surface-tertiary">{props.subtitle}</p>
      </div>
      <div class="min-h-0 flex-1 overflow-auto">
        <Show
          when={props.skeleton.blocks.length > 0}
          fallback={
            <p class="px-2.5 py-1 text-smallest text-on-surface-tertiary italic">
              {t("No block markers in this text.")}
            </p>
          }
        >
          <ul class="flex flex-col gap-0.5">
            <For each={props.skeleton.blocks}>
              {(row) => (
                <li>
                  <BlockRow
                    row={row}
                    text={props.text}
                    active={props.active === keyOf(row)}
                    paired={props.otherKeys.has(keyOf(row))}
                    {...(props.onSelect === undefined
                      ? {}
                      : { onSelect: () => props.onSelect?.(row) })}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  );
}

export interface MatchFormattingViewProps {
  /** Both skeletons and the transaction — `workflows/stet.ts`'s `matchFormatting`. */
  readonly found: MatchFormatting | undefined;
  readonly targetText: string;
  readonly sourceText: string;
  readonly targetLabel: string;
  readonly sourceLabel: string;
  /** Chapters the transaction touches, for the confirm dialog. */
  readonly chapters: readonly number[];
  /**
   * How much of the book the overlay is being asked for: one chapter's number,
   * or the whole book.
   *
   * A control and not a derived fact, because an overlay leaves empty blocks
   * on purpose and the reader decides how many of those they want to fill in
   * one sitting.
   */
  readonly scope: number | "book";
  /** Every chapter this book has, for the picker. */
  readonly scopeChapters: readonly number[];
  readonly onScope: (scope: number | "book") => void;
  /** Off when there is no project book to write to. */
  readonly appliable: boolean;
  readonly onApply: () => void;
  /** Said instead of the columns when there is nothing to compare. */
  readonly empty?: string;
}

export function MatchFormattingView(props: MatchFormattingViewProps) {
  const [active, setActive] = createSignal<string | undefined>(undefined, {
    name: "matchFormattingBlock",
  });
  const [confirming, setConfirming] = createSignal(false, { name: "matchFormattingConfirm" });

  const sourceKeys = createMemo(() => new Set((props.found?.source.blocks ?? []).map(keyOf)), {
    name: "matchFormattingSourceKeys",
  });
  const targetKeys = createMemo(() => new Set((props.found?.target.blocks ?? []).map(keyOf)), {
    name: "matchFormattingTargetKeys",
  });

  const report = () => props.found?.overlay.report;
  const edits = (): number => props.found?.overlay.edits.length ?? 0;
  const emptyInserts = (): number => (report()?.inserted ?? []).filter((one) => one.empty).length;

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3">
      <Show
        when={props.found}
        fallback={
          <Card>
            <EmptyState
              icon={<ArrowLeftRightIcon size={22} />}
              title={t("Nothing to match")}
              description={props.empty ?? t("Open a book and bind a source resource.")}
            />
          </Card>
        }
      >
        {(found) => (
          <>
            <Card class="flex flex-wrap items-center gap-2" data-match-summary>
              <Badge tone={edits() === 0 ? "muted" : "brand"} data-match-edits={edits()}>
                {edits() === 0 ? t("Already matching") : t("{count} change(s)", { count: edits() })}
              </Badge>
              <Show when={emptyInserts() > 0}>
                <Badge tone="warning" data-match-empty={emptyInserts()}>
                  {t("{count} empty block(s) to fill", { count: emptyInserts() })}
                </Badge>
              </Show>
              <Show when={(report()?.removed.length ?? 0) > 0}>
                <Badge tone="muted">
                  {t("{count} removed", { count: report()?.removed.length ?? 0 })}
                </Badge>
              </Show>
              <Show when={(report()?.unpaired.length ?? 0) > 0}>
                <Badge tone="muted">
                  {t("{count} verse(s) with no pair", {
                    count: report()?.unpaired.length ?? 0,
                  })}
                </Badge>
              </Show>
              {/* The scope, beside the counts it changes: narrowing the
                  overlay changes every badge on this row, so the control
                  belongs with them rather than in a toolbar above. */}
              <label class="flex items-center gap-1.5 text-smallest text-on-surface-secondary">
                {t("Match")}
                <Select
                  size="sm"
                  wrapperClass="w-36"
                  data-testid="match-scope"
                  value={props.scope === "book" ? "book" : String(props.scope)}
                  onChange={(event) =>
                    props.onScope(
                      event.currentTarget.value === "book"
                        ? "book"
                        : Number(event.currentTarget.value),
                    )
                  }
                >
                  <option value="book">{t("the whole book")}</option>
                  <For each={props.scopeChapters}>
                    {(chapter) => (
                      <option value={String(chapter)}>{t("chapter {chapter}", { chapter })}</option>
                    )}
                  </For>
                </Select>
              </label>

              <div class="ms-auto">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!props.appliable || edits() === 0}
                  onClick={() => setConfirming(true)}
                  data-match-apply
                >
                  {t("Apply overlay")}
                </Button>
              </div>
            </Card>

            <div class="grid min-h-0 flex-1 gap-3 sm:grid-cols-2">
              <Column
                title={t("Source")}
                subtitle={props.sourceLabel}
                skeleton={found().source}
                text={props.sourceText}
                otherKeys={targetKeys()}
                active={active()}
                onSelect={(row) => setActive(keyOf(row))}
              />
              <Column
                title={t("This project")}
                subtitle={props.targetLabel}
                skeleton={found().target}
                text={props.targetText}
                otherKeys={sourceKeys()}
                active={active()}
                onSelect={(row) => setActive(keyOf(row))}
              />
            </div>
          </>
        )}
      </Show>

      <Dialog
        open={confirming()}
        onOpenChange={setConfirming}
        title={t("Match the source's formatting?")}
      >
        <div class="flex flex-col gap-3">
          <p class="text-small text-on-surface-secondary">
            {props.chapters.length === 0
              ? t("This will change {book}.", { book: props.targetLabel })
              : t("This will change {book}, chapters {chapters}.", {
                  book: props.targetLabel,
                  chapters: props.chapters.join(", "),
                })}
          </p>
          <Show when={emptyInserts() > 0}>
            <p class="text-small text-on-surface-secondary">
              {t(
                "{count} of them are empty blocks: the marker is added and the line is yours to move into it. No words are written.",
                { count: emptyInserts() },
              )}
            </p>
          </Show>
          <p class="text-smallest text-on-surface-tertiary">
            {t("One undo step takes all of it back.")}
          </p>
          <div class="flex justify-end gap-2">
            <Button variant="tertiary" size="sm" onClick={() => setConfirming(false)}>
              {t("Cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              data-match-confirm
              onClick={() => {
                setConfirming(false);
                props.onApply();
              }}
            >
              {t("Apply overlay")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
