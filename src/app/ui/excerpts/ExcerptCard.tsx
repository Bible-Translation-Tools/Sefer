/**
 * One excerpt in the multibuffer: a reference, the reading, and a way in.
 *
 * Read-only is the DEFAULT and the whole point (design-direction.md, "Find"):
 * a results list is a place to look, not a place to edit by accident, and
 * plain text is what makes a list of two hundred of them cheap to scroll.
 * Edit is a click, and it swaps this one body for a satellite over the
 * canonical Book.
 *
 * The body is `Excerpt.text` — the projection, with the match highlighted
 * through `Excerpt.marks` and the verses either side dimmed through
 * `Excerpt.focus`. Both are computed in `src/core/excerpts`, so this component
 * does no offset arithmetic of its own; it slices a string at the boundaries
 * it was given.
 */

import type { JSX } from "@solidjs/web";
import ChevronsDownIcon from "lucide-solid/icons/chevrons-down";
import ChevronsUpIcon from "lucide-solid/icons/chevrons-up";
import PencilIcon from "lucide-solid/icons/pencil";
import SquareArrowOutUpRightIcon from "lucide-solid/icons/square-arrow-out-up-right";
import { For, Show, createMemo, createSignal } from "solid-js";

import type { Excerpt } from "../../../core/excerpts/excerpts";
import type { Analysis } from "../../../core/galley";
import type { EditorBook } from "../../../editor";
import { t } from "../../i18n";
import { Button, Card, IconButton } from "../primitives";
import { ExcerptEditor } from "./ExcerptEditor";

export interface ExcerptCardProps {
  readonly excerpt: Excerpt;
  /** Is this the one live editor? At most one excerpt is, by construction. */
  readonly editing: boolean;
  readonly onEdit: () => void;
  readonly onDone: () => void;
  readonly onOpen: () => void;
  /**
   * Plain → Instantiated for this book, on demand. Editing needs the
   * editor-backed Book, and a results list must not seat every book it lists.
   */
  readonly seat: () => Promise<EditorBook | undefined>;
  readonly analyze: (text: string) => Analysis;
  /** STET's source verse, rendered above the editable target. */
  readonly pair?: JSX.Element;
  /**
   * Show one more verse above (-1) or below (+1). Absent means the feed does
   * not offer expanding, and the chevrons are not drawn.
   */
  readonly onExpand?: (direction: -1 | 1) => void;
}

interface Segment {
  readonly text: string;
  readonly hit: boolean;
  readonly dim: boolean;
  /** A verse number to paint before this segment — `Excerpt.verses`. */
  readonly verse?: string;
}

/**
 * The excerpt's text cut at every boundary the model named, so one pass of
 * `<For>` renders highlight, context and verse numbers without nesting or
 * overlap logic.
 *
 * A verse number is not a slice of the text — it is markup the projection
 * dropped — so it rides on the segment that STARTS at its offset, and the cut
 * it adds is what guarantees there is one.
 */
const segmentsOf = (excerpt: Excerpt): readonly Segment[] => {
  const cuts = new Set<number>([0, excerpt.text.length]);
  for (const mark of excerpt.marks) {
    cuts.add(mark.from);
    cuts.add(mark.to);
  }
  for (const verse of excerpt.verses) cuts.add(verse.at);
  if (excerpt.focus !== null) {
    cuts.add(excerpt.focus.from);
    cuts.add(excerpt.focus.to);
  }
  const bounds = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let index = 0; index + 1 < bounds.length; index += 1) {
    // SAFETY: `index` and `index + 1` are both inside a list of this length.
    const from = bounds[index]!;
    const to = bounds[index + 1]!;
    if (to <= from) continue;
    const verse = excerpt.verses.find((mark) => mark.at === from);
    out.push({
      text: excerpt.text.slice(from, to),
      hit: excerpt.marks.some((mark) => mark.from <= from && mark.to >= to),
      dim: excerpt.focus !== null && (to <= excerpt.focus.from || from >= excerpt.focus.to),
      ...(verse === undefined ? {} : { verse: verse.label }),
    });
  }
  return out;
};

/** The editor's `.usfm-verse`, in the card's vocabulary. */
const VERSE = "align-super font-sans text-[0.66em] font-bold text-brand select-none";

/**
 * The strip a reader clicks for one more verse — Zed's multibuffer handles,
 * as a full-width hairline rather than a floating control: it is the edge of
 * the excerpt, and the edge is what is being moved.
 */
