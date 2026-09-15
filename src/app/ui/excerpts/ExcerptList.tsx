/**
 * The multibuffer: an outline column beside a windowed list of excerpts under
 * sticky per-book headers.
 *
 * One component, two feeds. Find supplies groups built from search hits and
 * STET supplies groups built from a term's occurrences plus a `renderPair`
 * for the source verse; everything below this line is the same
 * (design-direction.md, "Key terms (STET) reuses the Find excerpt pattern").
 *
 * ## The windowing
 *
 * Hand-rolled, and small enough to read in one sitting: `@tanstack/solid-virtual`
 * is not a dependency of this repository and adding one that three other
 * branches would have to merge is a worse trade than forty lines of
 * arithmetic.
 *
 * The geometry is a single memo over an estimate per row, corrected by what a
 * `ResizeObserver` measures once a row is on screen — so the scrollbar is
 * right from the first paint and becomes exact as the reader moves. Every
 * offset is computed, never read back from the DOM during a scroll, which is
 * what keeps a scroll from laying out the page to answer where it is.
 *
 * Two consequences worth stating:
 *
 *  - Book headers are ALWAYS rendered (a project has tens of books, not
 *    thousands), so `position: sticky` works the way it reads. Only the
 *    excerpt cards are windowed, and they are the ones there can be hundreds
 *    of.
 *  - Rows are keyed by verse sid, a stable string, so a height correction
 *    re-positions a card instead of re-creating it — and an open satellite
 *    survives the correction it caused.
 */

import type { JSX } from "@solidjs/web";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";

import type { BookId } from "../../../core/book/book";
import type { BookExcerpts, Excerpt, OutlineRow } from "../../../core/excerpts/excerpts";
import type { Analysis } from "../../../core/galley";
import type { EditorBook } from "../../../editor";
import { t } from "../../i18n";
import { cx } from "../primitives";
import { ExcerptCard } from "./ExcerptCard";

export interface ExcerptListProps {
  readonly groups: readonly BookExcerpts[];
  readonly outline: readonly OutlineRow[];
  /** Aim the main editor at this range of this book. */
  readonly onOpen: (bookId: BookId, from: number, to?: number) => void;
  /** Plain → Instantiated, for the one excerpt being edited. */
  readonly seat: (bookId: BookId) => Promise<EditorBook | undefined>;
  readonly analyze: (text: string) => Analysis;
  /** Told when an edit session ended, so the feed can re-read the books. */
  readonly onEdited?: () => void;
  /**
   * The verse sid the match cursor is on. Changing it scrolls that excerpt
   * into view — this is what the find bar's "1/62" and its arrows drive.
   */
  readonly focus?: string;
  /**
   * The SOURCE offset of the match the find bar's cursor is on. Paired with
   * `focus` — which excerpt — it says which of that excerpt's highlights is
   * the current one, so stepping through matches inside one verse is visible
   * without the list moving.
   */
  readonly activeHit?: number;
  /** STET's source verse for one excerpt. */
  readonly renderPair?: (excerpt: Excerpt) => JSX.Element;
  /**
   * Show one more verse above (-1) or below (+1) of one excerpt. The EXTENT
   * is the feed's state, keyed by sid, not this component's: a card scrolls
   * out of the window and its row is unmounted, and an expansion the reader
   * asked for must survive that.
   */
  readonly onExpand?: (sid: string, direction: -1 | 1) => void;
  readonly empty?: JSX.Element;
}

/** Roughly one line of the scripture serif at the list's width. */
const LINE = 26;
const CHARS_PER_LINE = 92;
const CARD_CHROME = 42;
const HEADER = 34;
const GROUP_GAP = 12;
const OVERSCAN = 600;

const estimate = (excerpt: Excerpt): number =>
  CARD_CHROME + Math.max(1, Math.ceil(excerpt.text.length / CHARS_PER_LINE)) * LINE + 16;

interface RowGeometry {
  readonly sid: string;
  readonly excerpt: Excerpt;
  readonly top: number;
  readonly height: number;
}

interface GroupGeometry {
  readonly group: BookExcerpts;
  /** Where the section starts inside the scroller. */
  readonly top: number;
  readonly headerHeight: number;
  readonly bodyHeight: number;
  readonly rows: readonly RowGeometry[];
}

