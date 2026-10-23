import type { EditorBook, Following } from "@sefer/editor";
import type { BookId } from "@sefer/text/book";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, onCleanup, untrack } from "solid-js";

import {
  withoutHits,
  type BookExcerpts,
  type Excerpt,
  type Occurrence,
  type OutlineRow,
} from "#core/excerpts/excerpts";
import type { Analysis } from "#core/galley";

import { t } from "../../i18n";
import { m } from "../../paraglide/messages";
import { CardList, type CardListProps } from "../multibuffer/CardList";
import type { CardViews } from "../multibuffer/cardViews";
import type { VirtualSection } from "../primitives";
import { claimSidebar } from "../workspace/sidebarSlot";
import type { ExcerptCardSpec, OutlineSpec } from "./cardSpec";
import { ExcerptCard, type Paired } from "./ExcerptCard";
import { ResultsOutline } from "./ResultsOutline";

export interface ExcerptListProps {
  readonly groups: readonly BookExcerpts[];
  readonly outline: readonly OutlineRow[];
  readonly card: ExcerptCardSpec;
  readonly sections?: OutlineSpec;
  readonly views: CardViews<Excerpt>;
  readonly seat: (bookId: BookId) => Promise<EditorBook | undefined>;
  readonly shownOf?: (excerpt: Excerpt) => Excerpt;
  readonly seatedOf?: (bookId: BookId) => Following | undefined;
  readonly analyze: (text: string) => Analysis;
  readonly onEdited?: (bookId: BookId) => void;
  readonly focus?: string;
  readonly activeHit?: number;
  readonly mode?: "regular" | "usfm";
  readonly pairedOf?: ((excerpt: Excerpt) => Paired | undefined) | undefined;
  readonly empty?: JSX.Element;
  readonly goneLabel?: string;
  readonly resultsKey?: string;
  readonly claimsSidebar?: boolean;
  readonly goTo?: (go: (key: string) => void) => void;
}

const LINE = 26;
const CHARS_PER_LINE = 92;
const CARD_CHROME = 42;
const ROW_GAP = 12;
const FOOTER = 36;

const PROJECTED = 0.82;

const estimate = (excerpt: Excerpt): number => {
  const source = excerpt.span.to - excerpt.span.from;
  const lines = Math.max(1, Math.ceil((source * PROJECTED) / CHARS_PER_LINE));
  return ROW_GAP + CARD_CHROME + lines * LINE + 16;
};

const nearbyHits = (
  all: readonly Occurrence[] | undefined,
  excerpt: Excerpt,
): readonly Occurrence[] => {
  if (all === undefined) return [];
  let low = 0;
  let high = all.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((all[mid]?.from ?? 0) < excerpt.span.from) low = mid + 1;
    else high = mid;
  }
  const own = new Set(excerpt.hits.map((hit) => hit.from));
  const out: Occurrence[] = [];
  for (let at = low; at < all.length; at += 1) {
    const hit = all[at];
    if (hit === undefined || hit.from >= excerpt.span.to) break;
    if (hit.to <= excerpt.span.to && !own.has(hit.from)) out.push(hit);
  }
  return out;
};

const indexHits = (groups: readonly BookExcerpts[]): Map<BookId, Occurrence[]> => {
  const held = new Map<BookId, Occurrence[]>();
  for (const group of groups)
    for (const excerpt of group.excerpts)
      for (const hit of excerpt.hits) {
        const list = held.get(excerpt.bookId);
        if (list === undefined) held.set(excerpt.bookId, [hit]);
        else list.push(hit);
      }
  for (const list of held.values()) list.sort((a, b) => a.from - b.from);
  return held;
};

const buildSection = (
  props: ExcerptListProps,
  keyOf: (group: BookExcerpts, excerpt: Excerpt) => string,
  group: BookExcerpts,
): VirtualSection<Excerpt> => ({
  key: props.sections?.sectionKey?.(group) ?? group.bookId,
  rows: group.excerpts.map((excerpt) => {
    // Untracked on purpose: a one-time read, not a dependency (Solid 2: STRICT_READ_UNTRACKED).
    const staticKey = keyOf(group, excerpt);
    return {
      key: staticKey,
      item: excerpt,
      estimate:
        estimate(excerpt) +
        (props.card.context.kind === "none" ? 0 : FOOTER) +
        (props.card.extraHeight?.(excerpt, staticKey) ?? 0),
    };
  }),
});

