/**
 * The multibuffer: an outline column beside a windowed list of excerpts under
 * sticky per-book headers.
 *
 * One component, two feeds. Find supplies groups built from search hits and
 * STET supplies groups built from a term's occurrences plus a `renderPair`
 * for the source verse; everything below this line is the same
 * (design-direction.md, "Key terms (STET) reuses the Find excerpt pattern").
 *
 * The windowing itself lives in `primitives/VirtualList` now — it was here
 * first, and it moved when `/findings` needed the same thing. What stayed is
 * what is about EXCERPTS: the outline column, the height estimate for a card
 * of scripture, and the one-card-at-a-time edit session.
 */

import type { JSX } from "@solidjs/web";
import { For, createMemo, createSignal } from "solid-js";

import type { BookId } from "../../../core/book/book";
import type { BookExcerpts, Excerpt, OutlineRow } from "../../../core/excerpts/excerpts";
import type { Analysis } from "../../../core/galley";
import type { EditorBook } from "../../../editor";
import { t } from "../../i18n";
import { cx, VirtualList, type VirtualSection } from "../primitives";
import { ExcerptCard } from "./ExcerptCard";

export interface ExcerptListProps {
  readonly groups: readonly BookExcerpts[];
  readonly outline: readonly OutlineRow[];
  /** Aim the main editor at this range of this book. */
  readonly onOpen: (bookId: BookId, from: number, to?: number) => void;
  /** Plain → Instantiated, for the one excerpt being edited. */
  readonly seat: (bookId: BookId) => Promise<EditorBook | undefined>;
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
  /** STET's source verse for one excerpt. */
  readonly renderPair?: (excerpt: Excerpt) => JSX.Element;
  /**
   * Show one more verse above (-1) or below (+1) of one excerpt. The EXTENT
   * is the feed's state, keyed by sid, not this component's: a card scrolls
   * out of the window and its row is unmounted, and an expansion the reader
   * asked for must survive that.
   */
  readonly onExpand?: (sid: string, direction: -1 | 1) => void;
  readonly empty?: JSX.Element;
}

/** Roughly one line of the scripture serif at the list's width. */
const LINE = 26;
const CHARS_PER_LINE = 92;
const CARD_CHROME = 42;

const estimate = (excerpt: Excerpt): number =>
  CARD_CHROME + Math.max(1, Math.ceil(excerpt.text.length / CHARS_PER_LINE)) * LINE + 16;

export function ExcerptList(props: ExcerptListProps) {
  const [editing, setEditing] = createSignal<string | undefined>(undefined, {
    name: "excerptEditing",
  });
  const [active, setActive] = createSignal<string | undefined>(undefined, {
    name: "excerptActiveBook",
  });
  let goTo: ((bookId: string) => void) | undefined;

  const sections = createMemo(
    (): readonly VirtualSection<Excerpt>[] =>
      props.groups.map((group) => ({
        key: group.bookId,
        rows: group.excerpts.map((excerpt) => ({
          key: excerpt.sid,
          item: excerpt,
          estimate: estimate(excerpt),
        })),
      })),
    { name: "excerptSections" },
  );

  const nameOf = (bookId: string): BookExcerpts | undefined =>
    props.groups.find((group) => group.bookId === bookId);

  const done = (): void => {
    setEditing(undefined);
    props.onEdited?.();
  };

  const current = () => active() ?? props.groups[0]?.bookId;

  return (
    <div class="flex min-h-0 flex-1 gap-4">
      <nav
        aria-label={t("Books with results")}
        class="hidden w-40 shrink-0 flex-col gap-0.5 overflow-y-auto md:flex"
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
              <span class="truncate">{row.bookId}</span>
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
            data-book={section.key}
            class="sticky top-0 z-10 flex items-baseline gap-2 border-b border-surface-border bg-surface-secondary/95 px-1 py-1.5 backdrop-blur-xs"
          >
            <strong class="text-small font-semibold text-on-surface-primary">{section.key}</strong>
            <span class="text-small text-on-surface-secondary">{nameOf(section.key)?.name}</span>
            <span class="ms-auto text-smallest text-on-surface-tertiary">
              {t("{count} hits", { count: nameOf(section.key)?.count ?? 0 })}
            </span>
          </header>
        )}
        row={(excerpt, sid) => (
          <ExcerptCard
            excerpt={excerpt}
            editing={editing() === sid}
            onEdit={() => setEditing(sid)}
            onDone={done}
            onOpen={() =>
              props.onOpen(
                excerpt.bookId,
                excerpt.hits[0]?.from ?? excerpt.span.from,
                excerpt.hits[0]?.to,
              )
            }
            seat={() => props.seat(excerpt.bookId)}
            analyze={props.analyze}
            pair={props.renderPair?.(excerpt)}
            onExpand={
              props.onExpand === undefined
                ? undefined
                : (direction) => props.onExpand?.(sid, direction)
            }
            active={props.focus === sid ? props.activeHit : undefined}
            mode={props.mode ?? "regular"}
          />
        )}
      />
    </div>
  );
}
