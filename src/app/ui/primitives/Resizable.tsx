/**
 * The resizable split: `Resizable.Root`, `Resizable.Panel`, `Resizable.Handle`.
 *
 * This one is OURS, and that is the exception in this directory. It was written
 * against `@corvu-next/resizable` first, and that library does not survive
 * Solid 2 RC: `registerPanel` fills its `sizesToIds` index INSIDE a signal
 * updater, Solid 2 runs that updater lazily, and the handle's `ariaInformation`
 * memo then asks a panel for the size at index `-1` and dies on `undefined`
 * ("Cannot read properties of undefined (reading 'endsWith')"). The same
 * library's tooltip, popover and dialog are fine and are used as intended; only
 * the split needed replacing, and a split is a hundred lines.
 *
 * Its shape is corvu's on purpose, so swapping back when corvu supports Solid 2
 * is an import change in this file and nothing else.
 *
 * How it works: panels register into the root DURING render — components run
 * once in Solid, in document order, so registration order IS layout order and
 * nothing has to be measured to learn it. Sizes are fractions of 1 along the
 * axis; a drag converts pixels to a fraction against the root's measured size
 * and moves exactly two neighbours, so the total is conserved and no panel can
 * be resized by a handle it does not touch.
 *
 * NOT implemented: collapsing. A collapsible pane is a shell decision (the
 * sidebar becomes an icon rail — a different tree, not a zero-width panel), so
 * it belongs where that tree is built.
 */

import type { JSX } from "@solidjs/web";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import {
  For,
  Show,
  createContext,
  createEffect,
  createSignal,
  untrack,
  useContext,
} from "solid-js";

import { cx, type ClassValue } from "./cx";

/** What a panel tells the root about itself, once, at registration. */
interface PanelSpec {
  readonly initialSize?: number;
  readonly minSize: number;
  readonly maxSize: number;
  readonly onCollapse?: () => void;
}

interface SplitContext {
  readonly orientation: "horizontal" | "vertical";
  /** Registers a panel and answers its index. */
  readonly addPanel: (spec: PanelSpec) => number;
  /** Registers a handle and answers the index of the panel before it. */
  readonly addHandle: () => number;
  readonly sizeOf: (index: number) => number;
  readonly setRoot: (element: HTMLDivElement) => void;
  /** Moves `pixels` of the axis across the boundary after panel `before`. */
  readonly drag: (before: number, pixels: number) => void;
  /** The drag let go: clears the collapse hint. */
  readonly end: () => void;
  /**
   * How far a collapsible panel has been pulled past its minimum, 0–1, where
   * 1 closes it; undefined for any other panel, or when none is being pulled.
   */
  readonly pullOf: (index: number) => number | undefined;
  /** Snapshots the sizes, so a drag is measured from where it started. */
  readonly begin: () => void;
}

const SplitContextValue = createContext<SplitContext>();

const useSplit = (): SplitContext => {
  const held = useContext(SplitContextValue);
  if (held === undefined) {
    throw new Error("Resizable.Panel and Resizable.Handle must be inside Resizable.Root");
  }
  return held;
};

/** Spreads what no panel claimed, so the fractions sum to 1. */
const normalise = (specs: readonly PanelSpec[]): readonly number[] => {
  const named = specs.map((spec) => spec.initialSize);
  const claimed = named.reduce<number>((total, size) => total + (size ?? 0), 0);
  const free = named.filter((size) => size === undefined).length;
  const each = free === 0 ? 0 : Math.max(0, 1 - claimed) / free;
  return named.map((size) => size ?? each);
};

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

interface ResizableRootProps {
  readonly orientation?: "horizontal" | "vertical";
  readonly onSizesChange?: (sizes: readonly number[]) => void;
  readonly class?: ClassValue;
  readonly children: JSX.Element;
}

