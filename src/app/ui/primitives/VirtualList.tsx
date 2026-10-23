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

import { AIMING, aimStep, compensates, heldOffset, rebuild, type Aim } from "./virtualScroll";

export interface VirtualRow<T> {
  readonly key: string;
  readonly item: T;
  readonly estimate: number;
}

export interface VirtualSection<T> {
  readonly key: string;
  readonly rows: readonly VirtualRow<T>[];
}

interface Entry<T> {
  readonly key: string;
  readonly row: VirtualRow<T>;
}

const OVERSCAN = 8;

export interface VirtualListProps<T> {
  readonly sections: readonly VirtualSection<T>[];
  readonly row: (item: Accessor<T>, key: string) => JSX.Element;
  readonly pinned?: string;
  readonly focus?: string;
  readonly class?: string;
  readonly role?: "rowgroup" | "list";
  readonly empty?: JSX.Element;
  readonly ref?: (scrollTo: (key: string) => void) => void;
}

export function VirtualList<T>(props: VirtualListProps<T>) {
  const [scroller, setScroller] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "virtualScroller",
  });
  const [offset, setOffset] = createSignal(0, { name: "virtualOffset" });

  let lastSections: readonly VirtualSection<T>[] | undefined;
  let lastFlat:
    | {
        readonly entries: readonly Entry<T>[];
        readonly indexOfKey: ReadonlyMap<string, number>;
        readonly startOfSection: ReadonlyMap<string, number>;
      }
    | undefined;
  const flat = createMemo(
    () => {
      const sections = props.sections;
      if (
        lastFlat !== undefined &&
        lastSections !== undefined &&
        lastSections.length === sections.length &&
        lastSections.every((section, at) => section === sections[at])
      )
        return lastFlat;
      const entries: Entry<T>[] = [];
      const indexOfKey = new Map<string, number>();
      const startOfSection = new Map<string, number>();
      for (const section of sections) {
        if (section.rows.length > 0) startOfSection.set(section.key, entries.length);
        for (const row of section.rows) {
          indexOfKey.set(row.key, entries.length);
          entries.push({ key: row.key, row });
        }
      }
      lastSections = sections;
      lastFlat = { entries, indexOfKey, startOfSection };
      return lastFlat;
    },
    { name: "virtualFlat" },
  );

  const [items, setItems] = createSignal<readonly VirtualItem[]>([], { name: "virtualItems" });
  const [total, setTotal] = createSignal(0, { name: "virtualTotal" });

  let onScreen: readonly string[] = [];

  const remember = (window: readonly VirtualItem[]): void => {
    onScreen = window.map((item) => String(item.key));
    setItems(window);
  };

  let publishing = false;

  const optionsOf = (): VirtualizerOptions<HTMLDivElement, HTMLElement> => ({
    count: untrack(flat).entries.length,
    // Untracked on purpose: a one-time read, not a dependency (Solid 2: STRICT_READ_UNTRACKED).
    getScrollElement: () => untrack(scroller) ?? null,
    estimateSize: (index: number) => {
      return untrack(flat).entries[index]?.row.estimate ?? 0;
    },
    getItemKey: (index: number) => untrack(flat).entries[index]?.key ?? index,
    overscan: OVERSCAN,
    rangeExtractor: (range: Range) => {
      const keep = new Set(defaultRangeExtractor(range));
      // Untracked on purpose: a one-time read, not a dependency (Solid 2: STRICT_READ_UNTRACKED).
      const pinned = untrack(() => props.pinned);
      const pinnedAt = pinned === undefined ? undefined : untrack(flat).indexOfKey.get(pinned);
      if (pinnedAt !== undefined) keep.add(pinnedAt);
      return [...keep].sort((a, b) => a - b);
    },
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    onChange: (instance) => {
      instance._willUpdate();
      if (publishing) return;
      publishing = true;
      queueMicrotask(() => {
        publishing = false;
        remember(instance.getVirtualItems());
        setTotal(instance.getTotalSize());
      });
    },
    measureElement: (element, entry, instance) => {
      const box = entry?.borderBoxSize[0];
      if (box !== undefined) return Math.round(box.blockSize);
      const index = instance.indexFromElement(element);
      return (
        instance.itemSizeCache.get(instance.options.getItemKey(index)) ??
        instance.options.estimateSize(index)
      );
    },
  });

  const virtualizer = new Virtualizer(optionsOf());

  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
    const pinned = untrack(() => props.pinned);
    return compensates({
      index: item.index,
      remeasured: instance.itemSizeCache.has(item.key),
      start: item.start,
      size: item.size,
      pinnedIndex: pinned === undefined ? undefined : untrack(flat).indexOfKey.get(pinned),
      fold: (instance.scrollOffset ?? 0) + instance.scrollAdjustments,
    });
  };

  const publish = (): void => {
    virtualizer._willUpdate();
    remember(virtualizer.getVirtualItems());
    setTotal(virtualizer.getTotalSize());
  };

  // onCleanup in the component body: one inside an effect callback never runs (NO_OWNER_CLEANUP).
  let unmount: (() => void) | undefined;
  onCleanup(() => {
    unmount?.();
    unmount = undefined;
  });

  let drawn: ReturnType<typeof flat> | undefined;

  createEffect(
    () => [scroller(), flat()] as const,
    ([element, list]) => {
      if (element === undefined) return;
      const place = rebuild(
        onScreen,
        untrack(() => props.pinned),
        (key) => list.indexOfKey.has(key),
      );
      const startIn = (held: typeof list | undefined, key: string): number | undefined => {
        const index = held?.indexOfKey.get(key);
        return index === undefined ? undefined : virtualizer.measurementsCache[index]?.start;
      };
      const before = place.kind === "hold" ? startIn(drawn, place.anchor) : undefined;
      virtualizer.setOptions(optionsOf());
      unmount ??= virtualizer._didMount();
      drawn = list;
      if (place.kind === "top" && untrack(offset) > 0) {
        virtualizer.scrollToOffset(0);
        setOffset(0);
      }
      if (place.kind === "hold" && before !== undefined) {
        virtualizer.getVirtualItems();
        const scrollTop = virtualizer.scrollOffset ?? 0;
        const next = heldOffset(scrollTop, before, startIn(list, place.anchor));
        if (next !== scrollTop) virtualizer.scrollToOffset(next);
      }
      publish();
    },
  );

  let aiming: number | undefined;
  const stopAiming = (): void => {
    if (aiming !== undefined) cancelAnimationFrame(aiming);
    aiming = undefined;
  };
  onCleanup(stopAiming);

  const aim = (index: number): void => {
    stopAiming();
    virtualizer.scrollToIndex(index, { align: "start" });
    let state: Aim = AIMING;
    const frame = (): void => {
      const element = untrack(scroller);
      const step = aimStep(
        state,
        element?.scrollTop ?? 0,
        element === undefined ? undefined : virtualizer.getOffsetForIndex(index, "start")?.[0],
      );
      state = step.aim;
      if (step.scrollTo !== undefined) virtualizer.scrollToOffset(step.scrollTo);
      if (state.kind === "settled") return stopAiming();
      aiming = requestAnimationFrame(frame);
    };
    aiming = requestAnimationFrame(frame);
  };

  const goTo = (key: string): void => {
    const held = untrack(flat);
    const at = held.startOfSection.get(key) ?? held.indexOfKey.get(key);
    if (at !== undefined) aim(at);
  };

  createEffect(
    () => props.ref,
    (give) => {
      give?.(goTo);
    },
  );

  createEffect(
    () => props.focus,
    (key) => {
      if (key === undefined) return;
      const at = untrack(flat).indexOfKey.get(key);
      if (at !== undefined) virtualizer.scrollToIndex(at, { align: "auto" });
    },
  );

  const windowed = createMemo(() => items().map((item) => String(item.key)), {
    name: "virtualWindow",
  });

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
      onWheel={stopAiming}
      onTouchStart={stopAiming}
      onPointerDown={stopAiming}
      onKeyDown={stopAiming}
      data-virtual={props.sections.length}
      role={props.role}
      class={props.class ?? "scrollbar-padded -me-4 min-h-0 min-w-0 flex-1 overflow-y-auto"}
    >
      <Show when={props.sections.length > 0} fallback={props.empty}>
        <div style={{ height: `${total()}px` }} class="relative">
          <For each={windowed()}>
            {(key) => {
              const at = () => flat().indexOfKey.get(key);
              const entry = () => {
                const index = at();
                return index === undefined ? undefined : flat().entries[index];
              };
              const start = () => geometry().get(key) ?? 0;

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
                <Show when={entry()}>
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
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
