/**
 * The multibuffer: an outline column beside a windowed list of excerpts under
 * sticky per-book headers.
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
import type { BookExcerpts, Excerpt, OutlineRow } from "#core/excerpts/excerpts";
import type { Analysis } from "#core/galley";
import type { EditorBook, Funnel } from "#editor/index";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { cx, VirtualList, type VirtualSection } from "../primitives";
import { claimSidebar } from "../workspace/sidebarSlot";
import { ExcerptCard, type ContextStep, type MarkTone, type Paired } from "./ExcerptCard";
import { ResultsOutline } from "./ResultsOutline";

export interface ExcerptListProps {
  readonly groups: readonly BookExcerpts[];
  readonly outline: readonly OutlineRow[];
  /** Aim the main editor at this range of this book. */
  readonly onOpen: (bookId: BookId, from: number, to?: number) => void;
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
  /**
   * The shell's mode, passed to every card. A results list is a view of the
   * same text the editor shows, so USFM mode means markers here too.
   */
  readonly mode?: "regular" | "usfm";
  /** The paired resource read beside one excerpt, when the screen has one. */
  readonly pairedOf?: ((excerpt: Excerpt) => Paired | undefined) | undefined;
  /**
   * One context step for one excerpt. The EXTENT is the feed's state, keyed by
   * sid, not this component's: a card scrolls out of the window and its row is
   * unmounted, and a widening the reader asked for must survive that.
   */
  readonly onExpand?: (sid: string, step: ContextStep) => void;
  readonly empty?: JSX.Element;
  /**
   * What a screen adds to the shared multibuffer. Absent — Find, STET — is the
   * list exactly as it was.
   */
  readonly decor?: ExcerptDecor;
}

/**
 * The decorations a screen hangs on the multibuffer.
 *
 * Findings is the reason this exists. It shows the SAME cards Find shows, over
 * the same model, and differs in four ways that are all presentation: its
 * sections are not always books (by code, by severity, flat, and a book's
 * front matter as its own section), so a row's key has to carry the section;
 * a card's header names findings rather than matches; a mark is coloured by
 * severity rather than by being a hit; and a card is taller than the verse it
 * holds, which the height estimate has to know before the row is measured.
 *
 * Every field is optional and every default is what Find already did.
 */
export interface ExcerptDecor {
  /**
   * A row's key, when the sid alone is not unique. Grouping by code puts one
   * verse in two sections, and a virtualizer keyed on a repeated string
   * positions the second one on top of the first. Defaults to `excerpt.sid`.
   */
  readonly rowKey?: (group: BookExcerpts, excerpt: Excerpt) => string;
  /** The sticky header's contents. Defaults to the book id, name and count. */
  readonly header?: (group: BookExcerpts) => JSX.Element;
  /** The outline column's own label, when its rows are not books. */
  readonly outlineTitle?: string;
  /** One outline row's text. Defaults to the section key. */
  readonly outlineLabel?: (row: OutlineRow) => string;
  /** Replaces a card's reference. */
  readonly label?: (excerpt: Excerpt, key: string) => JSX.Element;
  /** A block between a card's header and its reading. */
  readonly notes?: (excerpt: Excerpt, key: string) => JSX.Element;
  /** A card's footer actions — review progress, a quick filter. */
  readonly actions?: (excerpt: Excerpt, key: string) => JSX.Element;
  /** What a highlight means — see `ExcerptCardProps.markTone`. */
  readonly markTone?: (source: number | undefined, excerpt: Excerpt) => MarkTone | undefined;
  /** Pixels this card carries beyond the verse, before it has been measured. */
  readonly extraHeight?: (excerpt: Excerpt, key: string) => number;
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
  const [editing, setEditing] = createSignal<string | undefined>(undefined, {
    name: "excerptEditing",
  });
  const [active, setActive] = createSignal<string | undefined>(undefined, {
    name: "excerptActiveBook",
  });
  let goTo: ((key: string) => void) | undefined;

  const keyOf = (group: BookExcerpts, excerpt: Excerpt): string =>
    props.decor?.rowKey?.(group, excerpt) ?? excerpt.sid;

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
            (props.onExpand === undefined ? 0 : FOOTER) +
            (props.decor?.extraHeight?.(excerpt, staticKey) ?? 0),
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

