import {
  type CardMount,
  type EditorBook,
  type EditorPolicy,
  type Following,
  type MarkedRange,
} from "@sefer/editor";
import { tocUnits, unitIndexAt } from "@sefer/text/location/locate";
import type { JSX } from "@solidjs/web";
import ChevronDownIcon from "lucide-solid/icons/chevron-down";
import ChevronUpIcon from "lucide-solid/icons/chevron-up";
import ChevronsDownIcon from "lucide-solid/icons/chevrons-down";
import ChevronsUpIcon from "lucide-solid/icons/chevrons-up";
import CodeIcon from "lucide-solid/icons/code";
import SquareArrowOutUpRightIcon from "lucide-solid/icons/square-arrow-out-up-right";
import { Show, createEffect, createMemo, createSignal } from "solid-js";

import {
  pairedExcerpt,
  type BookText,
  type Excerpt,
  type Occurrence,
} from "#core/excerpts/excerpts";
import { tocViewOf, type Analysis } from "#core/galley";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { CardActions, type CardAction } from "../multibuffer/CardAction";
import { CardEditor } from "../multibuffer/CardEditor";
import { CardFrame } from "../multibuffer/CardFrame";
import type { CardEvent, CardView, ContextStep } from "../multibuffer/cardState";
import { ContextControl } from "../multibuffer/ContextControl";
import { cardPolicy } from "../multibuffer/policy";
import { Button, cx, IconButton } from "../primitives";
import { verseTextOf } from "../review/reading";
import type { ExcerptCardSpec } from "./cardSpec";
import { ExcerptReader } from "./ExcerptReader";

export type { ContextStep } from "../multibuffer/cardState";

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
  readonly editing: boolean;
  readonly onEdit: () => void;
  readonly onDone: () => void;
  readonly spec: ExcerptCardSpec;
  readonly rowKey: string;
  readonly seat: () => Promise<EditorBook | undefined>;
  readonly analyze: (text: string) => Analysis;
  readonly follow?: Following | undefined;
  readonly paired?: Paired | undefined;
  readonly active?: number;
  readonly mode?: "regular" | "usfm";
  readonly gone?: string | undefined;
  readonly view: CardView;
  readonly onView: (event: CardEvent) => void;
  readonly nearby?: readonly Occurrence[];
}

export type MarkTone = "error" | "warning" | "info";