export function ExcerptList(props: ExcerptListProps) {
  const [active, setActive] = createSignal<string | undefined>(undefined, {
    name: "excerptActiveBook",
  });
  let goTo: ((key: string) => void) | undefined;

  const shown = (excerpt: Excerpt, key: string, editing: boolean): Excerpt => {
    const drawn = props.shownOf?.(excerpt) ?? excerpt;
    if (editing) props.views.drawn.set(key, drawn);
    return drawn;
  };
  const go = (key: string, section: string): void => {
    setActive(section);
    goTo?.(key);
  };

  const keyOf = (group: BookExcerpts, excerpt: Excerpt): string =>
    props.sections?.rowKey?.(group, excerpt) ?? excerpt.sid;

  const built = new WeakMap<BookExcerpts, VirtualSection<Excerpt>>();
  const sectionOf = (group: BookExcerpts): VirtualSection<Excerpt> => {
    const held = built.get(group);
    if (held !== undefined) return held;
    const made = buildSection(props, keyOf, group);
    built.set(group, made);
    return made;
  };

  const sections = createMemo(
    (): readonly VirtualSection<Excerpt>[] => props.groups.map(sectionOf),
    { name: "excerptSections" },
  );
  const hitsByBook = createMemo(() => indexHits(props.groups), { name: "excerptHitsByBook" });
  const nearbyOf = (excerpt: Excerpt): readonly Occurrence[] =>
    nearbyHits(hitsByBook().get(excerpt.bookId), excerpt);

  const current = () => {
    const held = active();
    return held !== undefined && props.groups.some((group) => group.bookId === held)
      ? held
      : props.groups[0]?.bookId;
  };

  if (untrack(() => props.claimsSidebar) !== false)
    onCleanup(
      claimSidebar(
        () => (
          <ResultsOutline
            title={props.sections?.title ?? t("Results")}
            groups={props.groups}
            outline={props.outline}
            active={current()}
            label={(row) => props.sections?.label?.(row) ?? row.name}
            keyOf={keyOf}
            onGo={go}
          />
        ),
        { show: m.sidebar_show_results(), hide: m.sidebar_hide_results() },
      ),
    );

  const card: CardListProps<Excerpt>["card"] = (excerpt, key, session) => (
    <ExcerptCard
      excerpt={
        session.gone
          ? (props.views.drawn.get(key) ?? excerpt())
          : shown(excerpt(), key, session.editing)
      }
      editing={session.editing}
      gone={session.gone ? session.goneLabel : undefined}
      onEdit={session.start}
      onDone={session.done}
      spec={props.card}
      rowKey={key}
      seat={() => props.seat(excerpt().bookId)}
      analyze={props.analyze}
      follow={props.seatedOf?.(excerpt().bookId)}
      paired={props.pairedOf?.(excerpt())}
      active={props.focus === key ? props.activeHit : undefined}
      mode={props.mode ?? "regular"}
      view={props.views.view(excerpt().sid)}
      onView={(event) => props.views.send(excerpt().sid, event)}
      nearby={session.gone ? [] : nearbyOf(props.shownOf?.(excerpt()) ?? excerpt())}
    />
  );

  return (
    <div class="flex min-h-0 flex-1 gap-4">
      <CardList<Excerpt>
        sections={sections()}
        bookOf={(excerpt) => excerpt.bookId}
        seat={props.seat}
        onRetake={(bookId) => props.onEdited?.(bookId)}
        whenGone={withoutHits}
        lineLabel={(excerpt) => excerpt.label}
        goneLabel={props.goneLabel}
        resultsKey={props.resultsKey}
        focus={props.focus}
        ref={(scrollTo) => {
          goTo = scrollTo;
          props.goTo?.(scrollTo);
        }}
        empty={props.empty}
        card={card}
      />
    </div>
  );
}
