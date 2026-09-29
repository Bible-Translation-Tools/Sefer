/**
 * The multibuffer: an outline column beside a windowed list of excerpts. No
 * section headers: every card's title bar already names its book and verse,
 * and the outline scrolls to a section's first card.
 *
 * One component, three feeds. Find supplies groups built from search hits,
 * STET from a term's occurrences plus a `pairedOf` for the paired resource,
 * Findings from diagnostics; everything below this line is the same
 * (`planning/00-ideas/excerpt-compound-component.md`).
 *
 * The windowing itself lives in `primitives/VirtualList`, because `/findings`
 * needs the same thing. What is here is what is about EXCERPTS: the outline column, the height estimate for a card
 * of scripture, and the one-card-at-a-time edit session.
 */

import type { JSX } from "@solidjs/web";
import { For, createMemo, createSignal, onCleanup } from "solid-js";

import type { BookId } from "#core/book/book";
import {
  withoutHits,
  type BookExcerpts,
  type Excerpt,
  type Occurrence,
  type OutlineRow,
} from "#core/excerpts/excerpts";
import type { Analysis } from "#core/galley";
import type { EditorBook, Funnel } from "#editor/index";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { CardList } from "../multibuffer/CardList";
import type { CardViews } from "../multibuffer/cardViews";
import { cx, type VirtualSection } from "../primitives";
import { claimSidebar } from "../workspace/sidebarSlot";
import type { ExcerptCardSpec, OutlineSpec } from "./cardSpec";
import { ExcerptCard, type Paired } from "./ExcerptCard";
import { ResultsOutline } from "./ResultsOutline";

export interface ExcerptListProps {
  readonly groups: readonly BookExcerpts[];
  readonly outline: readonly OutlineRow[];
  /** What this screen's cards do (`cardSpec.ts`) — `excerptCard(...)` for Find's. */
  readonly card: ExcerptCardSpec;
  /** What the outline says about the sections, when they are not plain books. */
  readonly sections?: OutlineSpec;
  /** Every card's view on this screen, by sid — the feed's (`ExcerptFeed.views`). */
  readonly views: CardViews<Excerpt>;
  /** Plain → Instantiated, for the one excerpt being edited. */
  readonly seat: (bookId: BookId) => Promise<EditorBook | undefined>;
  /**
   * What a card shows: the grouped excerpt, widened by that card's own
   * context steps. Per card, so a step redraws one card, not the list.
   */
  readonly shownOf?: (excerpt: Excerpt) => Excerpt;
  /** A book's seat while one is open, for every card of it to follow. */
  readonly seatedOf?: (bookId: BookId) => Funnel | undefined;
  readonly analyze: (text: string) => Analysis;
  /**
   * Told the book an edit is in — at each pause, and when the edit ends — so
   * the screen re-takes that book's results.
   */
  readonly onEdited?: (bookId: BookId) => void;
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
  /**
   * The shell's mode, passed to every card. A results list is a view of the
   * same text the editor shows, so USFM mode means markers here too.
   */
  readonly mode?: "regular" | "usfm";
  /** The paired resource read beside one excerpt, when the screen has one. */
  readonly pairedOf?: ((excerpt: Excerpt) => Paired | undefined) | undefined;
  readonly empty?: JSX.Element;
  /**
   * What a card held for editing says once the results no longer include it:
   * "Resolved" on Findings, "No longer matches" on Find. See `pin` below.
   */
  readonly goneLabel?: string;
  /**
   * What the results are OF — the query, the filter. When it changes, the
   * one-line rows of released cards go: they belong to the old results.
   */
  readonly resultsKey?: string;
}

/** Roughly one line of the scripture serif at the list's width. */
const LINE = 26;
const CHARS_PER_LINE = 92;
const CARD_CHROME = 42;
/** The space above each card (`pt-3`), which is part of its row. */
const ROW_GAP = 12;
/** The context control's row, when the feed offers widening. */
const FOOTER = 36;

/**
 * Markup, as a fraction of the source it is cut from.
 *
 * The estimate is made from `span`, the excerpt's SOURCE length, and not from
 * what the card will render — that is only known once its view has laid out,
 * and this runs for every row in the feed rather than for the twenty on screen
 * (see `Excerpt`'s note). Source is longer than what a card shows, by whatever
 * the markers take up, so it is discounted.
 *
 * A rough number on purpose: this is the height used until the row is measured,
 * and `VirtualList` refuses to compensate a FIRST measurement precisely so an
 * imperfect estimate cannot move the viewport under the reader.
 */
const PROJECTED = 0.82;

const estimate = (excerpt: Excerpt): number => {
  const source = excerpt.span.to - excerpt.span.from;
  const lines = Math.max(1, Math.ceil((source * PROJECTED) / CHARS_PER_LINE));
  return ROW_GAP + CARD_CHROME + lines * LINE + 16;
};