const SIDE_BY_SIDE = 720;

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
  const [opening, setOpening] = createSignal(false, { name: "excerptOpening" });
  const [refused, setRefused] = createSignal(false, { name: "excerptRefused" });
  const [at, setAt] = createSignal<number | undefined>(undefined, { name: "excerptCaret" });
  const [point, setPoint] = createSignal<{ x: number; y: number } | undefined>(undefined, {
    name: "excerptPoint",
  });
  const [body, setBody] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "excerptBody",
  });
  const [wide, setWide] = createSignal(true, { name: "excerptWide" });
  const layout = (): "single" | "side" | "stacked" => {
    if (props.paired === undefined) return "single";
    return wide() ? "side" : "stacked";
  };
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

  const current = (): boolean =>
    props.active !== undefined && props.excerpt.hits.some((hit) => hit.from === props.active);

  const direct = (): boolean => props.spec.edit.kind === "direct";
  const chapterOpen = (): boolean => props.excerpt.extent.chapter === true;
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
    if (targetBox !== undefined) {
      setHold(targetBox.offsetHeight);
      requestAnimationFrame(() => requestAnimationFrame(() => setHold(undefined)));
    } else setHold(undefined);
    setBook(undefined);
    setAt(undefined);
    props.onDone();
  };

  const [dirty, setDirty] = createSignal(false, { name: "excerptDirty" });
  let editCard: CardMount | undefined;
  const save = (): void => {
    setDirty(false);
    done();
  };
  const cancel = (): void => {
    if (dirty()) editCard?.session?.cancel();
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

  const [hold, setHold] = createSignal<number | undefined>(undefined, { name: "excerptHold" });
  let targetBox: HTMLDivElement | undefined;
  createEffect(
    () => props.editing && book() !== undefined,
    (drawn) => {
      if (!drawn) return;
      requestAnimationFrame(() => requestAnimationFrame(() => setHold(undefined)));
    },
  );

  const gutter = (): boolean => direct() && spec().context.kind === "chapter" && !condensed();
  const doubled = (): boolean => {
    const held = spec().context;
    const from = held.kind === "chapter" ? held.from : { up: 0, down: 0 };
    const { up, down } = props.excerpt.extent;
    return up - from.up + (down - from.down) >= 2;
  };
  const verseLabel = (side: "up" | "down"): string => {
    const all = tocUnits(tocViewOf(props.excerpt.analysis));
    const { span, own } = props.excerpt;
    const home = all[unitIndexAt(all, own.from)];
    const next =
      side === "up" ? all[unitIndexAt(all, span.from) - 1] : all[unitIndexAt(all, span.to - 1) + 1];
    const verse = next?.verse;
    if (verse === undefined || verse.first === 0 || next?.row !== home?.row) return t("Show Verse");
    const label = verse.last > verse.first ? `${verse.first}-${verse.last}` : `${verse.first}`;
    return t("Show Verse {verse}", { verse: label });
  };
  const stepLabel = (side: "up" | "down"): string => {
    if (chapterOpen()) return t("Show fewer verses");
    if (doubled()) return t("Show the whole chapter");
    return verseLabel(side);
  };
  const stepIcon = (side: "up" | "down") => {
    if (chapterOpen()) return side === "up" ? <ChevronsDownIcon /> : <ChevronsUpIcon />;
    if (doubled()) return side === "up" ? <ChevronsUpIcon /> : <ChevronsDownIcon />;
    return side === "up" ? <ChevronUpIcon /> : <ChevronDownIcon />;
  };
  const contextStep = (which: ContextStep): void => {
    const held = spec().context;
    if (held.kind === "chapter") held.step(props.excerpt.sid, which);
  };

  let reveal: ((at: number) => void) | undefined;
  createEffect(
    () => chapterOpen(),
    (open) => {
      if (!open) return;
      const timer = setTimeout(() => {
        const at = props.excerpt.own.from;
        if (props.editing && editCard !== undefined)
          editCard.reveal({ from: at }, { scroll: "start" });
        else reveal?.(at);
      }, 300);
      return () => clearTimeout(timer);
    },
  );

  createEffect(
    () => (direct() && props.editing ? targetBox : undefined),
    (element) => {
      if (element === undefined) return;
      const press = (event: PointerEvent): void => {
        if (!props.editing || !(event.target instanceof Element)) return;
        const card = event.target.closest("[data-sid]");
        if (card !== null && card.getAttribute("data-sid") !== props.excerpt.sid) cancel();
      };
      document.addEventListener("pointerdown", press, true);
      return () => document.removeEventListener("pointerdown", press, true);
    },
  );

  const target = (
    <Show when={props.editing} fallback={reader()}>
      <Show
        when={book()}
        fallback={
          <Show when={refused()} fallback={reader()}>
            <p class="px-3 py-2 text-small text-on-surface-primary">
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
            session={direct()}
            onEditor={(card) => {
              editCard = card;
              setDirty(card?.session?.dirty() ?? false);
              card?.session?.onDirty(setDirty);
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
      <Show when={pairedText()}>
        {(text) => (
          <Show
            when={pairedView()}
            fallback={
              <p class="px-3 py-2 text-small text-on-surface-primary italic">
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
          <p class="px-3 py-2 text-small text-on-surface-primary italic">{missing().message}</p>
        )}
      </Show>
    </section>
  );

  const spec = (): ExcerptCardSpec => props.spec;
  const condensable = (): boolean => props.spec.condensed !== undefined;
  const condensed = (): boolean => props.spec.condensed?.(props.excerpt, props.rowKey) === true;
  const status = (): JSX.Element | undefined => props.spec.status?.(props.excerpt, props.rowKey);
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
        setTimeout(() => setOpening(false), 600);
      },
    };
  };

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
        data={{
          "data-sid": props.excerpt.sid,
          "data-mode": mode(),
          "data-condensed": condensed() ? "" : undefined,
        }}
        current={current()}
        condensed={condensed()}
        onActivate={() => props.spec.onActivate?.(props.excerpt, props.rowKey)}
        title={spec().title?.(props.excerpt, props.rowKey, props.view) ?? props.excerpt.label}
        gone={props.gone}
        info={
          <>
            <Show when={status()}>{(mark) => <span class="flex shrink-0">{mark()}</span>}</Show>
            {spec().info?.(props.excerpt, props.rowKey, props.view)}

            <Show when={notes() === undefined && props.excerpt.hits.length > 1}>
              <span class="text-small text-on-surface-primary">
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
        <div
          class={cx(collapsible, condensed() ? "grid-rows-[0fr]" : "grid-rows-[1fr]")}
          inert={condensed()}
        >
          <div class={cx("min-h-0 overflow-hidden", !condensed() && "-mb-2 pb-2")}>
            <div
              ref={setBody}
              data-layout={layout()}
              class={cx(
                props.paired !== undefined && "grid gap-2",
                props.paired !== undefined && !direct() && "p-2",
                props.paired !== undefined && (wide() ? "grid-cols-2 items-start" : "grid-cols-1"),
              )}
            >
              <Show when={props.paired !== undefined}>{pairedSide}</Show>

              <div class={cx("flex min-w-0 flex-col", direct() ? "gap-3" : "gap-2")}>
                <div
                  ref={(element: HTMLDivElement) => {
                    targetBox = element;
                  }}
                  style={hold() === undefined ? undefined : { "min-height": `${hold()}px` }}
                  data-direct-target={direct() ? "" : undefined}
                  data-editing={direct() && props.editing ? "" : undefined}
                  data-chapter={direct() && chapterOpen() ? "" : undefined}
                  data-gutter={gutter() ? "" : undefined}
                  class={cx(
                    "min-w-0",
                    direct() && "flex cursor-pointer overflow-hidden rounded-3xl",
                  )}
                >
                  <Show when={gutter()}>
                    <div class="flex w-12 shrink-0 flex-col justify-between py-1">
                      <IconButton
                        variant="bare"
                        data-step={chapterOpen() || doubled() ? "chapter" : "up"}
                        label={stepLabel("up")}
                        icon={stepIcon("up")}
                        disabled={!chapterOpen() && !doubled() && !props.excerpt.more.up}
                        onClick={() => contextStep(chapterOpen() || doubled() ? "chapter" : "up")}
                      />
                      <IconButton
                        variant="bare"
                        data-step={chapterOpen() || doubled() ? "chapter" : "down"}
                        label={stepLabel("down")}
                        icon={stepIcon("down")}
                        disabled={!chapterOpen() && !doubled() && !props.excerpt.more.down}
                        onClick={() => contextStep(chapterOpen() || doubled() ? "chapter" : "down")}
                      />
                    </div>
                  </Show>
                  <div
                    class={cx(
                      "min-w-0 flex-1",
                      chapterOpen() &&
                        "scrollbar-padded max-h-[var(--card-room,60vh)] overflow-y-auto",
                      direct() && !gutter() && "m-[3.5px] rounded-[8.5px]",
                    )}
                  >
                    {target}
                  </div>
                  <Show when={gutter()}>
                    <div
                      aria-hidden="true"
                      class={cx("shrink-0", chapterOpen() ? "w-8" : "w-12")}
                    />
                  </Show>
                </div>
                <Show when={direct()}>
                  <div data-card-actions class="flex items-center gap-controls">
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
