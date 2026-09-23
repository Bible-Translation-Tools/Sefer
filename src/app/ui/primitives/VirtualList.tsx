/**
 * The multibuffer's engine: sticky section headers over a windowed list of
 * rows, measured as they appear.
 *
 * Find, Key terms and `/findings` share it. The measured numbers are the
 * argument for windowing at all: on a synthetic 7,296 findings an un-windowed
 * list built 4,992 rows and took ~647 ms to re-render, and this builds 18 and
 * takes ~63 ms. `documentation/architecture/ui.md`, "The multibuffer", has the
 * full account.
 *
 * ## One flat item list, headers included
 *
 * A virtualizer wants ONE list, so the sections are flattened into a run of
 * items in which a header and a row are both items. That is also what makes the
 * sticky header work: a virtual item is positioned by a transform, and
 * `position: sticky` does nothing inside a transform — so the header the reader
 * is currently under is taken out of the transform and rendered
 * `position: sticky; top: 0` instead, while `rangeExtractor` keeps its index in
 * the window even once it has scrolled past. This is TanStack's own sticky
 * recipe, and it is why the headers are not simply all rendered: at sixty-six
 * books that was fine, at a thousand groups it is not.
 *
 * ## Why `@tanstack/virtual-core` and not `@tanstack/solid-virtual`
 *
 * The geometry is TanStack's; the forty lines of Solid binding are ours,
 * because the published Solid binding is a Solid 1 package whose one
 * `createComputed` reads its options and WRITES its item store in the same
 * function — exactly what Solid 2 forbids (`REACTIVE_WRITE_IN_OWNED_SCOPE`),
 * and not shimmable from outside the package.
 *
 * So this file binds `@tanstack/virtual-core` — the framework-agnostic engine
 * both wrappers sit on, with no framework imports of its own — the way the
 * Solid 1 wrapper does, with the writes in an effect's EFFECT phase where
 * Solid 2 allows them. Nothing is reimplemented: measurement, the range, the
 * scroll observers and `scrollToIndex` are all the library's.
 *
 * ## The list is rendered over KEYS, not over virtual items
 *
 * `getVirtualItems()` hands back fresh objects for every index at or below the
 * lowest one whose size moved — the library rebuilds its measurements from
 * there — so a `<For>` over those items, which reconciles by REFERENCE, would
 * re-create rows on every measurement. That is not a performance note: an
 * open excerpt editor is a CodeMirror view mounted inside a row, and
 * re-creating the row destroys it — Edit opens a satellite, the card grows,
 * the growth re-creates the card, and the card sits on "Opening…" for ever.
 *
 * So the `<For>` walks the WINDOW'S KEYS — the caller's own stable strings, a
 * verse sid or a finding id — and each row reads its own geometry back out of
 * the item list by key. Strings reconcile by value, so a measurement MOVES a
 * row rather than replacing it, and an open editor survives the correction it
 * caused. It is also why `row` and `header` are handed ACCESSORS: a row
 * outlives the model it was built from and has to read the current one.
 *
 * ## Measure in the effect phase, never in the `ref`
 *
 * A `ref` callback runs while the element is still detached, and an element
 * that is not in the document measures 0 × 0. Handing that 0 to the library as
 * a first measurement makes "the list opens half way down": the real height
 * then arrives as a RE-measurement of a 0-high row sitting exactly at the
 * fold, which is the one case TanStack compensates the scroll position for —
 * so each row in turn pushes the viewport down by its own height (8,154px of
 * accumulated correction on `/findings` before the list is touched). The element goes into a signal instead and is measured from an
 * effect, which runs once it is in the document.
 */

import type { JSX } from "@solidjs/web";
import {
  defaultRangeExtractor,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  Virtualizer,
  type Range,
  type VirtualItem,
  type VirtualizerOptions,
} from "@tanstack/virtual-core";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
  type Accessor,
} from "solid-js";

/** One row: a stable key, and the height to assume until it has been measured. */
export interface VirtualRow<T> {
  readonly key: string;
  readonly item: T;
  readonly estimate: number;
}

/** One section: a key, and its rows in reading order. */
export interface VirtualSection<T> {
  readonly key: string;
  readonly rows: readonly VirtualRow<T>[];
}

/** The flattened list the virtualizer walks: a header or a row, in order. */
type Entry<T> =
  | { readonly kind: "header"; readonly key: string; readonly section: VirtualSection<T> }
  | { readonly kind: "row"; readonly key: string; readonly row: VirtualRow<T> };

