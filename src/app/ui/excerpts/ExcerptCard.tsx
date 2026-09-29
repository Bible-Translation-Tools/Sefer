/**
 * One excerpt in the multibuffer: a small piece of a book, read as the editor
 * reads it, and a way in.
 *
 * Every list of places in Sefer is a list of these — Find, Key terms,
 * Findings — and it is one compound component built from three primitives:
 * an Address (where), the clip (how much of the book this card is), and the
 * TOC (what "more" means). Anything a screen needs that those cannot express is
 * a missing primitive, not a special case here
 * (`planning/00-ideas/excerpt-compound-component.md`).
 *
 * ## The parts
 *
 *  - **Header.** The place the match is — one small title row, never the
 *    book's name set into the text, which the editor does not do either.
 *  - **Body.** The TARGET: `ExcerptReader`, the editor's reading of the range,
 *    read-only. Double-click or Edit swaps it for `ExcerptEditor`, a satellite
 *    over the same range whose edits go through the Book's funnel. Regular or
 *    USFM follows the shell, as in the editor.
 *  - **Paired resource.** Optional: another text of the same place, never
 *    editable. A parsed one (`kind: "text"`) is a reader too, locked to the
 *    target's range by Address; a frozen one (`kind: "static"`, a guide's
 *    reading) has no markup to show and no context to widen, so those two
 *    controls simply do not apply to it.
 *  - **Footer.** The context control — one TOC step up, the whole chapter,
 *    one step down — and the ACTIONS slot, which is the screen's: review
 *    progress for Key terms, a quick filter for proofreading.
 *
 * ## Width
 *
 * With room, the paired resource sits beside the target, locked to the same
 * range. Narrow, it stacks above, and collapses to the unit the match is in:
 * a whole chapter of somebody else's text above your own, stacked, is a page
 * of scrolling to reach the part you came to edit. Either default can be
 * flipped per card. The width is the CARD's (a ResizeObserver), not the
 * window's, because the same card lives in a full-width list and a side panel.
 */

import type { JSX } from "@solidjs/web";
import CodeIcon from "lucide-solid/icons/code";
import FoldVerticalIcon from "lucide-solid/icons/fold-vertical";
import SquareArrowOutUpRightIcon from "lucide-solid/icons/square-arrow-out-up-right";
import UnfoldVerticalIcon from "lucide-solid/icons/unfold-vertical";
import { Show, createEffect, createMemo, createSignal } from "solid-js";

import {
  pairedExcerpt,
  type BookText,
  type Excerpt,
  type Occurrence,
} from "#core/excerpts/excerpts";
import type { Analysis } from "#core/galley";
import type { EditorBook, Funnel, MarkedRange } from "#editor/index";

import { t } from "../../i18n";
import { CardEditor } from "../multibuffer/CardEditor";
import { CardFrame } from "../multibuffer/CardFrame";
import type { CardEvent, CardView, ContextStep } from "../multibuffer/cardState";
import { ContextControl } from "../multibuffer/ContextControl";
import { cx, IconButton } from "../primitives";
import { ExcerptReader } from "./ExcerptReader";

export type { ContextStep } from "../multibuffer/cardState";

/**
 * The text read beside the target.
 *
 *  - `text`: a parsed resource. Same reader, same mode, same context — locked
 *    to the target's range by Address. `hits` are ITS occurrences when the
 *    match is on this side (Find over a reference).
 *  - `static`: a frozen reading (a guide's). Shown as it was baked, with its
 *    own highlight offsets; no mode and no context, because there is no parse.
 *  - `none`: nothing to show for this place, and the words that say why.
 */
