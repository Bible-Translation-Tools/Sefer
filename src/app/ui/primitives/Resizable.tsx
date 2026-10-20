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

interface PanelSpec {
  readonly initialSize?: number;
  readonly minSize: number;
  readonly maxSize: number;
  readonly onCollapse?: () => void;
}

interface SplitContext {
  readonly orientation: "horizontal" | "vertical";
  readonly addPanel: (spec: PanelSpec) => number;
  readonly addHandle: () => number;
  readonly sizeOf: (index: number) => number;
  readonly setRoot: (element: HTMLDivElement) => void;
  readonly drag: (before: number, pixels: number) => void;
  readonly end: () => void;
  readonly pullOf: (index: number) => number | undefined;
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
  const staticOrientation = untrack(() => props.orientation ?? "horizontal");

  const specs: PanelSpec[] = [];
  const [sizes, setSizes] = createSignal<readonly number[]>([], { name: "splitSizes" });
  const [root, setRoot] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "splitRoot",
  });
  let started: readonly number[] = [];
  let collapsed = false;
  const [pull, setPull] = createSignal<
    { readonly index: number; readonly amount: number } | undefined
  >(undefined, { name: "splitPull" });

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
      const wanted = from + pixels / total;
      if (first.onCollapse !== undefined && wanted < first.minSize && first.minSize > 0)
        setPull({
          index: before,
          amount: Math.min(1, (first.minSize - wanted) / (first.minSize / 2)),
        });
      else setPull(undefined);
      if (first.onCollapse !== undefined && wanted < first.minSize / 2) {
        collapsed = true;
        setPull(undefined);
        setSizes(started);
        props.onSizesChange?.(started);
        first.onCollapse();
        return;
      }
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
  readonly initialSize?: number;
  readonly minSize?: number;
  readonly maxSize?: number;
  readonly onCollapse?: () => void;
  readonly collapseHint?: { readonly title: string; readonly detail: string };
  readonly class?: ClassValue;
  readonly children: JSX.Element;
}

const CHEVRONS = [0, 1, 2, 3, 4] as const;

function Panel(props: ResizablePanelProps) {
  const split = useSplit();
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
            class="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-surface-overlay p-4 text-center"
          >
            <p class="text-body font-semibold text-on-surface-invert">
              {props.collapseHint?.title}
            </p>
            <p class="text-small text-on-surface-invert-muted">{props.collapseHint?.detail}</p>

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
  readonly label?: string;
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
    split.end();
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
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", stop);
      }}
      onKeyDown={(event) => {
        if (event.key === (vertical ? "ArrowUp" : "ArrowLeft")) nudge(-24);
        else if (event.key === (vertical ? "ArrowDown" : "ArrowRight")) nudge(24);
        else return;
        event.preventDefault();
      }}
    >
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
