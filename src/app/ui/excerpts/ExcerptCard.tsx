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
import { ChangeSet, StateField, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
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
import { type EditorBook, type EditorPolicy, type Funnel, type MarkedRange } from "#editor/index";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { CardActions, type CardAction } from "../multibuffer/CardAction";
import { CardEditor } from "../multibuffer/CardEditor";
import { CardFrame } from "../multibuffer/CardFrame";
import type { CardEvent, CardView } from "../multibuffer/cardState";
import { ContextControl } from "../multibuffer/ContextControl";
import { cardPolicy } from "../multibuffer/policy";
import { Button, cx } from "../primitives";
import { verseTextOf } from "../review/reading";
import type { ExcerptCardSpec } from "./cardSpec";
import { ExcerptReader } from "./ExcerptReader";
import { lockVerseLabels } from "./lockVerseLabels";

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
  /** What this screen's cards do — marks, editing, the USFM switch, the steps, the way out. */
  readonly spec: ExcerptCardSpec;
  /** The card's row key, for the spec's slots. */
  readonly rowKey: string;
  /**
   * Plain → Instantiated for this book, on demand. Editing needs the
   * editor-backed Book, and a results list must not seat every book it lists.
   */
  readonly seat: () => Promise<EditorBook | undefined>;
  readonly analyze: (text: string) => Analysis;
  /** This book's seat while one is open, which the read-only view follows live. */
  readonly follow?: Funnel | undefined;
  readonly paired?: Paired | undefined;
  /**
   * The SOURCE offset of the match the find bar's cursor is on, when it is one
   * of THIS excerpt's. That one highlight is painted stronger and the card
   * takes a ring, so "3 of 62" names something the reader can see.
   */
  readonly active?: number;
  /** The shell's mode. `usfm` shows the markup; anything else, the reading. */
  readonly mode?: "regular" | "usfm";
  /**
   * Set while the card is held on screen for editing though the results no
   * longer include it — the finding resolved, the term no longer matches.
   * What to call that is the screen's ("Resolved", "No longer matches").
   */
  readonly gone?: string | undefined;
  /**
   * The reader's view of this card — its USFM switch, its paired side's
   * width — held by the screen, so it outlives the row (`cardViews.ts`).
   */
  readonly view: CardView;
  readonly onView: (event: CardEvent) => void;
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
  markTone: ((source: number | undefined, excerpt: Excerpt) => MarkTone | undefined) | undefined,
): readonly MarkedRange[] => {
  const out: MarkedRange[] = [];
  const { span, own } = excerpt;
  if (own.from > span.from)
    out.push({ from: span.from, to: own.from, class: "cm-excerpt-context" });
  if (span.to > own.to) out.push({ from: own.to, to: span.to, class: "cm-excerpt-context" });
  // The own unit, marked so a card can find where it is drawn (a chapter
  // opening keeps it in place). Unstyled.
  if (own.to > own.from) out.push({ from: own.from, to: own.to, class: "cm-excerpt-own" });
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

/** A region that opens and closes by its row: 300ms, and not at all under reduced motion. */
const collapsible =
  "grid transition-[grid-template-rows] duration-300 ease-in-out motion-reduce:transition-none";

export function ExcerptCard(props: ExcerptCardProps) {
  const shell = useShell();
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
        props.spec.marks.kind === "toned" ? props.spec.marks.tone : undefined,
      ),
    { name: "excerptMarks" },
  );

  const pairedView = createMemo(
    () => {
      const paired = props.paired;
      if (paired?.kind !== "text") return undefined;
      const excerpt = pairedExcerpt(paired.book, props.excerpt, paired.hits, false);
      if (excerpt === undefined) return undefined;
      return { excerpt, marks: marksOf(excerpt, paired.hits, undefined, undefined) };
    },
    { name: "excerptPaired" },
  );

  /** Does the current match live here? Drives the card's ring. */
  const current = (): boolean =>
    props.active !== undefined && props.excerpt.hits.some((hit) => hit.from === props.active);

  const direct = (): boolean => props.spec.edit.kind === "direct";
  const chapterOpen = (): boolean => props.excerpt.extent.chapter === true;
  /** The screen's matrix in the card's mode; reader, satellite and paired side share it. */
  const policy = (): EditorPolicy => props.spec.policy?.(mode()) ?? cardPolicy(mode());

  const edit = (caret?: number, where?: { x: number; y: number }): void => {
    if (targetBox !== undefined) setHold(targetBox.offsetHeight);
    setAt(caret);
    setPoint(where);
    props.onEdit();
    void props.seat().then((seated) => {
      setBook(seated);
      setRefused(seated === undefined);
    });
  };

  const done = (): void => {
    // The reverse swap holds too: the editor's height until the reading has
    // drawn in its place, then the box is free again.
    if (targetBox !== undefined) {
      setHold(targetBox.offsetHeight);
      requestAnimationFrame(() => requestAnimationFrame(() => setHold(undefined)));
    } else setHold(undefined);
    setBook(undefined);
    setAt(undefined);
    props.onDone();
  };

  /**
   * A direct card's edit is a SESSION with a way back. Everything typed lands
   * in the book as it is typed (that is how the editor works); the session
   * keeps every change composed since it opened (`sessionEdits`), so Cancel
   * can hand the book the exact inverse and Save only has to stop. `dirty`
   * is what turns the card's buttons into Save changes / Cancel.
   */
  const [dirty, setDirty] = createSignal(false, { name: "excerptDirty" });
  let editView: EditorView | undefined;
  let openedOn: Text | undefined;
  const sessionEdits = StateField.define<ChangeSet>({
    create: (state) => ChangeSet.empty(state.doc.length),
    update: (held, transaction) =>
      transaction.docChanged ? held.compose(transaction.changes) : held,
  });
  const sessionWatch = EditorView.updateListener.of((update) => {
    if (update.docChanged) setDirty(!update.state.field(sessionEdits).empty);
  });
  const save = (): void => {
    setDirty(false);
    done();
  };
  const cancel = (): void => {
    const view = editView;
    if (view !== undefined && openedOn !== undefined && dirty()) {
      const undo = view.state.field(sessionEdits, false)?.invert(openedOn);
      // Past the card's own filters (the verse-number lock would refuse a
      // revert that spans a label); the book still admits it as an edit.
      if (undo !== undefined && !undo.empty) view.dispatch({ changes: undo, filter: false });
    }
    setDirty(false);
    done();
  };

  const reader = () => (
    <ExcerptReader
      analysis={props.excerpt.analysis}
      span={props.excerpt.span}
      policy={policy()}
      marks={marks()}
      label={`excerpt:${props.excerpt.sid}`}
      follow={props.follow}
      onEdit={props.spec.edit.kind === "none" ? undefined : edit}
      direct={direct()}
      onReveal={(found) => {
        reveal = found;
      }}
    />
  );

  /**
   * The target's height, held from the click until the editor has drawn: the
   * reading stays on screen while the book is seated, and the box keeps its
   * size through the swap, so the card does not shrink and regrow.
   */
  const [hold, setHold] = createSignal<number | undefined>(undefined, { name: "excerptHold" });
  let targetBox: HTMLDivElement | undefined;
  createEffect(
    () => props.editing && book() !== undefined,
    (drawn) => {
      if (!drawn) return;
      // Two frames: one for the editor to mount, one for it to lay out.
      requestAnimationFrame(() => requestAnimationFrame(() => setHold(undefined)));
    },
  );

  /**
   * Show more opens the whole chapter, which puts text above the verse. When
   * the card's animation has ended, the reading is scrolled back to the verse
   * the card is for — its Address, already resolved through the TOC to
   * `own.from` — with the editor's own scroll-to, as the book editor lands on
   * a verse (`BookEditor`'s reveal).
   */
  let reveal: ((at: number) => void) | undefined;
  createEffect(
    () => chapterOpen(),
    (open) => {
      if (!open) return;
      const timer = setTimeout(() => reveal?.(props.excerpt.own.from), 300);
      return () => clearTimeout(timer);
    },
  );

  /**
   * A direct card's edit ends when the reader leaves the box — a press
   * anywhere outside it, or focus going elsewhere — and leaving is a CANCEL:
   * nothing typed survives a click away. The row of buttons under the box
   * counts as inside, so pressing Save changes is not first a cancel.
   */
  let actionsRow: HTMLDivElement | undefined;
  const inside = (node: Node, frame: HTMLElement): boolean =>
    frame.contains(node) || actionsRow?.contains(node) === true;
  createEffect(
    () => (direct() && props.editing ? targetBox : undefined),
    (element) => {
      if (element === undefined) return;
      const press = (event: PointerEvent): void => {
        if (props.editing && event.target instanceof Node && !inside(event.target, element))
          cancel();
      };
      const leave = (event: FocusEvent): void => {
        const next = event.relatedTarget;
        if (next instanceof Node && inside(next, element)) return;
        // After the move lands: focus that only passed through (the editor
        // replacing the reading) has come back by then.
        setTimeout(() => {
          // Still this card's edit: the press may have ended it and another
          // card begun its own since.
          const now = document.activeElement;
          if (props.editing && !(now !== null && inside(now, element))) cancel();
        }, 0);
      };
      document.addEventListener("pointerdown", press, true);
      element.addEventListener("focusout", leave);
      return () => {
        document.removeEventListener("pointerdown", press, true);
        element.removeEventListener("focusout", leave);
      };
    },
  );

  const target = (
    <Show when={props.editing} fallback={reader()}>
      <Show
        when={book()}
        fallback={
          <Show when={refused()} fallback={reader()}>
            <p class="px-3 py-2 text-small text-on-surface-tertiary">
              {t("That book could not be opened for editing.")}
            </p>
          </Show>
        }
      >
        {(seated) => (
          <CardEditor
            book={seated()}
            range={props.excerpt.span}
            policy={policy()}
            marks={marks()}
            at={at()}
            point={point()}
            select={props.excerpt.hits[0]}
            analyze={props.analyze}
            label={`excerpt:${props.excerpt.sid}`}
            extensions={direct() ? [lockVerseLabels, sessionEdits, sessionWatch] : undefined}
            onView={(view) => {
              editView = view;
              openedOn = view?.state.doc;
            }}
            onDone={direct() ? cancel : done}
          />
        )}
      </Show>
    </Show>
  );

  const pairedText = () => (props.paired?.kind === "text" ? props.paired : undefined);
  const pairedStatic = () => (props.paired?.kind === "static" ? props.paired : undefined);
  const pairedNone = () => (props.paired?.kind === "none" ? props.paired : undefined);

  const pairedSide = (
    <section data-paired={props.paired?.kind} aria-label={props.paired?.name} class="min-w-0">
      {/* No box and no name: the reading sits on the card itself; the name
          stays the section's label for a screen reader. */}
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
                policy={policy()}
                marks={view().marks}
                label={`paired:${props.excerpt.sid}`}
              />
            )}
          </Show>
        )}
      </Show>
      <Show when={pairedStatic()}>
        {(reading) => (
          <p class="px-3 py-2 font-scripture text-body leading-[2] text-on-surface-primary">
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

  const spec = (): ExcerptCardSpec => props.spec;
  /** Does this screen condense cards at all (Key terms)? Then every card carries its line. */
  const condensable = (): boolean => props.spec.condensed !== undefined;
  const condensed = (): boolean => props.spec.condensed?.(props.excerpt, props.rowKey) === true;
  const status = (): JSX.Element | undefined => props.spec.status?.(props.excerpt, props.rowKey);
  // A card condensed while it was being edited hands the edit back, so the
  // list does not keep a seat open for a card with no editor showing.
  createEffect(
    () => condensed() && props.editing,
    (stale) => {
      if (stale) done();
    },
  );
  const offerUsfm = (): boolean => {
    const usfmSwitch = spec().usfm;
    return (
      usfmSwitch.kind === "when" &&
      props.mode !== "usfm" &&
      usfmSwitch.offer(props.excerpt, props.rowKey)
    );
  };
  const notes = () => spec().notes?.(props.excerpt, props.rowKey, props.view);

  /** The card's own switch to USFM, where the spec offers one. */
  const usfmAction = (): CardAction[] =>
    offerUsfm()
      ? [
          {
            kind: "icon",
            id: "usfm",
            label: usfm() ? t("Show the reading") : t("Show the USFM"),
            icon: CodeIcon,
            pressed: usfm(),
            onPress: () => props.onView({ kind: "usfm" }),
          },
        ]
      : [];

  const openAction = (): CardAction | undefined => {
    if (spec().open.kind === "none") return undefined;
    return {
      kind: "icon",
      id: "open",
      label: t("Open in editor"),
      icon: SquareArrowOutUpRightIcon,
      pressed: opening() ? true : undefined,
      onPress: () => {
        setOpening(true);
        const open = spec().open;
        const hit = props.excerpt.hits[0];
        if (open.kind === "editor")
          open.to(props.excerpt.bookId, hit?.from ?? props.excerpt.span.from, hit?.to);
        // The card may still be here — the same book, already focused — so
        // the pressed state is released rather than left on.
        setTimeout(() => setOpening(false), 600);
      },
    };
  };

  /**
   * The condensed line: what the editor shows of the card's own verse, in the
   * engine's reading (`verseTextOf`), not a projection of Sefer's own.
   */
  const teaser = createMemo(
    () =>
      condensable()
        ? verseTextOf(shell.services.galley, props.excerpt.analysis.text, props.excerpt.own)
        : "",
    { name: "excerptTeaser" },
  );

  return (
    <div>
      {props.spec.before?.(props.excerpt, props.rowKey)}
      <CardFrame
        data={{ "data-sid": props.excerpt.sid, "data-mode": mode() }}
        current={current()}
        condensed={condensed()}
        onActivate={() => props.spec.onActivate?.(props.excerpt, props.rowKey)}
        title={spec().title?.(props.excerpt, props.rowKey, props.view) ?? props.excerpt.label}
        gone={props.gone}
        info={
          <>
            {/* The status sits right after the heading, open or condensed. */}
            <Show when={status()}>{(mark) => <span class="flex shrink-0">{mark()}</span>}</Show>
            {spec().info?.(props.excerpt, props.rowKey, props.view)}
            {/* Not when the card carries notes: findings list themselves line
                by line under the header, and "2 matches" above them would be
                the same count said twice in another vocabulary. */}
            <Show when={notes() === undefined && props.excerpt.hits.length > 1}>
              <span class="text-smallest text-on-surface-tertiary">
                {t("{count} matches", { count: props.excerpt.hits.length })}
              </span>
            </Show>
          </>
        }
        headerActions={usfmAction()}
        edit={
          spec().edit.kind === "satellite"
            ? { kind: "edit", editing: props.editing, onEdit: () => edit(), onDone: done }
            : { kind: "none" }
        }
        open={openAction()}
        notes={notes()}
        context={
          // Only the stepped control lives in the footer; a card with none, or
          // with the one expand control under its target, draws no footer.
          spec().context.kind !== "steps" ? undefined : (
            <Show when={spec().context.kind === "steps" ? spec().context : undefined}>
              {(context) => (
                <ContextControl
                  extent={props.excerpt.extent}
                  canUp={props.excerpt.more.up}
                  canDown={props.excerpt.more.down}
                  onStep={(step) => {
                    const held = context();
                    if (held.kind === "steps") held.step(props.excerpt.sid, step);
                  }}
                />
              )}
            </Show>
          )
        }
        flush={direct()}
        actions={direct() ? undefined : spec().actions?.(props.excerpt, props.rowKey, props.view)}
      >
        {/* Open and condensed are the SAME frame with two regions, and the
              switch is a CSS row transition: no node is replaced, and the
              card closing and the card opening move in the same frames. The
              closed region is inert, so its controls leave the tab order. */}
        <div
          class={cx(collapsible, condensed() ? "grid-rows-[0fr]" : "grid-rows-[1fr]")}
          inert={condensed()}
        >
          <div class="min-h-0 overflow-hidden">
            <div
              ref={setBody}
              data-layout={props.paired === undefined ? "single" : wide() ? "side" : "stacked"}
              class={cx(
                props.paired !== undefined && "grid gap-2",
                props.paired !== undefined && !direct() && "p-2",
                props.paired !== undefined && (wide() ? "grid-cols-2 items-start" : "grid-cols-1"),
              )}
            >
              <Show when={props.paired !== undefined}>{pairedSide}</Show>
              {/* The whole chapter is a long read: the target scrolls inside the
              card past 60% of the screen, so one card cannot become the list. */}
              {/* A direct card's target is drawn as the input it is: one outline,
              grey at rest and the editor's own brand one while editing
              (`editor.css`, `[data-direct-target]`). Its controls
              sit under it, in its column, so they start at its left edge. */}
              <div class="flex min-w-0 flex-col gap-2">
                {/* Two boxes: the FRAME, which never scrolls and draws the
                    outline, and inside it the part that scrolls once the whole
                    chapter is showing — so the outline stays round the box
                    rather than scrolling away with the text. */}
                <div
                  ref={(element: HTMLDivElement) => {
                    targetBox = element;
                  }}
                  style={hold() === undefined ? undefined : { "min-height": `${hold()}px` }}
                  data-direct-target={direct() ? "" : undefined}
                  data-editing={direct() && props.editing ? "" : undefined}
                  data-chapter={direct() && chapterOpen() ? "" : undefined}
                  class={cx("min-w-0", direct() && "cursor-pointer")}
                >
                  <div
                    class={cx(
                      chapterOpen() &&
                        "scrollbar-padded max-h-[var(--card-room,60vh)] overflow-y-auto",
                      // Inside the outline (2px in, 1.5px thick) and as round,
                      // so scrolled text is cut off at the border, not past it.
                      direct() && "m-[3.5px] rounded-[8.5px]",
                    )}
                  >
                    {target}
                  </div>
                </div>
                <Show when={direct()}>
                  <div
                    ref={(element: HTMLDivElement) => {
                      actionsRow = element;
                    }}
                    data-card-actions
                    class="flex items-center gap-controls"
                  >
                    {/* Changed while editing: the only two things to do are
                        keep it or drop it. */}
                    <Show
                      when={props.editing && dirty()}
                      fallback={
                        <>
                          <CardActions
                            size="md"
                            actions={
                              spec().actions?.(props.excerpt, props.rowKey, props.view) ?? []
                            }
                          />
                          <Show
                            when={spec().context.kind === "chapter" ? spec().context : undefined}
                          >
                            {(context) => (
                              <Button
                                data-step="chapter"
                                variant="tertiary"
                                icon={chapterOpen() ? <FoldVerticalIcon /> : <UnfoldVerticalIcon />}
                                onClick={() => {
                                  const held = context();
                                  if (held.kind === "chapter")
                                    held.step(props.excerpt.sid, "chapter");
                                }}
                              >
                                {chapterOpen() ? t("Show less") : t("Show more")}
                              </Button>
                            )}
                          </Show>
                        </>
                      }
                    >
                      <Button variant="primary" data-card-action="save" onClick={save}>
                        {t("Save changes")}
                      </Button>
                      <Button variant="tertiary" data-card-action="cancel" onClick={cancel}>
                        {t("Cancel")}
                      </Button>
                    </Show>
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </div>
        <Show when={condensable()}>
          <div
            aria-hidden={condensed() ? undefined : "true"}
            class={cx(collapsible, condensed() ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
          >
            <div class="min-h-0 overflow-hidden">
              <div
                class={cx(
                  "grid gap-2 text-small text-on-surface-primary",
                  props.paired !== undefined && "grid-cols-2",
                )}
              >
                <Show when={props.paired !== undefined}>
                  <p class="truncate px-3 font-scripture">
                    {pairedStatic()?.text ?? pairedNone()?.message ?? ""}
                  </p>
                </Show>
                <p class="truncate px-3 font-scripture">{teaser()}</p>
              </div>
            </div>
          </div>
        </Show>
      </CardFrame>
      {props.spec.after?.(props.excerpt, props.rowKey)}
    </div>
  );
}