export type Paired =
  | {
      readonly kind: "text";
      readonly name: string;
      readonly book: BookText;
      readonly hits: readonly Occurrence[];
    }
  | {
      readonly kind: "static";
      readonly name: string;
      readonly text: string;
      readonly spans: readonly { readonly from: number; readonly to: number }[];
    }
  | { readonly kind: "none"; readonly name: string; readonly message: string };

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
  /** This book's seat while one is open, which the read-only view follows live. */
  readonly follow?: Funnel | undefined;
  readonly paired?: Paired | undefined;
  /** One context step. Absent means the feed does not offer widening. */
  readonly onExpand?: (step: ContextStep) => void;
  /**
   * The SOURCE offset of the match the find bar's cursor is on, when it is one
   * of THIS excerpt's. That one highlight is painted stronger and the card
   * takes a ring, so "3 of 62" names something the reader can see.
   */
  readonly active?: number;
  /** The shell's mode. `usfm` shows the markup; anything else, the reading. */
  readonly mode?: "regular" | "usfm";
  /** Replaces the reference in the header. */
  readonly label?: JSX.Element;
  /**
   * Set while the card is held on screen for editing though the results no
   * longer include it — the finding resolved, the term no longer matches.
   * What to call that is the screen's ("Resolved", "No longer matches").
   */
  readonly gone?: string | undefined;
  /** Beside the reference: what this place IS — Findings' severity, "in markup". */
  readonly badges?: JSX.Element;
  /** A block between the header and the text — Findings' one line per finding. */
  readonly notes?: JSX.Element;
  /** Whether the header offers "Open in editor". Absent is yes. */
  readonly openable?: boolean;
  /**
   * Offer this card's own switch to USFM — a code icon in the header — when
   * what it is about sits in markup, which the reading cannot show. Every card
   * can be switched; only a card that has a reason offers it.
   */
  readonly offerUsfm?: boolean;
  /**
   * The reader's view of this card — its USFM switch, its paired side's
   * width — held by the screen, so it outlives the row (`cardViews.ts`).
   */
  readonly view: CardView;
  readonly onView: (event: CardEvent) => void;
  /** The footer's slot: whatever this screen lets a reader do about this place. */
  readonly actions?: JSX.Element;
  /**
   * What a highlight MEANS, by the source offset of the occurrence it came
   * from. Find has one kind of hit and needs none of this; a findings list
   * marks an error and a warning differently.
   */
  readonly markTone?: (source: number | undefined, excerpt: Excerpt) => MarkTone | undefined;
  /**
   * The book's OTHER results inside this card's stretch — a match in the verse
   * before, a finding in the context. Painted like the card's own: the text
   * says the same thing wherever the card happens to begin.
   */
  readonly nearby?: readonly Occurrence[];
}

/**
 * The three ways a mark can read — the semantic severity surfaces, painted by
 * `editor.css`'s `.cm-excerpt-error` and its two siblings.
 */
export type MarkTone = "error" | "warning" | "info";

/** Wide enough for two texts side by side at a readable measure. */
const SIDE_BY_SIDE = 720;

/**
 * Everything the target view paints: each match (by meaning, and the current
 * one stronger), and the context either side of the own unit, dimmed — so the
 * reader sees which sentence the header names without a second reference.
 */
const marksOf = (
  excerpt: Excerpt,
  hits: readonly Occurrence[],
  active: number | undefined,
  markTone: ExcerptCardProps["markTone"],
): readonly MarkedRange[] => {
  const out: MarkedRange[] = [];
  const { span, own } = excerpt;
  if (own.from > span.from)
    out.push({ from: span.from, to: own.from, class: "cm-excerpt-context" });
  if (span.to > own.to) out.push({ from: own.to, to: span.to, class: "cm-excerpt-context" });
  for (const hit of hits) {
    const tone = markTone?.(hit.from, excerpt);
    const name = cx(
      tone === undefined ? "cm-excerpt-hit" : `cm-excerpt-${tone}`,
      active === hit.from && "cm-excerpt-current",
    );
    const pieces = hit.pieces !== undefined && hit.pieces.length > 1 ? hit.pieces : [hit];
    for (const piece of pieces) out.push({ from: piece.from, to: piece.to, class: name });
  }
  return out;
};