const expander =
  "flex w-full cursor-pointer items-center justify-center py-0.5 text-on-surface-tertiary transition-colors hover:bg-surface-secondary hover:text-on-surface-secondary";

export function ExcerptCard(props: ExcerptCardProps) {
  const [book, setBook] = createSignal<EditorBook | undefined>(undefined, {
    name: "excerptBook",
  });
  // Pressed the moment the click lands, not when the route answers: opening a
  // big book takes long enough to look like nothing happened, and the button
  // is the only thing on screen that can say otherwise.
  const [opening, setOpening] = createSignal(false, { name: "excerptOpening" });
  const [refused, setRefused] = createSignal(false, { name: "excerptRefused" });
  const segments = createMemo(() => segmentsOf(props.excerpt), { name: "excerptSegments" });

  const edit = (): void => {
    props.onEdit();
    void props.seat().then((seated) => {
      setBook(seated);
      setRefused(seated === undefined);
    });
  };

  const done = (): void => {
    setBook(undefined);
    props.onDone();
  };

  return (
    <Card padded={false} data-sid={props.excerpt.sid} class="overflow-hidden">
      <header class="flex items-center gap-2 border-b border-surface-border px-3 py-1.5">
        <strong class="text-small font-medium text-on-surface-primary">
          {props.excerpt.label}
        </strong>
        <Show when={props.excerpt.hits.length > 1}>
          <span class="text-smallest text-on-surface-tertiary">
            {t("{count} matches", { count: props.excerpt.hits.length })}
          </span>
        </Show>
        <div class="ms-auto flex items-center gap-1">
          <Show
            when={props.editing}
            fallback={
              <Button size="sm" variant="secondary" icon={<PencilIcon size={13} />} onClick={edit}>
                {t("Edit")}
              </Button>
            }
          >
            <Button size="sm" variant="primary" onClick={done}>
              {t("Done")}
            </Button>
          </Show>
          <IconButton
            size="sm"
            label={t("Open in editor")}
            icon={<SquareArrowOutUpRightIcon size={14} />}
            aria-pressed={opening() ? "true" : undefined}
            onClick={() => {
              setOpening(true);
              props.onOpen();
              // The card may still be here — the same book, already focused —
              // so the pressed state is released rather than left on.
              setTimeout(() => setOpening(false), 600);
            }}
          />
        </div>
      </header>

      <Show when={props.onExpand !== undefined && props.excerpt.more.up}>
        <button
          type="button"
          data-expand="up"
          aria-label={t("Show the verse above")}
          class={expander}
          onClick={() => props.onExpand?.(-1)}
        >
          <ChevronsUpIcon size={12} aria-hidden="true" />
        </button>
      </Show>

      <Show when={props.pair}>
        <div class="border-b border-surface-border bg-surface-secondary px-3 py-2">
          {props.pair}
        </div>
      </Show>

      <Show
        when={props.editing}
        fallback={
          <p class="px-3 py-2 font-scripture text-body leading-relaxed text-on-surface-primary">
            <For each={segments()}>
              {(segment) => (
                <>
                  <Show when={segment.verse}>
                    {(label) => (
                      <span class={VERSE} data-verse={label()}>
                        {label()}
                        {"\u2009"}
                      </span>
                    )}
                  </Show>
                  <span
                    class={
                      segment.hit
                        ? "rounded-xs bg-surface-highlight text-on-surface-highlight"
                        : segment.dim
                          ? "text-on-surface-tertiary"
                          : undefined
                    }
                    data-hit={segment.hit ? "true" : undefined}
                  >
                    {segment.text}
                  </span>
                </>
              )}
            </For>
          </p>
        }
      >
        <Show
          when={book()}
          fallback={
            <p class="px-3 py-2 text-small text-on-surface-tertiary">
              {refused() ? t("That book could not be opened for editing.") : t("Opening…")}
            </p>
          }
        >
          {(seated) => (
            <ExcerptEditor
              book={seated()}
              excerpt={props.excerpt}
              analyze={props.analyze}
              onDone={done}
            />
          )}
        </Show>
      </Show>

      <Show when={props.onExpand !== undefined && props.excerpt.more.down}>
        <button
          type="button"
          data-expand="down"
          aria-label={t("Show the verse below")}
          class={`${expander} border-t border-surface-border`}
          onClick={() => props.onExpand?.(1)}
        >
          <ChevronsDownIcon size={12} aria-hidden="true" />
        </button>
      </Show>
    </Card>
  );
}