function Root(props: ResizableRootProps) {
  // Read once: a split does not change axis, and making it reactive would mean
  // re-registering every panel against a value that never moves.
  const staticOrientation = untrack(() => props.orientation ?? "horizontal");

  const specs: PanelSpec[] = [];
  const [sizes, setSizes] = createSignal<readonly number[]>([], { name: "splitSizes" });
  const [root, setRoot] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "splitRoot",
  });
  let started: readonly number[] = [];
  /** Set once a drag has collapsed its panel, so it collapses it only once. */
  let collapsed = false;
  const [pull, setPull] = createSignal<
    { readonly index: number; readonly amount: number } | undefined
  >(undefined, { name: "splitPull" });

  // Panels register during render, so the fractions are knowable only once the
  // tree exists — and the root's ref is set after its children are built, which
  // makes it the moment. (Solid 2 has no `onMount`; an effect on the ref is the
  // same fact, said in the API that is there.)
  createEffect(
    () => root(),
    (element) => {
      if (element !== undefined) setSizes(normalise(specs));
    },
  );

  const axisSize = (): number => {
    const element = root();
    if (element === undefined) return 0;
    return staticOrientation === "horizontal" ? element.offsetWidth : element.offsetHeight;
  };

  const context: SplitContext = {
    orientation: staticOrientation,
    addPanel: (spec) => specs.push(spec) - 1,
    addHandle: () => specs.length - 1,
    sizeOf: (index) => sizes()[index] ?? 0,
    setRoot,
    begin: () => {
      started = sizes();
      collapsed = false;
    },
    end: () => setPull(undefined),
    pullOf: (index) => {
      const held = pull();
      return held !== undefined && held.index === index ? held.amount : undefined;
    },
    drag: (before, pixels) => {
      const total = axisSize();
      const first = specs[before];
      const second = specs[before + 1];
      const from = started[before];
      const to = started[before + 1];
      if (total === 0) return;
      if (first === undefined || second === undefined || from === undefined || to === undefined) {
        return;
      }
      if (collapsed) return;
      // A collapsible panel dragged more than half its minimum PAST that
      // minimum closes instead.
      const wanted = from + pixels / total;
      // Between the minimum and the point that closes it the panel no longer
      // moves, so the pull is reported and the panel says what will happen.
      if (first.onCollapse !== undefined && wanted < first.minSize && first.minSize > 0)
        setPull({
          index: before,
          amount: Math.min(1, (first.minSize - wanted) / (first.minSize / 2)),
        });
      else setPull(undefined);
      if (first.onCollapse !== undefined && wanted < first.minSize / 2) {
        collapsed = true;
        setPull(undefined);
        // Back to the sizes the drag started from, so showing the panel
        // again brings it back as it was, not squeezed to its minimum.
        setSizes(started);
        props.onSizesChange?.(started);
        first.onCollapse();
        return;
      }
      // The pair's share is fixed; the boundary only decides how to split it.
      const room = from + to;
      const next = clamp(
        clamp(from + pixels / total, first.minSize, first.maxSize),
        room - second.maxSize,
        room - second.minSize,
      );
      const moved = [...started];
      moved[before] = next;
      moved[before + 1] = room - next;
      setSizes(moved);
      props.onSizesChange?.(moved);
    },
  };

  return (
    <SplitContextValue value={context}>
      <div
        ref={context.setRoot}
        data-orientation={staticOrientation}
        class={cx(
          "flex size-full",
          staticOrientation === "vertical" ? "flex-col" : "flex-row",
          props.class,
        )}
      >
        {props.children}
      </div>
    </SplitContextValue>
  );
}

interface ResizablePanelProps {
  /** A fraction of 1. Panels that name none share what is left, equally. */
  readonly initialSize?: number;
  readonly minSize?: number;
  readonly maxSize?: number;
  /**
   * Called when a drag takes this panel well below its minimum — the caller
   * hides it. Only the panel BEFORE a handle can collapse this way.
   */
  readonly onCollapse?: () => void;
  /**
   * What the panel says while it is being pulled closed — past its minimum,
   * not yet closed. Given with `onCollapse`; without it there is no overlay.
   */
  readonly collapseHint?: { readonly title: string; readonly detail: string };
  readonly class?: ClassValue;
  readonly children: JSX.Element;
}

/** The collapse hint's chevrons, left to right; index 0 is the leftmost. */
const CHEVRONS = [0, 1, 2, 3, 4] as const;

