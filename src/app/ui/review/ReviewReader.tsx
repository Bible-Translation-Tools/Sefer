import type { EditorBook } from "@sefer/editor";
import type { BookId } from "@sefer/text/book";
import type { JSX } from "@solidjs/web";
import { Effect } from "effect";
import { Show, createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js";

import type { Analysis, DecisionUnit, MergeSide } from "#core/galley";

import { t } from "../../i18n";
import { m } from "../../paraglide/messages";
import { useShell } from "../../ProjectContext";
import type { Services } from "../../services";
import { shellKeys } from "../../settings";
import { estimate, type Controls, type Hunk } from "../diff";
import type { CardAction } from "../multibuffer/CardAction";
import type { ContextStep } from "../multibuffer/cardState";
import { createCardViews } from "../multibuffer/cardViews";
import { EmptyState, type VirtualSection } from "../primitives";
import { claimSidebar } from "../workspace/sidebarSlot";
import { BooksSidebar } from "./reader/BooksSidebar";
import { ChangeCards, type CardItem } from "./reader/ChangeCards";
import { createChapterNav, type ChapterNav } from "./reader/createChapterNav";
import { createCursor, type Cursor } from "./reader/createCursor";
import { createPrepared } from "./reader/createPrepared";
import { createSeats } from "./reader/createSeats";
import { DecideAll } from "./reader/DecideAll";
import { chaptersOf, chapterWords, labelOf, toLayout } from "./reader/helpers";
import { createMeasure } from "./reader/measure";
import { ReaderToolbar } from "./reader/ReaderToolbar";
import {
  AUTO_SPLIT_PX,
  type Filter,
  type CardViews,
  type Layout,
  type Observability,
  type Prepared,
  type ReviewBook,
  type Scope,
} from "./reader/types";
import { WholeBook } from "./reader/WholeBook";

export type { ReviewBook };

interface ReviewReaderProps {
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
}

type Keys = ReturnType<typeof shellKeys>;
type AnalysisOf = (bookId: BookId, side: "current" | "baseline", text: string) => Analysis;

interface ReaderModel {
  readonly props: ReviewReaderProps;
  readonly observability: Observability;
  readonly scope: Accessor<Scope>;
  readonly layout: Accessor<Layout>;
  readonly width: Accessor<number>;
  readonly filter: Accessor<Filter>;
  readonly setFilter: (filter: Filter) => void;
  readonly setLayout: (layout: Layout) => void;
  readonly linked: Accessor<boolean>;
  readonly setLinked: (update: (on: boolean) => boolean) => void;
  readonly split: () => boolean;
  readonly cursor: Cursor;
  readonly chapters: ChapterNav;
  readonly prepared: Accessor<readonly Prepared[]>;
  readonly selectedBook: () => Prepared | undefined;
  readonly controls: Accessor<ReadonlyMap<BookId, Controls | undefined>>;
  readonly views: CardViews;
  readonly sections: Accessor<readonly VirtualSection<CardItem>[]>;
  readonly liveFor: ReturnType<typeof createSeats>;
  readonly analysisOf: AnalysisOf;
  readonly editable: () => boolean;
  readonly inScope: () => readonly Prepared[];
  readonly scopeCount: () => number;
  readonly decideAll: (side: MergeSide | undefined) => void;
  readonly cardDecision: (hunk: Hunk) => readonly CardAction[];
  readonly expand: (key: string, step: ContextStep) => void;
}

function createReaderState(services: Services, keys: Keys) {
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
  return {
    layout,
    scope,
    setScope,
    filter,
    setFilter,
    width,
    setWidth,
    linked,
    setLinked,
    setLayout,
    split,
  };
}

function createAnalysisOf(services: Services): AnalysisOf {
  const analyzers = new Map<string, (text: string) => Analysis>();
  return (bookId, side, text) => {
    const key = `${side}\0${bookId}`;
    let analyze = analyzers.get(key);
    if (analyze === undefined) {
      analyze = services.galley.memoize();
      analyzers.set(key, analyze);
    }
    return analyze(text);
  };
}

function createViews(services: Services, keys: Keys) {
  const views = createCardViews<never>("review");
  const expand = (key: string, step: ContextStep): void => {
    const steps = services.settings.get(keys.excerptContext);
    views.send(key, { kind: "step", step, from: { up: steps, down: steps } });
  };
  return { views, expand };
}

function createControls(props: ReviewReaderProps, prepared: Accessor<readonly Prepared[]>) {
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
  return { controls, decidedOf };
}

function createScopeDecide(
  props: ReviewReaderProps,
  scope: Accessor<Scope>,
  prepared: Accessor<readonly Prepared[]>,
  selectedBook: () => Prepared | undefined,
) {
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
  return { inScope, scopeCount, decideAll };
}

function cardDecisionFor(
  props: ReviewReaderProps,
  split: () => boolean,
  hunk: Hunk,
): readonly CardAction[] {
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
}

const createSections = (prepared: Accessor<readonly Prepared[]>) =>
  createMemo(
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

function ReaderToolbarView(props: { readonly reader: ReaderModel }): JSX.Element {
  return (
    <ReaderToolbar
      scope={props.reader.scope()}
      onScope={(value) =>
        value === "book" ? props.reader.cursor.enterBook() : props.reader.cursor.backToCards()
      }
      filter={props.reader.filter()}
      onFilter={(value) => {
        props.reader.setFilter(value);
        props.reader.cursor.setPlace(undefined);
      }}
      layout={props.reader.layout()}
      onLayout={props.reader.setLayout}
      usfm={props.reader.props.usfm}
      onUsfm={props.reader.props.onUsfm}
      counter={
        props.reader.cursor.place() === undefined ? undefined : props.reader.cursor.counter()
      }
      onStep={props.reader.cursor.step}
      decideAll={
        <DecideAll
          decidable={props.reader.props.decidable}
          count={props.reader.scopeCount()}
          scope={props.reader.scope()}
          bookName={props.reader.inScope()[0]?.book.name ?? ""}
          books={props.reader.inScope().filter((held) => held.shown.length > 0).length}
          baselineShort={props.reader.props.baselineShort}
          currentShort={props.reader.props.currentShort}
          onDecide={props.reader.decideAll}
        />
      }
    />
  );
}

function WholeBookView(props: { readonly reader: ReaderModel }): JSX.Element {
  return (
    <WholeBook
      selected={props.reader.selectedBook()}
      books={props.reader.prepared()}
      ready={props.reader.layout() !== "auto" || props.reader.width() > 0}
      split={props.reader.split()}
      usfm={props.reader.props.usfm}
      linked={props.reader.linked}
      onToggleLinked={() => props.reader.setLinked((on) => !on)}
      controls={(bookId) => props.reader.controls().get(bookId)}
      currentLabel={(bookId) => labelOf(props.reader.props.currentLabel, bookId)}
      baselineLabel={(bookId) => labelOf(props.reader.props.baselineLabel, bookId)}
      currentFirst={props.reader.props.currentFirst === true}
      observability={props.reader.observability}
      initial={props.reader.cursor.opened()?.unit}
      liveFor={props.reader.liveFor}
      awaitLive={props.reader.editable()}
      onApi={props.reader.cursor.setBook}
      onPlace={props.reader.cursor.placeFrom}
      onBook={props.reader.cursor.pickBook}
      chapterLabel={chapterWords(props.reader.chapters.currentChapter())}
      currentChapter={props.reader.chapters.currentChapter()}
      chaptersOf={chaptersOf}
      onChapter={props.reader.cursor.goToChapter}
      chapterStep={{
        onPrevious: () => props.reader.chapters.stepChapter(-1),
        onNext: () => props.reader.chapters.stepChapter(1),
        get first() {
          return props.reader.chapters.chapterAt(-1) === undefined;
        },
        get last() {
          return props.reader.chapters.chapterAt(1) === undefined;
        },
      }}
    />
  );
}

function ChangeCardsView(props: { readonly reader: ReaderModel }): JSX.Element {
  return (
    <ChangeCards
      sections={props.reader.sections()}
      preparing={props.reader.prepared().length < props.reader.props.books.length}
      views={props.reader.views}
      split={props.reader.split()}
      usfm={props.reader.props.usfm}
      controls={(bookId) => props.reader.controls().get(bookId)}
      isCurrent={(key) => {
        const at = props.reader.cursor.place();
        return at !== undefined && props.reader.cursor.cardKeys()[at ?? -1] === key;
      }}
      originOf={props.reader.props.originOf}
      currentLabel={props.reader.props.currentLabel}
      baselineLabel={props.reader.props.baselineLabel}
      currentFirst={props.reader.props.currentFirst === true}
      sides={props.reader.props.sides}
      editable={props.reader.editable()}
      seat={props.reader.props.seat}
      analyze={(bookId, text) => props.reader.analysisOf(bookId, "current", text)}
      headerActions={props.reader.cardDecision}
      onStep={props.reader.expand}
      onOpen={props.reader.cursor.openInBook}
      onEditing={(now) => props.reader.props.onEditing?.(now)}
      onRoot={props.reader.cursor.setListRoot}
      onScrollTo={props.reader.cursor.setGoTo}
    />
  );
}

export function ReviewReader(props: ReviewReaderProps) {
  const shell = useShell();
  const { services } = shell;
  const observability = services.composition.observability;
  const keys = shellKeys(services.settings);

  const state = createReaderState(services, keys);
  const { layout, scope, setScope, filter, width, split } = state;
  const analysisOf = createAnalysisOf(services);
  const { views, expand } = createViews(services, keys);

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

  const { controls, decidedOf } = createControls(props, prepared);

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

  const { inScope, scopeCount, decideAll } = createScopeDecide(
    props,
    scope,
    prepared,
    selectedBook,
  );
  const cardDecision = (hunk: Hunk): readonly CardAction[] => cardDecisionFor(props, split, hunk);
  const sections = createSections(prepared);

  if (untrack(() => props.claimSidebar) !== false)
    onCleanup(
      claimSidebar(
        () => (
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
        ),
        { show: m.sidebar_show_changes(), hide: m.sidebar_hide_changes() },
      ),
    );

  const editable = (): boolean => props.decidable;

  const liveFor = createSeats({
    wanted: () => (scope() === "book" && editable() ? selectedBook()?.book.bookId : undefined),
    seat: (bookId) => props.seat(bookId),
    analysisOf,
  });

  const measure = createMeasure(state.setWidth);

  const reader: ReaderModel = {
    props,
    observability,
    scope,
    layout,
    width,
    filter,
    setFilter: state.setFilter,
    setLayout: state.setLayout,
    linked: state.linked,
    setLinked: state.setLinked,
    split,
    cursor,
    chapters,
    prepared,
    selectedBook,
    controls,
    views,
    sections,
    liveFor,
    analysisOf,
    editable,
    inScope,
    scopeCount,
    decideAll,
    cardDecision,
    expand,
  };

  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2" data-review-reader ref={measure}>
      <ReaderToolbarView reader={reader} />

      <Show
        when={scope() === "changes"}
        fallback={
          <Show
            when={selectedBook()?.book.bookId}
            fallback={<EmptyState title={t("Preparing…")} />}
          >
            {(_bookId) => <WholeBookView reader={reader} />}
          </Show>
        }
      >
        <ChangeCardsView reader={reader} />
      </Show>
    </div>
  );
}
