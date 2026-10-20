import type { EditorBook } from "@sefer/editor";
import type { BookId } from "@sefer/text/book";
import type { JSX } from "@solidjs/web";
import { Effect } from "effect";
import { Show, createMemo, createSignal, onCleanup, untrack } from "solid-js";

import type { Analysis, DecisionUnit, MergeSide } from "#core/galley";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import { estimate, type Controls, type Hunk } from "../diff";
import type { CardAction } from "../multibuffer/CardAction";
import type { ContextStep } from "../multibuffer/cardState";
import { createCardViews } from "../multibuffer/cardViews";
import { EmptyState, type VirtualSection } from "../primitives";
import { claimSidebar } from "../workspace/sidebarSlot";
import { BooksSidebar } from "./reader/BooksSidebar";
import { ChangeCards, type CardItem } from "./reader/ChangeCards";
import { createChapterNav } from "./reader/createChapterNav";
import { createCursor } from "./reader/createCursor";
import { createPrepared } from "./reader/createPrepared";
import { createSeats } from "./reader/createSeats";
import { DecideAll } from "./reader/DecideAll";
import { chaptersOf, chapterWords, labelOf, toLayout } from "./reader/helpers";
import { ReaderToolbar } from "./reader/ReaderToolbar";
import {
  AUTO_SPLIT_PX,
  type Filter,
  type Layout,
  type Prepared,
  type ReviewBook,
  type Scope,
} from "./reader/types";
import { WholeBook } from "./reader/WholeBook";

export type { ReviewBook };