/** A frozen reading with its baked highlights. */
const highlighted = (
  text: string,
  spans: readonly { readonly from: number; readonly to: number }[],
): JSX.Element => {
  if (spans.length === 0) return text;
  const out: JSX.Element[] = [];
  let at = 0;
  for (const span of spans) {
    if (span.from > at) out.push(text.slice(at, span.from));
    out.push(
      <mark class="rounded-xs bg-surface-highlight text-on-surface-highlight">
        {text.slice(span.from, span.to)}
      </mark>,
    );
    at = span.to;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
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
  /** Where a double-click asked the caret to start. */
  const [at, setAt] = createSignal<number | undefined>(undefined, { name: "excerptCaret" });
  const [point, setPoint] = createSignal<{ x: number; y: number } | undefined>(undefined, {
    name: "excerptPoint",
  });
  const [body, setBody] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "excerptBody",
  });
  const [wide, setWide] = createSignal(true, { name: "excerptWide" });
  /** The reader's: this card alone in USFM, and the paired side's width flipped. */
  const usfm = (): boolean => props.view.usfm;
  const pairedFlip = (): boolean => props.view.pairedFlip;
  const mode = (): "regular" | "usfm" => (props.mode === "usfm" || usfm() ? "usfm" : "regular");

  createEffect(
    () => body(),
    (element) => {
      if (element === undefined) return;
      const observer = new ResizeObserver(([entry]) => {
        if (entry !== undefined) setWide(entry.contentRect.width >= SIDE_BY_SIDE);
      });
      observer.observe(element);
      return () => observer.disconnect();
    },
  );

  const marks = createMemo(
    () =>
      marksOf(
        props.excerpt,
        props.nearby === undefined || props.nearby.length === 0
          ? props.excerpt.hits
          : [...props.excerpt.hits, ...props.nearby],
        props.active,
        props.markTone,
      ),
    { name: "excerptMarks" },
  );

  /** Stacked, the paired side shows only its own unit — unless flipped. */
  const collapsed = (): boolean => (wide() ? pairedFlip() : !pairedFlip());

  const pairedView = createMemo(
    () => {
      const paired = props.paired;
      if (paired?.kind !== "text") return undefined;
      const excerpt = pairedExcerpt(paired.book, props.excerpt, paired.hits, collapsed());
      if (excerpt === undefined) return undefined;
      return { excerpt, marks: marksOf(excerpt, paired.hits, undefined, undefined) };
    },
    { name: "excerptPaired" },
  );

  /** Does the current match live here? Drives the card's ring. */
  const current = (): boolean =>
    props.active !== undefined && props.excerpt.hits.some((hit) => hit.from === props.active);

  const edit = (caret?: number, where?: { x: number; y: number }): void => {
    setAt(caret);
    setPoint(where);
    props.onEdit();
    void props.seat().then((seated) => {
      setBook(seated);
      setRefused(seated === undefined);
    });
  };

  const done = (): void => {
    setBook(undefined);
    setAt(undefined);
    props.onDone();
  };

  const target = (
    <Show
      when={props.editing}
      fallback={
        <ExcerptReader
          analysis={props.excerpt.analysis}
          span={props.excerpt.span}
          mode={mode()}
          marks={marks()}
          label={`excerpt:${props.excerpt.sid}`}
          follow={props.follow}
          onEdit={edit}
        />
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
          <CardEditor
            book={seated()}
            range={props.excerpt.span}
            mode={mode()}
            marks={marks()}
            at={at()}
            point={point()}
            select={props.excerpt.hits[0]}
            analyze={props.analyze}
            label={`excerpt:${props.excerpt.sid}`}
            onDone={done}
          />
        )}
      </Show>
    </Show>
  );

  const pairedText = () => (props.paired?.kind === "text" ? props.paired : undefined);
  const pairedStatic = () => (props.paired?.kind === "static" ? props.paired : undefined);
  const pairedNone = () => (props.paired?.kind === "none" ? props.paired : undefined);

  const pairedSide = (
    <section
      data-paired={props.paired?.kind}
      aria-label={props.paired?.name}
      class="min-w-0 rounded-md border border-surface-border bg-surface-secondary/60"
    >
      <header class="flex items-center gap-2 px-3 pt-1.5 text-smallest text-on-surface-tertiary">
        <span class="truncate" title={props.paired?.name}>
          {props.paired?.name}
        </span>
        <Show when={pairedView()}>
          <IconButton
            size="sm"
            class="ms-auto"
            label={collapsed() ? t("Show the same range") : t("Show only the match")}
            icon={collapsed() ? <UnfoldVerticalIcon size={13} /> : <FoldVerticalIcon size={13} />}
            aria-pressed={collapsed() ? "false" : "true"}
            onClick={() => props.onView({ kind: "pairedFlip" })}
          />
        </Show>
      </header>
      <Show when={pairedText()}>
        {(text) => (
          <Show
            when={pairedView()}
            fallback={
              <p class="px-3 py-2 text-small text-on-surface-tertiary italic">
                {t("{place} is not in {name}.", { place: props.excerpt.label, name: text().name })}
              </p>
            }
          >
            {(view) => (
              <ExcerptReader
                analysis={view().excerpt.analysis}
                span={view().excerpt.span}
                mode={mode()}
                marks={view().marks}
                label={`paired:${props.excerpt.sid}`}
              />
            )}
          </Show>
        )}
      </Show>
      <Show when={pairedStatic()}>
        {(reading) => (
          <p class="px-3 py-2 font-scripture text-body leading-relaxed text-on-surface-secondary">
            {highlighted(reading().text, reading().spans)}
          </p>
        )}
      </Show>
      <Show when={pairedNone()}>
        {(missing) => (
          <p class="px-3 py-2 text-small text-on-surface-tertiary italic">{missing().message}</p>
        )}
      </Show>
    </section>
  );

  return (
    <CardFrame
      data={{ "data-sid": props.excerpt.sid, "data-mode": mode() }}
      current={current()}
      label={props.label ?? props.excerpt.label}
      gone={props.gone}
      badges={
        // Not when the card carries notes: findings list themselves line by
        // line under the header, and "2 matches" above them would be the same
        // count said twice in another vocabulary.
        <>
          {props.badges}
          <Show when={props.offerUsfm === true && props.mode !== "usfm"}>
            <IconButton
              size="sm"
              label={usfm() ? t("Show the reading") : t("Show the USFM")}
              icon={<CodeIcon size={14} />}
              aria-pressed={usfm() ? "true" : "false"}
              data-card-usfm=""
              onClick={() => props.onView({ kind: "usfm" })}
            />
          </Show>
          <Show when={props.notes === undefined && props.excerpt.hits.length > 1}>
            <span class="text-smallest text-on-surface-tertiary">
              {t("{count} matches", { count: props.excerpt.hits.length })}
            </span>
          </Show>
        </>
      }
      editing={props.editing}
      onEdit={() => edit()}
      onDone={done}
      open={
        props.openable === false ? undefined : (
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
        )
      }
      notes={props.notes}
      control={
        <Show when={props.onExpand}>
          {(step) => (
            <ContextControl
              extent={props.excerpt.extent}
              canUp={props.excerpt.more.up}
              canDown={props.excerpt.more.down}
              onStep={step()}
            />
          )}
        </Show>
      }
      actions={props.actions}
    >
      <div
        ref={setBody}
        data-layout={props.paired === undefined ? "single" : wide() ? "side" : "stacked"}
        class={cx(
          props.paired !== undefined && "grid gap-2 p-2",
          props.paired !== undefined && (wide() ? "grid-cols-2 items-start" : "grid-cols-1"),
        )}
      >
        <Show when={props.paired !== undefined}>{pairedSide}</Show>
        <div class="min-w-0">{target}</div>
      </div>
    </CardFrame>
  );
}