export function ExcerptList(props: ExcerptListProps) {
  const shell = useShell();
  /**
   * The section last gone to from an outline — what the outline highlights.
   * The one clicked, not the one scrolled under: every card names its own
   * place, so the outline is for going, not for saying where you are.
   */
  const [active, setActive] = createSignal<string | undefined>(undefined, {
    name: "excerptActiveBook",
  });
  let goTo: ((key: string) => void) | undefined;

  /** A card as drawn; the one being edited is remembered, for when its result goes. */
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

  /**
   * One section per group, built once per group OBJECT: the feed hands back a
   * book's groups unchanged when that book did not change, so a seat swap or
   * an edit in one book re-describes that book's rows and not the other
   * eighty thousand.
   */
  const built = new WeakMap<BookExcerpts, VirtualSection<Excerpt>>();
  const sectionOf = (group: BookExcerpts): VirtualSection<Excerpt> => {
    const held = built.get(group);
    if (held !== undefined) return held;
    const made: VirtualSection<Excerpt> = {
      key: group.bookId,
      rows: group.excerpts.map((excerpt) => {
        // `static`: the memo is the tracking scope, and the key is read here
        // rather than by a function that outlives it.
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
    };
    built.set(group, made);
    return made;
  };

  const sections = createMemo(
    (): readonly VirtualSection<Excerpt>[] => props.groups.map(sectionOf),
    { name: "excerptSections" },
  );
  /**
   * Every result of each book, sorted by where it starts — so a card can paint
   * the ones that fall in its context, not only its own. By BOOK, not by
   * section: Findings sections by code, and a finding of another code in the
   * same verses is still in the text the card shows.
   */
  const hitsByBook = createMemo(
    () => {
      const held = new Map<BookId, Occurrence[]>();
      for (const group of props.groups)
        for (const excerpt of group.excerpts)
          for (const hit of excerpt.hits) {
            const list = held.get(excerpt.bookId);
            if (list === undefined) held.set(excerpt.bookId, [hit]);
            else list.push(hit);
          }
      for (const list of held.values()) list.sort((a, b) => a.from - b.from);
      return held;
    },
    { name: "excerptHitsByBook" },
  );
  /** The book's other results inside `excerpt`'s stretch. */
  const nearbyOf = (excerpt: Excerpt): readonly Occurrence[] => {
    const all = hitsByBook().get(excerpt.bookId);
    if (all === undefined) return [];
    let lo = 0;
    let hi = all.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((all[mid]?.from ?? 0) < excerpt.span.from) lo = mid + 1;
      else hi = mid;
    }
    const own = new Set(excerpt.hits.map((hit) => hit.from));
    const out: Occurrence[] = [];
    for (let at = lo; at < all.length; at += 1) {
      const hit = all[at];
      if (hit === undefined || hit.from >= excerpt.span.to) break;
      if (hit.to <= excerpt.span.to && !own.has(hit.from)) out.push(hit);
    }
    return out;
  };

  // A section a regrouping took away highlights the first one instead.
  const current = () => {
    const held = active();
    return held !== undefined && props.groups.some((group) => group.bookId === held)
      ? held
      : props.groups[0]?.bookId;
  };

  // The outline goes where the project's contents normally are: on a screen
  // of results the sidebar navigates the results (`workspace/sidebarSlot.ts`).
  // Claimed for as long as this list is mounted; the column below is only for
  // a reader who has hidden the sidebar.
  onCleanup(
    claimSidebar(() => (
      <ResultsOutline
        title={props.sections?.title ?? t("Results")}
        groups={props.groups}
        outline={props.outline}
        active={current()}
        label={(row) => props.sections?.label?.(row) ?? row.name}
        keyOf={keyOf}
        onGo={go}
      />
    )),
  );

  return (
    <div class="flex min-h-0 flex-1 gap-4">
      <nav
        aria-label={props.sections?.title ?? t("Books with results")}
        class={cx(
          "hidden w-40 shrink-0 flex-col gap-0.5 overflow-y-auto",
          !shell.sidebarShowing() && "md:flex",
        )}
      >
        <For each={props.outline}>
          {(row) => (
            <button
              type="button"
              data-outline={row.bookId}
              aria-current={current() === row.bookId ? "true" : undefined}
              onClick={() => go(row.bookId, row.bookId)}
              class={cx(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-start text-small transition-colors",
                current() === row.bookId
                  ? "bg-sidebar-surface-active font-medium text-brand"
                  : "text-on-surface-secondary hover:bg-surface-secondary",
              )}
            >
              <span class="truncate">{props.sections?.label?.(row) ?? row.bookId}</span>
              <span class="ms-auto text-smallest tabular-nums text-on-surface-tertiary">
                {row.count}
              </span>
            </button>
          )}
        </For>
      </nav>

      <CardList<Excerpt>
        sections={sections()}
        bookOf={(excerpt) => excerpt.bookId}
        seat={props.seat}
        onRetake={(bookId) => props.onEdited?.(bookId)}
        // Gone from the results, so its highlights are stale: the text they
        // marked no longer matches, or no longer has the finding.
        whenGone={withoutHits}
        lineLabel={(excerpt) => excerpt.label}
        goneLabel={props.goneLabel}
        resultsKey={props.resultsKey}
        focus={props.focus}
        ref={(scrollTo) => {
          goTo = scrollTo;
        }}
        empty={props.empty}
        card={(excerpt, key, session) => (
          <ExcerptCard
            excerpt={
              // A pinned card gone from the results — its finding resolved by
              // the edit in it — has no result left to widen, so it is drawn
              // as it was last SHOWN: widened to the chapter, it stays the
              // chapter, rather than the one-verse snapshot the pin took.
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
        )}
      />
    </div>
  );
}