  const nameOf = (bookId: string): BookExcerpts | undefined =>
    props.groups.find((group) => group.bookId === bookId);

  /** The screen's own header for one section, when it draws its own. */
  const decorated = (key: string): JSX.Element | undefined => {
    const draw = props.decor?.header;
    const group = nameOf(key);
    return draw === undefined || group === undefined ? undefined : draw(group);
  };

  const done = (): void => {
    setEditing(undefined);
    props.onEdited?.();
  };

  const current = () => active() ?? props.groups[0]?.bookId;

  // The outline goes where the project's contents normally are: on a screen
  // of results the sidebar navigates the results (`workspace/sidebarSlot.ts`).
  // Claimed for as long as this list is mounted; the column below is only for
  // a reader who has hidden the sidebar.
  onCleanup(
    claimSidebar(() => (
      <ResultsOutline
        title={props.decor?.outlineTitle ?? t("Results")}
        groups={props.groups}
        outline={props.outline}
        active={current()}
        label={(row) => props.decor?.outlineLabel?.(row) ?? row.name}
        keyOf={keyOf}
        onGo={(key) => goTo?.(key)}
      />
    )),
  );

  return (
    <div class="flex min-h-0 flex-1 gap-4">
      <nav
        aria-label={props.decor?.outlineTitle ?? t("Books with results")}
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
              onClick={() => goTo?.(row.bookId)}
              class={cx(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-start text-small transition-colors",
                current() === row.bookId
                  ? "bg-sidebar-surface-active font-medium text-brand"
                  : "text-on-surface-secondary hover:bg-surface-secondary",
              )}
            >
              <span class="truncate">{props.decor?.outlineLabel?.(row) ?? row.bookId}</span>
              <span class="ms-auto text-smallest tabular-nums text-on-surface-tertiary">
                {row.count}
              </span>
            </button>
          )}
        </For>
      </nav>

      <VirtualList<Excerpt>
        sections={sections()}
        pinned={editing()}
        focus={props.focus}
        onActive={setActive}
        ref={(scrollTo) => {
          goTo = scrollTo;
        }}
        empty={props.empty}
        header={(section, ref) => (
          <header
            ref={ref}
            data-book={section().key}
            class="sticky top-0 z-10 flex items-baseline gap-2 border-b border-surface-border bg-surface-secondary/95 px-1 py-1.5 backdrop-blur-xs"
          >
            {decorated(section().key) ?? (
              <>
                <strong class="text-small font-semibold text-on-surface-primary">
                  {section().key}
                </strong>
                <span class="text-small text-on-surface-secondary">
                  {nameOf(section().key)?.name}
                </span>
                <span class="ms-auto text-smallest text-on-surface-tertiary">
                  {t("{count} hits", { count: nameOf(section().key)?.count ?? 0 })}
                </span>
              </>
            )}
          </header>
        )}
        row={(excerpt, key) => (
          // The gap is padding INSIDE the measured row, not a margin between
          // rows: the virtualizer positions rows by their measured height, and
          // a margin would be outside what it measures.
          <div class="pt-3">
            <ExcerptCard
              excerpt={props.shownOf?.(excerpt()) ?? excerpt()}
              editing={editing() === key}
              onEdit={() => setEditing(key)}
              onDone={done}
              onOpen={() =>
                props.onOpen(
                  excerpt().bookId,
                  excerpt().hits[0]?.from ?? excerpt().span.from,
                  excerpt().hits[0]?.to,
                )
              }
              seat={() => props.seat(excerpt().bookId)}
              analyze={props.analyze}
              follow={props.seatedOf?.(excerpt().bookId)}
              paired={props.pairedOf?.(excerpt())}
              onExpand={
                props.onExpand === undefined
                  ? undefined
                  : // The EXTENT is keyed by sid, which is the verse — a section
                    // key in front of it is about where the card is on screen,
                    // and an expansion is about the verse wherever it is shown.
                    (step) => props.onExpand?.(excerpt().sid, step)
              }
              active={props.focus === key ? props.activeHit : undefined}
              mode={props.mode ?? "regular"}
              label={props.decor?.label?.(excerpt(), key)}
              notes={props.decor?.notes?.(excerpt(), key)}
              actions={props.decor?.actions?.(excerpt(), key)}
              markTone={props.decor?.markTone}
            />
          </div>
        )}
      />
    </div>
  );
}