export function ReviewReader(props: {
  readonly books: readonly ReviewBook[];
  readonly decision: (bookId: BookId, unitId: string) => MergeSide | undefined;
  readonly decide: (
    bookId: BookId,
    units: readonly DecisionUnit[],
    side: MergeSide | undefined,
  ) => void;
  readonly decidable: boolean;
  readonly usfm: boolean;
  readonly onUsfm: (on: boolean) => void;
  readonly originOf?: (
    bookId: BookId,
    units: readonly DecisionUnit[],
  ) => "there" | "here" | "both" | undefined;
  readonly currentLabel: string | ((bookId: BookId) => string);
  readonly baselineLabel: string | ((bookId: BookId) => string);
  readonly currentShort: string;
  readonly baselineShort: string;
  readonly selected: BookId | undefined;
  readonly onSelect: (bookId: BookId) => void;
  readonly seat: (bookId: BookId) => Promise<EditorBook | undefined>;
  readonly onEdited: (bookId: BookId) => void;
  readonly onEditing?: (editing: boolean) => void;
  readonly currentFirst?: boolean;
  readonly writesDecisions?: boolean;
  readonly dimUnchosen?: boolean;
  readonly claimSidebar?: boolean;
  readonly sides?: (
    hunk: Hunk,
    split: boolean,
  ) => {
    readonly baseline: readonly CardAction[];
    readonly current: readonly CardAction[];
    readonly below?: JSX.Element;
  };
}) {
  const shell = useShell();
  const { services } = shell;
  const observability = services.composition.observability;
  const keys = shellKeys(services.settings);

  const [layout, setLayoutSignal] = createSignal<Layout>(
    toLayout(services.settings.get(keys.reviewLayout)),
    { name: "reviewLayout" },
  );
  const [scope, setScopeSignal] = createSignal<Scope>(
    services.settings.get(keys.reviewScope) === "book" ? "book" : "changes",
    { name: "reviewScope" },
  );
  const [filter, setFilter] = createSignal<Filter>("all", { name: "reviewFilter" });
  const [width, setWidth] = createSignal(0, { name: "reviewWidth" });
  const [linked, setLinked] = createSignal(true, { name: "reviewLinked" });

  const setLayout = (value: Layout): void => {
    setLayoutSignal(value);
    void services.run(Effect.result(services.settings.set(keys.reviewLayout, value)));
  };
  const setScope = (value: Scope): void => {
    setScopeSignal(value);
    void services.run(Effect.result(services.settings.set(keys.reviewScope, value)));
  };

  const split = (): boolean =>
    layout() === "split" || (layout() === "auto" && width() >= AUTO_SPLIT_PX);

  const analyzers = new Map<string, (text: string) => Analysis>();
  const analysisOf = (bookId: BookId, side: "current" | "baseline", text: string): Analysis => {
    const key = `${side}\0${bookId}`;
    let analyze = analyzers.get(key);
    if (analyze === undefined) {
      analyze = services.galley.memoize();
      analyzers.set(key, analyze);
    }
    return analyze(text);
  };

  const views = createCardViews<never>("review");
  const expand = (key: string, step: ContextStep): void => {
    const steps = services.settings.get(keys.excerptContext);
    views.send(key, { kind: "step", step, from: { up: steps, down: steps } });
  };

  const prepared = createPrepared({
    books: () => props.books,
    decidable: () => props.decidable,
    filter,
    decision: (bookId, unitId) => props.decision(bookId, unitId),
    views,
    analysisOf,
    label: (address) => untrack(() => shell.location.label(address)),
    excerptSteps: () => services.settings.get(keys.excerptContext),
    observability,
  });

  const selectedBook = (): Prepared | undefined =>
    prepared().find((held) => held.book.bookId === props.selected) ?? prepared()[0];

  const controlsFor = (bookId: BookId): Controls | undefined =>
    props.decidable
      ? {
          decision: (unit) => props.decision(bookId, unit.id),
          decide: (unit, side) => props.decide(bookId, [unit], side),
          keepTitle: t("Keep {source}'s", { source: props.currentShort }),
          takeTitle: t("Take {source}'s", { source: props.baselineShort }),
          live: props.writesDecisions ?? props.decidable,
          dimUnchosen: props.dimUnchosen === true,
        }
      : undefined;

  const controls = createMemo(
    () => new Map(prepared().map((held) => [held.book.bookId, controlsFor(held.book.bookId)])),
    { name: "reviewControls" },
  );

  const decidedOf = (held: Prepared | undefined): number =>
    held === undefined
      ? 0
      : held.shown.filter((unit) => props.decision(held.book.bookId, unit.id) !== undefined).length;

  const cursor = createCursor({
    scope,
    setScope,
    prepared,
    selectedBook,
    onSelect: (bookId) => props.onSelect(bookId),
    observability,
  });
  const chapters = createChapterNav({
    selectedBook,
    place: cursor.place,
    goToChapter: cursor.goToChapter,
  });

  const inScope = (): readonly Prepared[] => {
    if (scope() === "changes") return prepared();
    const held = selectedBook();
    return held === undefined ? [] : [held];
  };
  const scopeCount = (): number => inScope().reduce((sum, held) => sum + held.shown.length, 0);
  const decideAll = (side: MergeSide | undefined): void => {
    for (const held of untrack(inScope))
      if (held.shown.length > 0) props.decide(held.book.bookId, held.shown, side);
  };

  const cardDecision = (hunk: Hunk): readonly CardAction[] => {
    if (hunk.units.length === 0) return [];
    if (!props.decidable) {
      if (split()) return [];
      const sides = props.sides?.(hunk, false);
      return sides === undefined ? [] : [...sides.baseline, ...sides.current];
    }
    const sides = new Set(hunk.units.map((unit) => props.decision(hunk.bookId, unit.id)));
    const side: MergeSide | "mixed" | undefined = sides.size !== 1 ? "mixed" : [...sides][0];
    const one = hunk.units.length === 1;
    const takeLabel = (): string => {
      if (side === "baseline") return t("Taken from {source}", { source: props.baselineShort });
      return one
        ? t("Take {source}'s", { source: props.baselineShort })
        : t("Take all of {source}'s", { source: props.baselineShort });
    };
    const choose = (chosen: MergeSide): void =>
      props.decide(hunk.bookId, hunk.units, side === chosen ? undefined : chosen);
    return [
      {
        kind: "button",
        id: "take",
        emphasis: "tertiary",
        pressed: side === "baseline",
        label: takeLabel(),
        onPress: () => choose("baseline"),
      },
      {
        kind: "button",
        id: "keep",
        emphasis: "tertiary",
        pressed: side === "current",
        label: one
          ? t("Keep {source}'s", { source: props.currentShort })
          : t("Keep all of {source}'s", { source: props.currentShort }),
        onPress: () => choose("current"),
      },
    ];
  };

  const sections = createMemo(
    (): readonly VirtualSection<CardItem>[] =>
      prepared()
        .filter((held) => held.hunks.length > 0)
        .map((held) => ({
          key: held.book.bookId,
          rows: held.hunks.map((hunk) => ({
            key: hunk.key,
            item: { hunk, held },
            estimate: estimate(hunk),
          })),
        })),
    { name: "reviewSections" },
  );

  if (untrack(() => props.claimSidebar) !== false)
    onCleanup(
      claimSidebar(() => (
        <BooksSidebar
          books={prepared()}
          focused={
            scope() === "book"
              ? selectedBook()?.book.bookId
              : (cursor.activeBook() ?? prepared()[0]?.book.bookId)
          }
          decidable={props.decidable}
          decidedOf={decidedOf}
          baselineShort={props.baselineShort}
          currentShort={props.currentShort}
          onPick={cursor.pickBook}
          onDecide={(bookId, units, side) => props.decide(bookId, units, side)}
        />
      )),
    );

  const editable = (): boolean => props.decidable;

  const liveFor = createSeats({
    wanted: () => (scope() === "book" && editable() ? selectedBook()?.book.bookId : undefined),
    seat: (bookId) => props.seat(bookId),
    analysisOf,
  });

  let observer: ResizeObserver | undefined;
  const measure = (element: HTMLDivElement): void => {
    observer?.disconnect();
    observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box !== undefined && box.width > 0) setWidth(box.width);
    });
    observer.observe(element);
  };
  onCleanup(() => observer?.disconnect());

  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2" data-review-reader ref={measure}>
      <ReaderToolbar
        scope={scope()}
        onScope={(value) => (value === "book" ? cursor.enterBook() : cursor.backToCards())}
        filter={filter()}
        onFilter={(value) => {
          setFilter(value);
          cursor.setPlace(undefined);
        }}
        layout={layout()}
        onLayout={setLayout}
        usfm={props.usfm}
        onUsfm={props.onUsfm}
        counter={cursor.place() === undefined ? undefined : cursor.counter()}
        onStep={cursor.step}
        decideAll={
          <DecideAll
            decidable={props.decidable}
            count={scopeCount()}
            scope={scope()}
            bookName={inScope()[0]?.book.name ?? ""}
            books={inScope().filter((held) => held.shown.length > 0).length}
            baselineShort={props.baselineShort}
            currentShort={props.currentShort}
            onDecide={decideAll}
          />
        }
      />

      <Show
        when={scope() === "changes"}
        fallback={
          <Show
            when={selectedBook()?.book.bookId}
            fallback={<EmptyState title={t("Preparing…")} />}
          >
            {(_bookId) => (
              <WholeBook
                selected={selectedBook()}
                books={prepared()}
                ready={layout() !== "auto" || width() > 0}
                split={split()}
                usfm={props.usfm}
                linked={linked}
                onToggleLinked={() => setLinked((on) => !on)}
                controls={(bookId) => controls().get(bookId)}
                currentLabel={(bookId) => labelOf(props.currentLabel, bookId)}
                baselineLabel={(bookId) => labelOf(props.baselineLabel, bookId)}
                currentFirst={props.currentFirst === true}
                observability={observability}
                initial={cursor.opened()?.unit}
                liveFor={liveFor}
                awaitLive={editable()}
                onApi={cursor.setBook}
                onPlace={cursor.placeFrom}
                onBook={cursor.pickBook}
                chapterLabel={chapterWords(chapters.currentChapter())}
                currentChapter={chapters.currentChapter()}
                chaptersOf={chaptersOf}
                onChapter={cursor.goToChapter}
                chapterStep={{
                  onPrevious: () => chapters.stepChapter(-1),
                  onNext: () => chapters.stepChapter(1),
                  get first() {
                    return chapters.chapterAt(-1) === undefined;
                  },
                  get last() {
                    return chapters.chapterAt(1) === undefined;
                  },
                }}
              />
            )}
          </Show>
        }
      >
        <ChangeCards
          sections={sections()}
          preparing={prepared().length < props.books.length}
          views={views}
          split={split()}
          usfm={props.usfm}
          controls={(bookId) => controls().get(bookId)}
          isCurrent={(key) => {
            const at = cursor.place();
            return at !== undefined && cursor.cardKeys()[at ?? -1] === key;
          }}
          originOf={props.originOf}
          currentLabel={props.currentLabel}
          baselineLabel={props.baselineLabel}
          currentFirst={props.currentFirst === true}
          sides={props.sides}
          editable={editable()}
          seat={props.seat}
          analyze={(bookId, text) => analysisOf(bookId, "current", text)}
          headerActions={cardDecision}
          onStep={expand}
          onOpen={cursor.openInBook}
          onEditing={(now) => props.onEditing?.(now)}
          onRoot={cursor.setListRoot}
          onScrollTo={cursor.setGoTo}
        />
      </Show>
    </div>
  );
}