/** The height a header is assumed to have before it has been on screen. */
const HEADER = 34;
/** How far past the viewport to keep items mounted, in ITEMS. */
const OVERSCAN = 8;

export interface VirtualListProps<T> {
  readonly sections: readonly VirtualSection<T>[];
  /**
   * The sticky header for one section.
   *
   * `ref` MUST go on the element that owns the header's whole height: it is
   * what the virtualizer measures, and a wrapper of its own would report the
   * wrong number.
   */
  readonly header: (
    section: Accessor<VirtualSection<T>>,
    ref: (element: HTMLElement) => void,
  ) => JSX.Element;
  /**
   * One row. Kept simple on purpose: the row owns its own chrome.
   *
   * An ACCESSOR, because a row outlives the model it was built from: it is
   * made once, when its key enters the window, and stays through every rebuild
   * of the list that still holds that key.
   */
  readonly row: (item: Accessor<T>, key: string) => JSX.Element;
  /**
   * A row that must stay mounted even when it scrolls out — an open editor, an
   * expanded satellite. Windowing that unmounted it would take the reader's
   * work with it.
   */
  readonly pinned?: string;
  /** Scroll this row into view when it changes. */
  readonly focus?: string;
  /** Told which section the reader is currently under, for an outline column. */
  readonly onActive?: (key: string) => void;
  readonly class?: string;
  readonly empty?: JSX.Element;
  /** Handed a `goTo`, so a caller can drive the list from an outline. */
  readonly ref?: (scrollTo: (sectionKey: string) => void) => void;
}