function Panel(props: ResizablePanelProps) {
  const split = useSplit();
  // Read once, like the orientation: a panel registers its bounds when it
  // mounts, and the split does not re-register a panel whose bounds move.
  const index = untrack(() =>
    split.addPanel({
      initialSize: props.initialSize,
      minSize: props.minSize ?? 0,
      maxSize: props.maxSize ?? 1,
      onCollapse: props.onCollapse,
    }),
  );

  return (
    <div
      data-resizable-panel={index}
      style={{ "flex-basis": `${split.sizeOf(index) * 100}%` }}
      class={cx("relative min-h-0 min-w-0 shrink grow-0 overflow-hidden", props.class)}
    >
      {props.children}
      <Show when={props.collapseHint !== undefined && split.pullOf(index)}>
        {(amount) => (
          <div
            data-collapse-hint=""
            role="status"
            class="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-surface-invert/85 p-4 text-center"
          >
            <p class="text-body font-semibold text-on-surface-invert">
              {props.collapseHint?.title}
            </p>
            <p class="text-small text-on-surface-invert-muted">{props.collapseHint?.detail}</p>
            {/* The pull, as chevrons pointing the way to close: they light
                from the right as the drag goes on, all lit just before it
                closes. */}
            <div aria-hidden="true" class="flex items-center">
              <For each={CHEVRONS}>
                {(step) => (
                  <ChevronLeft
                    size={24}
                    strokeWidth={2.5}
                    class={cx(
                      "-mx-1 transition-colors",
                      amount() * CHEVRONS.length > CHEVRONS.length - 1 - step
                        ? "text-on-surface-invert"
                        : "text-on-surface-invert-muted/40",
                    )}
                  />
                )}
              </For>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

interface ResizableHandleProps {
  /** Names the divider for a screen reader. */
  readonly label?: string;
  /**
   * Sit ON the edge between the panels instead of between them: no width of
   * its own, a 12px grab area straddling the edge, and a line that shows only
   * on hover, focus or drag — for a panel whose own border already draws the
   * edge. Without it the handle is a gutter with a hairline down the middle.
   */
  readonly edge?: boolean;
  readonly class?: ClassValue;
}

function Handle(props: ResizableHandleProps) {
  const split = useSplit();
  const before = split.addHandle();
  const vertical = split.orientation === "vertical";
  const [dragging, setDragging] = createSignal(false, { name: "splitDragging" });

  const nudge = (pixels: number): void => {
    split.begin();
    split.drag(before, pixels);
  };

  return (
    <div
      role="separator"
      tabindex={0}
      aria-label={props.label}
      aria-orientation={vertical ? "horizontal" : "vertical"}
      data-dragging={dragging() ? "" : undefined}
      class={cx(
        "group relative flex shrink-0 items-stretch justify-center",
        vertical ? "cursor-row-resize flex-col" : "cursor-col-resize",
        props.edge === true ? "z-10" : vertical ? "py-1" : "px-1",
        props.edge === true && (vertical ? "h-0" : "w-0"),
        props.class,
      )}
      onPointerDown={(event) => {
        event.preventDefault();
        const origin = vertical ? event.clientY : event.clientX;
        split.begin();
        setDragging(true);
        const move = (moving: PointerEvent): void => {
          split.drag(before, (vertical ? moving.clientY : moving.clientX) - origin);
        };
        const stop = (): void => {
          setDragging(false);
          split.end();
          document.removeEventListener("pointermove", move);
          document.removeEventListener("pointerup", stop);
        };
        // On the document, not the handle: the pointer leaves a 2px divider on
        // the first frame of any real drag.
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", stop);
      }}
      onKeyDown={(event) => {
        // 24px a press — the same gesture as the drag, in one readable step.
        if (event.key === (vertical ? "ArrowUp" : "ArrowLeft")) nudge(-24);
        else if (event.key === (vertical ? "ArrowDown" : "ArrowRight")) nudge(24);
        else return;
        event.preventDefault();
      }}
    >
      {/* The grab area of an edge handle: wider than the line, centred on
          the edge, over both panels. Events bubble to the separator. */}
      {props.edge === true && (
        <span
          aria-hidden="true"
          class={cx("absolute", vertical ? "inset-x-0 -inset-y-1.5" : "inset-y-0 -inset-x-1.5")}
        />
      )}
      <span
        aria-hidden="true"
        class={cx(
          "rounded-full transition-colors",
          props.edge === true
            ? cx(
                "absolute bg-transparent",
                vertical
                  ? "inset-x-0 top-1/2 h-0.5 -translate-y-1/2"
                  : "inset-y-0 start-1/2 w-0.5 -translate-x-1/2",
              )
            : cx("bg-surface-border", vertical ? "h-px w-full" : "w-px"),
          "group-hover:bg-brand group-focus-visible:bg-brand group-data-dragging:bg-brand",
        )}
      />
    </div>
  );
}

export const Resizable = { Root, Panel, Handle };
