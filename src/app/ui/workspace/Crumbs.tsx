/**
 * Book · Chapter, as two pickers: "where am I" and "take me somewhere else"
 * in the same two words.
 *
 * The editor's location bar was the only one; Review's Whole book wants the
 * same crumb over a different list — the books and chapters that CHANGED,
 * each with how many — so the crumb is here, and what it lists and what a
 * pick does are the caller's. `LocationBar` lists the project's books and the
 * book's chapters and asks the shell to go there; Review lists its changes
 * and steps to the first change in what was picked.
 */

import type { JSX } from "@solidjs/web";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import ListTree from "lucide-solid/icons/list-tree";
import { Show, createMemo, createSignal } from "solid-js";

import { fold } from "#core/location/names";

import { t } from "../../i18n";
import { FilterList, IconButton, Popover } from "../primitives";

export interface CrumbBook {
  readonly id: string;
  readonly name: string;
  /** Shown beside the name: how many changes, in Review. */
  readonly count?: number;
}

export interface CrumbChapter {
  /** What a pick hands back; the caller's key for the chapter. */
  readonly ordinal: number;
  /** As listed: "Intro", or `\c`'s label. */
  readonly label: string;
  readonly intro: boolean;
  readonly count?: number;
}

export interface CrumbsProps {
  /** The book crumb's words. */
  readonly book: string;
  readonly books: () => readonly CrumbBook[];
  readonly currentBook: string | undefined;
  /** A book filter beyond name and code: the shell's "mark 3". */
  readonly matchBook?: (book: CrumbBook, query: string) => boolean;
  readonly onBook: (book: CrumbBook, query: string) => void;
  /** The chapter crumb's words; empty hides the crumb. */
  readonly chapter: string;
  /** The chapters to list — asked only while the outline is open. */
  readonly chapters: () => readonly CrumbChapter[];
  readonly currentChapter: number | undefined;
  readonly onChapter: (ordinal: number) => void;
  /** Previous / next chapter, where the caller has them. */
  readonly step?: {
    readonly onPrevious: () => void;
    readonly onNext: () => void;
    readonly first: boolean;
    readonly last: boolean;
  };
  /** At the end of the strip, after the arrows: a pair's link, say. */
  readonly end?: JSX.Element;
}

/**
 * The strip a crumb sits in: pinned above the text it describes.
 *
 * OPAQUE, and deliberately not blurred. It was `bg-surface-primary/80
 * backdrop-blur-sm`, and `backdrop-filter` over a sticky strip makes the
 * compositor re-rasterize the scripture behind it on every frame of a scroll
 * AND after every keystroke — measurable, and the worst kind of cost because
 * it lands between the last state update and the paint, where no JS profile
 * shows it. A solid bar reads the text underneath no worse: it covers it.
 */
export function LocationStrip(props: {
  readonly children: JSX.Element;
  readonly testId?: string;
  readonly class?: string;
}) {
  return (
    <div
      data-testid={props.testId}
      class={[
        "sticky top-0 z-20 flex items-center gap-1 border-b border-surface-border bg-surface-primary px-3 py-1",
        props.class,
      ]}
    >
      {props.children}
    </div>
  );
}

const crumb =
  "cursor-pointer truncate rounded px-1 py-0.5 text-smallest font-medium text-on-surface-secondary transition-colors hover:bg-surface-secondary hover:text-on-surface-primary";

function Count(props: { readonly count: number | undefined }) {
  return (
    <Show when={props.count}>
      {(count) => (
        <span class="ms-auto shrink-0 text-smallest text-on-surface-tertiary tabular-nums">
          {count()}
        </span>
      )}
    </Show>
  );
}

export function Crumbs(props: CrumbsProps) {
  const [outline, setOutline] = createSignal(false, { name: "crumbOutlineOpen" });
  const [picking, setPicking] = createSignal(false, { name: "crumbBookOpen" });
  // Built only while open: a book's chapters are a list nobody needs until
  // they ask for it.
  const rows = createMemo(() => (outline() ? props.chapters() : []), { name: "crumbRows" });

  return (
    <>
      <Popover
        label={t("Books")}
        side="bottom"
        align="start"
        class="flex max-h-[60vh] w-64 flex-col p-2"
        open={picking()}
        onOpenChange={setPicking}
        trigger={
          <button type="button" data-testid="location-book" class={crumb}>
            {props.book}
          </button>
        }
      >
        <FilterList
          label={t("Filter books")}
          placeholder={t("Book or code…")}
          items={props.books()}
          current={props.currentBook}
          key={(book) => book.id}
          // The CODE as well as the name: a translator types "mrk" as readily
          // as "Mark", and a project may hold a book the canon does not name.
          match={(book, query) => {
            const needle = fold(query);
            return (
              fold(book.name).includes(needle) ||
              book.id.toLowerCase().includes(needle) ||
              props.matchBook?.(book, query) === true
            );
          }}
          onPick={(book, query) => {
            setPicking(false);
            props.onBook(book, query);
          }}
        >
          {(book) => (
            <>
              <span class="w-9 shrink-0 font-mono text-smallest text-on-surface-tertiary">
                {book.id}
              </span>
              <span class="truncate">{book.name}</span>
              <Count count={book.count} />
            </>
          )}
        </FilterList>
      </Popover>

      <Show when={props.chapter !== ""}>
        <span aria-hidden="true" class="text-smallest text-on-surface-tertiary">
          ·
        </span>

        <Popover
          label={t("Outline")}
          side="bottom"
          align="start"
          class="flex max-h-[60vh] w-56 flex-col p-2"
          open={outline()}
          onOpenChange={setOutline}
          trigger={
            <button
              type="button"
              data-testid="location-chapter"
              class={["inline-flex items-center gap-1", crumb]}
            >
              {props.chapter}
              <ListTree size={12} aria-hidden="true" />
            </button>
          }
        >
          <FilterList
            label={t("Filter chapters")}
            placeholder={t("Chapter…")}
            items={rows()}
            current={props.currentChapter === undefined ? undefined : String(props.currentChapter)}
            key={(row) => String(row.ordinal)}
            match={(row, query) => fold(row.label).startsWith(fold(query))}
            onPick={(row) => {
              setOutline(false);
              props.onChapter(row.ordinal);
            }}
          >
            {(row) => (
              <>
                <span data-testid={`outline-${row.intro ? "intro" : row.label}`}>
                  {row.intro ? row.label : t("Chapter {label}", { label: row.label })}
                </span>
                <Count count={row.count} />
              </>
            )}
          </FilterList>
        </Popover>
      </Show>

      <span class="ms-auto flex items-center gap-0.5">
        <Show when={props.step}>
          {(step) => (
            <>
              <IconButton
                size="sm"
                data-testid="location-previous"
                label={t("Previous chapter")}
                tooltipSide="bottom"
                icon={<ChevronUp />}
                disabled={step().first}
                onClick={() => step().onPrevious()}
              />
              <IconButton
                size="sm"
                data-testid="location-next"
                label={t("Next chapter")}
                tooltipSide="bottom"
                icon={<ChevronDown />}
                disabled={step().last}
                onClick={() => step().onNext()}
              />
            </>
          )}
        </Show>
        {props.end}
      </span>
    </>
  );
}