export function VirtualList<T>(props: VirtualListProps<T>) {
  const [scroller, setScroller] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "virtualScroller",
  });
  const [offset, setOffset] = createSignal(0, { name: "virtualOffset" });

  /** The sections as one list, plus the two lookups the rest of the file needs. */
  const flat = createMemo(
    () => {
      const entries: Entry<T>[] = [];
      /** Every header's index, ascending — what the sticky search walks. */
      const headers: number[] = [];
      const indexOfKey = new Map<string, number>();
      for (const section of props.sections) {
        headers.push(entries.length);
        indexOfKey.set(`header:${section.key}`, entries.length);
        entries.push({ kind: "header", key: `header:${section.key}`, section });
        for (const row of section.rows) {
          indexOfKey.set(row.key, entries.length);
          entries.push({ kind: "row", key: row.key, row });
        }
      }
      return { entries, headers, indexOfKey };
    },
    { name: "virtualFlat" },
  );

  /**
   * The header a given first-visible index sits under: the last one at or
   * above it. Deliberately a pure function of an index rather than of the
   * scroll position, so the range extractor and the renderer cannot disagree
   * about which header is the sticky one.
   */
  const headerAbove = (index: number): number => {
    let found = 0;
    for (const at of untrack(flat).headers) {
      if (at > index) break;
      found = at;
    }
    return found;
  };

  /** What the virtualizer reports, as Solid state. The writes are below. */
  const [items, setItems] = createSignal<readonly VirtualItem[]>([], { name: "virtualItems" });
  const [total, setTotal] = createSignal(0, { name: "virtualTotal" });

  /**
   * The ROWS that were on screen when the list was last drawn.
   *
   * The reader's place in a list is a row, not a number of pixels — see the
   * rebuild rule in the effect further down, which is the only thing this is
   * for. Headers are left out on purpose: a section that survives a rebuild
   * says the books still have results, not that the reader's place is still
   * there.
   */
  let onScreen: readonly string[] = [];

  /** Publish one window, and remember the rows it held. */
  const remember = (window: readonly VirtualItem[]): void => {
    const entries = untrack(flat).entries;
    onScreen = window
      .filter((item) => entries[item.index]?.kind === "row")
      .map((item) => String(item.key));
    setItems(window);
  };

  /**
   * Every option, rebuilt on demand.
   *
   * `virtual-core`'s `setOptions` REPLACES the option bag rather than merging
   * onto it, so this is one function and the effect below hands back the whole
   * thing each time.
   */
  const optionsOf = (): VirtualizerOptions<HTMLDivElement, HTMLElement> => ({
    count: untrack(flat).entries.length,
    // `untrack`, like every read in this bag: these callbacks are invoked by
    // `virtual-core` from its own observers, and a read there is a question
    // asked at call time, not a dependency. The effect below is what re-hands
    // the options when `scroller` moves, and it tracks it in its compute.
    getScrollElement: () => untrack(scroller) ?? null,
    estimateSize: (index: number) => {
      const entry = untrack(flat).entries[index];
      return entry === undefined ? HEADER : entry.kind === "header" ? HEADER : entry.row.estimate;
    },
    // The caller's own stable string. It keys the library's measurement cache,
    // so a row that leaves the window and comes back is the height it was, and
    // it is what the `<For>` below reconciles on.
    getItemKey: (index: number) => untrack(flat).entries[index]?.key ?? index,
    overscan: OVERSCAN,
    // Two indices are kept in the window whatever the scroll says: the header
    // that is currently stuck (it has to exist to be sticky) and the caller's
    // pinned row (unmounting an open editor would throw away the reader's
    // work).
    rangeExtractor: (range: Range) => {
      const keep = new Set(defaultRangeExtractor(range));
      keep.add(headerAbove(range.startIndex));
      // Read at range time, untracked for the same reason: the library asks
      // what is pinned NOW, and a stale answer would unmount an open editor.
      const pinned = untrack(() => props.pinned);
      const pinnedAt = pinned === undefined ? undefined : untrack(flat).indexOfKey.get(pinned);
      if (pinnedAt !== undefined) keep.add(pinnedAt);
      return [...keep].sort((a, b) => a - b);
    },
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    // Called by the library's own scroll and resize observers, which run
    // outside any owner — so these writes are ordinary event-handler writes.
    onChange: (instance) => {
      instance._willUpdate();
      remember(instance.getVirtualItems());
      setTotal(instance.getTotalSize());
    },
  });

  const virtualizer = new Virtualizer(optionsOf());

  /**
   * When a height correction may move the viewport under the reader.
   *
   * An INSTANCE property and not an option — `setOptions` never touches it,
   * which is why it is set once, here.
   *
   * Compensating a correction is a way of holding still what the reader has
   * already scrolled PAST: a row above the fold that turns out to be taller
   * than its estimate would otherwise push the row they are reading down the
   * screen. It is worth doing for exactly one kind of correction, a
   * RE-measurement of a row this list has measured before — a card that grew
   * because it was opened for editing, a verse that grew because it was
   * expanded.
   *
   * A FIRST measurement is refused, and that is the narrowing the library's
   * own default does not make. Every row is measured for the first time at
   * least once, and answering those moves the viewport by the sum of every
   * estimate's error: on arrival that walked `/findings` 8,154px down a list
   * the reader had not touched, and on a fresh query — where every key is new
   * — it dragged the list straight back to the offset the PREVIOUS results
   * had been left at.
   */
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
    if (!instance.itemSizeCache.has(item.key)) return false;
    const fold = (instance.scrollOffset ?? 0) + instance.scrollAdjustments;
    if (fold <= 0) return false;
    return item.start + item.size <= fold;
  };

  /** Pull what the library computed into the two signals above. */
  const publish = (): void => {
    virtualizer._willUpdate();
    remember(virtualizer.getVirtualItems());
    setTotal(virtualizer.getTotalSize());
  };

  // Mount once the scroller exists — the library needs an element to observe —
  // and re-set the options whenever the item count moves. The reads are in the
  // compute and the WRITES are in the effect, which is Solid 2's split and the
  // reason this file binds `virtual-core` itself; see the header.
  /**
   * The library's own scroll and resize observers, as one disposer.
   *
   * Held at COMPONENT scope rather than registered from inside the effect: an
   * effect's effect-phase is not a reactive owner in Solid 2, so an
   * `onCleanup` there would never run and the observers would outlive the
   * list. One `onCleanup` here, in the body, is the owner that does.
   */
  let unmount: (() => void) | undefined;
  onCleanup(() => {
    unmount?.();
    unmount = undefined;
  });

  createEffect(
    () => [scroller(), flat()] as const,
    ([element, list]) => {
      if (element === undefined) return;
      /**
       * Is this still the list the reader was holding their place in?
       *
       * A place is a ROW. An accepted edit rebuilds the model and the reader
       * stays where they were, because the rows they were looking at are
       * still there under the same keys. A fresh query — or a regrouping of
       * /findings — replaces every key on screen, and then there is nothing
       * left to hold a place WITH: a scroll position measured in pixels of
       * somebody else's results is not a place, so the list goes back to its
       * top, which is where a new list starts.
       */
      const lost = onScreen.length > 0 && !onScreen.some((key) => list.indexOfKey.has(key));
      virtualizer.setOptions(optionsOf());
      unmount ??= virtualizer._didMount();
      if (lost && untrack(offset) > 0) {
        virtualizer.scrollToOffset(0);
        setOffset(0);
      }
      publish();
    },
  );

  /** The first item the reader can actually see, as an index. */
  const firstVisible = createMemo(
    () => {
      const at = offset();
      for (const item of items()) if (item.start + item.size > at) return item.index;
      return 0;
    },
    { name: "virtualFirstVisible" },
  );

  const stuck = createMemo(() => headerAbove(firstVisible()), { name: "virtualStuck" });

  createEffect(
    () => stuck(),
    (at) => {
      const entry = untrack(flat).entries[at];
      if (entry?.kind === "header") props.onActive?.(entry.section.key);
    },
  );

  const goTo = (sectionKey: string): void => {
    const at = untrack(flat).indexOfKey.get(`header:${sectionKey}`);
    if (at !== undefined) virtualizer.scrollToIndex(at, { align: "start" });
  };

  createEffect(
    () => props.ref,
    (give) => {
      give?.(goTo);
    },
  );

  // The focused row, scrolled to. The virtualizer answers from its own
  // geometry, which is exactly why this works on a row that is not rendered —
  // and a `scrollIntoView` on a DOM node that does not exist cannot.
  createEffect(
    () => props.focus,
    (key) => {
      if (key === undefined) return;
      const at = untrack(flat).indexOfKey.get(key);
      if (at !== undefined) virtualizer.scrollToIndex(at, { align: "auto" });
    },
  );

  /** The window, as the caller's keys: what the `<For>` reconciles on. */
  const windowed = createMemo(() => items().map((item) => String(item.key)), {
    name: "virtualWindow",
  });

  /** Where each key currently sits, for the row that reads its own place back. */
  const geometry = createMemo(
    () => {
      const at = new Map<string, number>();
      for (const item of items()) at.set(String(item.key), item.start);
      return at;
    },
    { name: "virtualGeometry" },
  );

  return (
    <div
      ref={setScroller}
      onScroll={(event) => setOffset(event.currentTarget.scrollTop)}
      data-virtual={props.sections.length}
      class={props.class ?? "min-h-0 min-w-0 flex-1 overflow-y-auto pe-1"}
    >
      <Show when={props.sections.length > 0} fallback={props.empty}>
        <div style={{ height: `${total()}px` }} class="relative">
          <For each={windowed()}>
            {(key) => {
              // Read back by KEY and not by the index the row was built at:
              // rows outlive the list they were built from, and an edit that
              // adds a section moves every index below it.
              const at = () => flat().indexOfKey.get(key);
              const entry = () => {
                const index = at();
                return index === undefined ? undefined : flat().entries[index];
              };
              const asHeader = () => {
                const held = entry();
                return held?.kind === "header" ? held : undefined;
              };
              const asRow = () => {
                const held = entry();
                return held?.kind === "row" ? held : undefined;
              };
              const isStuck = () => at() === stuck();
              const start = () => geometry().get(key) ?? 0;

              /**
               * The element the virtualizer measures, measured from the EFFECT
               * phase — see the header. `data-index` is re-stamped whenever
               * the row moves, because that attribute is how the library's
               * resize observer works out which item it is looking at.
               */
              const [measured, setMeasured] = createSignal<HTMLElement | undefined>(undefined, {
                name: "virtualMeasured",
              });
              createEffect(
                () => [measured(), at()] as const,
                ([element, index]) => {
                  if (element === undefined || index === undefined) return;
                  element.dataset.index = String(index);
                  virtualizer.measureElement(element);
                },
              );

              return (
                <>
                  <Show when={asHeader()}>
                    {(header) => (
                      // `sticky` cannot live inside a transform, so the stuck
                      // header is positioned by `sticky` and every other one by
                      // the transform the virtualizer computed.
                      <div
                        class={isStuck() ? "sticky top-0 z-20" : "absolute inset-x-0 top-0 z-10"}
                        style={isStuck() ? undefined : { transform: `translateY(${start()}px)` }}
                      >
                        {props.header(() => header().section, setMeasured)}
                      </div>
                    )}
                  </Show>
                  <Show when={asRow()}>
                    {(row) => (
                      <div
                        ref={setMeasured}
                        class="absolute inset-x-0 top-0"
                        style={{ transform: `translateY(${start()}px)` }}
                      >
                        {props.row(() => row().row.item, key)}
                      </div>
                    )}
                  </Show>
                </>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
