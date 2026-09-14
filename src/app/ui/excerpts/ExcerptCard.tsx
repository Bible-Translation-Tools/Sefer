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
}

interface Segment {
  readonly text: string;
  readonly hit: boolean;
  readonly dim: boolean;
}

/**
 * The excerpt's text cut at every boundary the model named, so one pass of
 * `<For>` renders highlight and context without nesting or overlap logic.
 */
const segmentsOf = (excerpt: Excerpt): readonly Segment[] => {
  const cuts = new Set<number>([0, excerpt.text.length]);
  for (const mark of excerpt.marks) {
    cuts.add(mark.from);
    cuts.add(mark.to);
  }
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
    out.push({
      text: excerpt.text.slice(from, to),
      hit: excerpt.marks.some((mark) => mark.from <= from && mark.to >= to),
      dim: excerpt.focus !== null && (to <= excerpt.focus.from || from >= excerpt.focus.to),
    });
  }
  return out;
};

export function ExcerptCard(props: ExcerptCardProps) {
  const [book, setBook] = createSignal<EditorBook | undefined>(undefined, {
    name: "excerptBook",
  });
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
            onClick={() => props.onOpen()}
          />
        </div>
      </header>

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
    </Card>
  );
}
