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
 * through `Excerpt.marks`, the verse numbers painted from `Excerpt.verses` and
 * the verses either side dimmed through `Excerpt.focus`. All three are
 * computed in `src/core/excerpts`, so this component does no offset arithmetic
 * of its own; it slices a string at the boundaries it was given.
 *
 * ## The two modes
 *
 * The shell's mode is a choice about what USFM IS on screen, and a results
 * list is no exception: in USFM mode the card shows `Excerpt.source` — the raw
 * slice, markers and all, mono on the editor's terminal ground — and the
 * satellite behind Edit opens in the same mode. That path needs no projection
 * and no coordinate mapping: a hit's offsets are source offsets, and the body
 * is the source, so the highlight is `hit.from - span.from` and nothing else.
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
import { Button, Card, cx, IconButton } from "../primitives";
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
  /**
   * The SOURCE offset of the match the find bar's cursor is on, when it is one
   * of THIS excerpt's. That one highlight is painted stronger and the card
   * takes a ring, so "3 of 62" names something the reader can see; the other
   * matches keep the soft highlight they have when nothing is current.
   */
  readonly active?: number;
  /** The shell's mode. `usfm` shows the markup; anything else, the reading. */
  readonly mode?: "regular" | "usfm";
  /**
   * Replaces the reference in the header. Findings need it: an excerpt built
   * from a span before the first verse anchor labels itself "Genesis 0", and
   * the page that groups those under "Front matter" can say so properly.
   */
  readonly label?: JSX.Element;
  /**
   * A block between the header and the reading. Findings put one line per
   * finding in this verse there — the severity, the code, the message, and the
   * two things that can be done about it.
   */
  readonly notes?: JSX.Element;
  /**
   * What a highlight MEANS, by the source offset of the occurrence it came
   * from (`Mark.source`). Find has one kind of hit and needs none of this; a
   * findings list marks an error and a warning differently, and the colour is
   * the only thing in the body that says which is which.
   */
  readonly markTone?: (source: number | undefined, excerpt: Excerpt) => MarkTone | undefined;
}

/**
 * The three ways a mark can read. They are the semantic severity surfaces —
 * `surface-highlight` is deliberately not among them, because a highlight is a
 * place in the text and a severity is a judgement about it (tokens.css).
 */
export type MarkTone = "error" | "warning" | "info";

/** A tone as the pair it wears. Literal strings: Tailwind scans source text. */
const TONE: Readonly<Record<MarkTone, string>> = {
  error: "rounded-xs bg-surface-error px-px font-medium text-on-surface-error",
  warning: "rounded-xs bg-surface-warning px-px font-medium text-on-surface-warning",
  info: "rounded-xs bg-surface-tertiary px-px text-on-surface-secondary",
};

interface Segment {
  readonly text: string;
  readonly hit: boolean;
  /** Is this the match the find bar's cursor is on? */
  readonly current: boolean;
  readonly dim: boolean;
  /** A verse number to paint before this segment — `Excerpt.verses`. */
  readonly verse?: string;
  /** USFM mode only: is this segment a marker rather than text? */
  readonly marker?: boolean;
  /** What the mark covering this segment means, when the caller says. */
  readonly tone?: MarkTone;
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
const segmentsOf = (
  excerpt: Excerpt,
  active: number | undefined,
  markTone: ExcerptCardProps["markTone"],
): readonly Segment[] => {
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
    const covering = excerpt.marks.filter((mark) => mark.from <= from && mark.to >= to);
    const tone = covering.length === 0 ? undefined : markTone?.(covering[0]?.source, excerpt);
    out.push({
      text: excerpt.text.slice(from, to),
      hit: covering.length > 0,
      current: active !== undefined && covering.some((mark) => mark.source === active),
      dim: excerpt.focus !== null && (to <= excerpt.focus.from || from >= excerpt.focus.to),
      ...(verse === undefined ? {} : { verse: verse.label }),
      ...(tone === undefined ? {} : { tone }),
    });
  }
  return out;
};

/** A USFM marker: what the editor paints as `.cm-usfm-marker`. */
const MARKER = /\\\+?[a-zA-Z][a-zA-Z0-9-]*\*?/g;

/**
 * The raw slice, cut at every marker and every hit.
 *
 * The arithmetic here is a subtraction, not a mapping: `Excerpt.source` is the
 * text of `Excerpt.span`, and a hit is already in source coordinates, so a
 * highlight is `hit.from - span.from`. The projection is not involved at all,
 * which is the point of showing the source.
 */