export function ExcerptList(props: ExcerptListProps) {
  const [scroller, setScroller] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "excerptScroller",
  });
  const [viewport, setViewport] = createSignal(
    { top: 0, bottom: 800 },
    { name: "excerptViewport" },
  );
  const [editing, setEditing] = createSignal<string | undefined>(undefined, {
    name: "excerptEditing",
  });

  // Measured heights, keyed by row sid and by `header:<bookId>`. A plain map
  // plus a version signal rather than a signal per row: a first paint measures
  // every visible row at once, and one recomputation is the right number.
  const measured = new Map<string, number>();
  const [version, setVersion] = createSignal(0, { name: "excerptMeasured" });
  let pending = false;
  const remeasure = (): void => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      setVersion((held) => held + 1);
    });
  };
  const record = (key: string, height: number): void => {
    if (height <= 0) return;
    if (Math.abs((measured.get(key) ?? -1) - height) < 0.5) return;
    measured.set(key, height);
    remeasure();
  };

  const layout = createMemo(
    () => {
      version();
      const out: GroupGeometry[] = [];
      let top = 0;
      for (const group of props.groups) {
        const headerHeight = measured.get(`header:${group.bookId}`) ?? HEADER;
        const rows: RowGeometry[] = [];
        let offset = 0;
        for (const excerpt of group.excerpts) {
          const height = measured.get(excerpt.sid) ?? estimate(excerpt);
          rows.push({ sid: excerpt.sid, excerpt, top: offset, height });
          offset += height + 8;
        }
        out.push({ group, top, headerHeight, bodyHeight: offset, rows });
        top += headerHeight + offset + GROUP_GAP;
      }
      return { groups: out, total: top };
    },
    { name: "excerptLayout" },
  );

  /** The sids this group must have on screen, as stable keys for `<For>`. */
  const visible = (geometry: GroupGeometry): readonly string[] => {
    const view = viewport();
    const base = geometry.top + geometry.headerHeight;
    const from = view.top - OVERSCAN - base;
    const to = view.bottom + OVERSCAN - base;
    return geometry.rows
      .filter((row) => (row.top + row.height >= from && row.top <= to) || row.sid === editing())
      .map((row) => row.sid);
  };

  const rowsBySid = createMemo(
    () => {
      const map = new Map<string, RowGeometry>();
      for (const geometry of layout().groups)
        for (const row of geometry.rows) map.set(row.sid, row);
      return map;
    },
    { name: "excerptRows" },
  );

  // Geometry is looked up by id rather than iterated: a height correction
  // rebuilds these values, and a `<For>` over them would rebuild the DOM —
  // destroying the satellite whose appearance caused the correction.
  const geometryBySid = createMemo(
    () => new Map(layout().groups.map((geometry) => [geometry.group.bookId, geometry] as const)),
    { name: "excerptGeometry" },
  );

  const EMPTY: GroupGeometry = {
    group: { bookId: "", name: "", excerpts: [], count: 0 },
    top: 0,
    headerHeight: HEADER,
    bodyHeight: 0,
    rows: [],
  };

  const geometryOf = (bookId: BookId): GroupGeometry => geometryBySid().get(bookId) ?? EMPTY;

  const onScroll = (): void => {
    const element = scroller();
    if (element === undefined) return;
    setViewport({ top: element.scrollTop, bottom: element.scrollTop + element.clientHeight });
  };

  createEffect(
    () => scroller(),
    (element) => {
      if (element === undefined) return;
      onScroll();
      const observer = new ResizeObserver(() => {
        onScroll();
      });
      observer.observe(element);
      onCleanup(() => {
        observer.disconnect();
      });
    },
  );

  /** The book whose header the reader is under. */
  const active = createMemo(
    () => {
      const view = viewport();
      let found: BookId | undefined;
      for (const geometry of layout().groups)
        if (geometry.top <= view.top + 4) found = geometry.group.bookId;
      return found ?? props.groups[0]?.bookId;
    },
    { name: "excerptActiveBook" },
  );

  // The cursor's excerpt, scrolled to. Computed rather than measured: the row
  // may not be rendered yet, which is exactly when a `scrollIntoView` on a DOM
  // node cannot work and an offset can.
  createEffect(
    () => props.focus,
    (sid) => {
      if (sid === undefined) return;
      const element = untrack(scroller);
      if (element === undefined) return;
      for (const geometry of untrack(layout).groups) {
        const row = geometry.rows.find((entry) => entry.sid === sid);
        if (row === undefined) continue;
        const top = geometry.top + geometry.headerHeight + row.top;
        const view = untrack(viewport);
        if (top >= view.top && top + row.height <= view.bottom) return;
        element.scrollTo({ top: Math.max(0, top - geometry.headerHeight - 8), behavior: "smooth" });
        return;
      }
    },
  );

  const goTo = (bookId: BookId): void => {
    const element = scroller();
    const geometry = layout().groups.find((entry) => entry.group.bookId === bookId);
    if (element === undefined || geometry === undefined) return;
    element.scrollTo({ top: geometry.top, behavior: "smooth" });
  };

  /**
   * Measures one element into `key` and keeps measuring while it lives.
   *
   * ONE observer for the whole list, owned by the component. A `ref` callback
   * runs outside a reactive owner, so an `onCleanup` registered there would
   * never fire and every row would leak an observer of its own.
   */
  const keyOf = new WeakMap<Element, string>();
  const sizes = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const key = keyOf.get(entry.target);
      if (key !== undefined && entry.target instanceof HTMLElement)
        record(key, entry.target.offsetHeight);
    }
  });
  onCleanup(() => {
    sizes.disconnect();
  });

  const measure = (element: HTMLElement, key: string): void => {
    keyOf.set(element, key);
    sizes.observe(element);
  };

  const done = (): void => {
    setEditing(undefined);
    props.onEdited?.();
  };

  return (
    <div class="flex min-h-0 flex-1 gap-4">
      <nav
        aria-label={t("Books with results")}
        class="hidden w-40 shrink-0 flex-col gap-0.5 overflow-y-auto md:flex"
      >
        <For each={props.outline}>
          {(row) => (
            <button
              type="button"
              data-outline={row.bookId}
              aria-current={active() === row.bookId ? "true" : undefined}
              onClick={() => goTo(row.bookId)}
              class={cx(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-start text-small transition-colors",
                active() === row.bookId
                  ? "bg-sidebar-surface-active font-medium text-brand"
                  : "text-on-surface-secondary hover:bg-surface-secondary",
              )}
            >
              <span class="truncate">{row.bookId}</span>
              <span class="ms-auto text-smallest tabular-nums text-on-surface-tertiary">
                {row.count}
              </span>
            </button>
          )}
        </For>
      </nav>

      <div
        ref={setScroller}
        onScroll={onScroll}
        data-excerpts={props.groups.length}
        class="min-h-0 min-w-0 flex-1 overflow-y-auto pe-1"
      >
        <Show when={props.groups.length > 0} fallback={props.empty}>
          <div style={{ height: `${layout().total}px` }} class="relative">
            {/* `keyed={false}`: the feed rebuilds its groups whenever anything
                about them changes — an expanded excerpt, a re-search after an
                edit — and a keyed `For` would destroy and rebuild every
                section and every card inside it, taking an open satellite
                with them. The sections are one per book in a stable order, so
                the index is the identity and the child takes an accessor. */}
            <For each={props.groups} keyed={false}>
              {(group) => (
                <section
                  data-book={group().bookId}
                  class="absolute inset-x-0"
                  style={{ top: `${geometryOf(group().bookId).top}px` }}
                >
                  <header
                    ref={(element) => measure(element, `header:${group().bookId}`)}
                    class="sticky top-0 z-10 flex items-baseline gap-2 border-b border-surface-border bg-surface-secondary/95 px-1 py-1.5 backdrop-blur-xs"
                  >
                    <strong class="text-small font-semibold text-on-surface-primary">
                      {group().bookId}
                    </strong>
                    <span class="text-small text-on-surface-secondary">{group().name}</span>
                    <span class="ms-auto text-smallest text-on-surface-tertiary">
                      {t("{count} hits", { count: group().count })}
                    </span>
                  </header>
                  <div
                    class="relative"
                    style={{ height: `${geometryOf(group().bookId).bodyHeight}px` }}
                  >
                    <For each={visible(geometryOf(group().bookId))}>
                      {(sid) => (
                        <Show when={rowsBySid().get(sid)}>
                          {(row) => (
                            <div
                              ref={(element) => measure(element, sid)}
                              class="absolute inset-x-0"
                              style={{ top: `${row().top}px` }}
                            >
                              <ExcerptCard
                                excerpt={row().excerpt}
                                editing={editing() === sid}
                                onEdit={() => setEditing(sid)}
                                onDone={done}
                                onOpen={() =>
                                  props.onOpen(
                                    row().excerpt.bookId,
                                    row().excerpt.hits[0]?.from ?? row().excerpt.span.from,
                                    row().excerpt.hits[0]?.to,
                                  )
                                }
                                seat={() => props.seat(row().excerpt.bookId)}
                                analyze={props.analyze}
                                pair={props.renderPair?.(row().excerpt)}
                                onExpand={
                                  props.onExpand === undefined
                                    ? undefined
                                    : (direction) => props.onExpand?.(sid, direction)
                                }
                                active={props.focus === sid ? props.activeHit : undefined}
                              />
                            </div>
                          )}
                        </Show>
                      )}
                    </For>
                  </div>
                </section>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