const usfmSegmentsOf = (
  excerpt: Excerpt,
  active: number | undefined,
  markTone: ExcerptCardProps["markTone"],
): readonly Segment[] => {
  const base = excerpt.span.from;
  const length = excerpt.source.length;
  const ranges = excerpt.hits.flatMap((hit) =>
    (hit.pieces !== undefined && hit.pieces.length > 1 ? hit.pieces : [hit]).map((piece) => ({
      from: Math.max(0, Math.min(length, piece.from - base)),
      to: Math.max(0, Math.min(length, piece.to - base)),
      source: hit.from,
    })),
  );
  const markers: { from: number; to: number }[] = [];
  MARKER.lastIndex = 0;
  for (let found = MARKER.exec(excerpt.source); found !== null; found = MARKER.exec(excerpt.source))
    markers.push({ from: found.index, to: found.index + found[0].length });

  const cuts = new Set<number>([0, length]);
  for (const range of [...ranges, ...markers]) {
    cuts.add(range.from);
    cuts.add(range.to);
  }
  const bounds = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let index = 0; index + 1 < bounds.length; index += 1) {
    // SAFETY: `index` and `index + 1` are both inside a list of this length.
    const from = bounds[index]!;
    const to = bounds[index + 1]!;
    if (to <= from) continue;
    const covering = ranges.filter((range) => range.from <= from && range.to >= to);
    const tone = covering.length === 0 ? undefined : markTone?.(covering[0]?.source, excerpt);
    out.push({
      text: excerpt.source.slice(from, to),
      hit: covering.length > 0,
      current: active !== undefined && covering.some((range) => range.source === active),
      dim: false,
      marker: markers.some((range) => range.from <= from && range.to >= to),
      ...(tone === undefined ? {} : { tone }),
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

/**
 * One segment's look. A TONED mark wins over the plain highlight — a finding's
 * span is not a search hit — and the cursor's ring is added to whichever of the
 * two it lands on, so "this is the current one" and "this is an error" are two
 * facts a reader can read at once.
 */
const classOf = (segment: Segment): string | undefined => {
  if (segment.tone !== undefined)
    return cx(TONE[segment.tone], segment.current && "ring-1 ring-brand");
  if (segment.current) return "rounded-xs bg-brand-light font-medium text-brand ring-1 ring-brand";
  if (segment.hit) return "rounded-xs bg-surface-highlight text-on-surface-highlight";
  if (segment.marker) return "font-semibold text-[#38bdf8]";
  if (segment.dim) return "text-on-surface-tertiary";
  return undefined;
};

export function ExcerptCard(props: ExcerptCardProps) {
  const [book, setBook] = createSignal<EditorBook | undefined>(undefined, {
    name: "excerptBook",
  });
  // Pressed the moment the click lands, not when the route answers: opening a
  // big book takes long enough to look like nothing happened, and the button
  // is the only thing on screen that can say otherwise.
  const [opening, setOpening] = createSignal(false, { name: "excerptOpening" });
  const [refused, setRefused] = createSignal(false, { name: "excerptRefused" });
  const usfm = (): boolean => props.mode === "usfm";
  const segments = createMemo(
    () =>
      usfm()
        ? usfmSegmentsOf(props.excerpt, props.active, props.markTone)
        : segmentsOf(props.excerpt, props.active, props.markTone),
    { name: "excerptSegments" },
  );
  /** Does the current match live here? Drives the card's ring. */
  const current = (): boolean =>
    props.active !== undefined && props.excerpt.hits.some((hit) => hit.from === props.active);

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
    <Card
      padded={false}
      data-sid={props.excerpt.sid}
      data-current={current() ? "true" : undefined}
      data-mode={usfm() ? "usfm" : "regular"}
      class={cx("overflow-hidden", current() && "ring-1 ring-brand")}
    >
      <header class="flex items-center gap-2 border-b border-surface-border px-3 py-1.5">
        <strong class="text-small font-medium text-on-surface-primary">
          {props.label ?? props.excerpt.label}
        </strong>
        {/* Not when the card carries notes: findings list themselves line by
            line under this header, and "2 matches" above them would be the
            same count said twice in another vocabulary. */}
        <Show when={props.notes === undefined && props.excerpt.hits.length > 1}>
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

      <Show when={props.notes}>
        <div data-excerpt-notes class="border-b border-surface-border px-3 py-1.5">
          {props.notes}
        </div>
      </Show>

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
          <p
            class={cx(
              "px-3 py-2",
              usfm()
                ? // The editor's USFM surface, in a card: the same terminal
                  // ground and the same mono, so switching mode changes what
                  // the text IS rather than only where it is shown.
                  "whitespace-pre-wrap bg-[#0c0a09] font-mono text-small leading-relaxed text-[#d6d3d1]"
                : "font-scripture text-body leading-relaxed text-on-surface-primary",
            )}
          >
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
                    class={classOf(segment)}
                    data-hit={segment.hit ? "true" : undefined}
                    data-current={segment.current ? "true" : undefined}
                    data-marker={segment.marker ? "true" : undefined}
                    data-tone={segment.tone}
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
              mode={props.mode ?? "regular"}
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
