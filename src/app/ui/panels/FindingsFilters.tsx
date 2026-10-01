/**
 * The findings panel's filter toolbar — one row above the list.
 *
 * Severity is three values, so it is shown whole as a `ToggleGroup`. Producer
 * is a short `MultiSelect`; books and codes are long, so theirs are searchable
 * (a combobox). Each folded trigger says what it is filtering to, so the row is
 * a handful of controls and a search box.
 *
 * Every control is still subtractive: it hides rows, it never deletes a
 * finding, and the header beside it always says "N of TOTAL shown" so a
 * filtered panel cannot read as a clean project. Counts are `Badge`s, and the
 * severity ones take the severity's own tone, which is the only colour here.
 */

import Search from "lucide-solid/icons/search";
import { Show } from "solid-js";

import type { BookId } from "#core/book/book";
import type { Facet, Facets, FindingsFilter } from "#core/findings/filter";
import type { Producer, Severity } from "#core/findings/finding";
import { bookName } from "#core/location/canon";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Badge, Input, MultiSelect, Switch, ToggleGroup, cx, severityTone } from "../primitives";
import { metadataOf } from "../workspace/project";
import { chosen, narrowed, toggled, type FindingsFilterState } from "./findingsFilter";

const countOf = <T,>(rows: readonly Facet<T>[], value: T): number =>
  rows.find((row) => row.value === value)?.count ?? 0;

export interface FindingsFiltersProps {
  readonly state: FindingsFilterState;
  /** Counts over the UNFILTERED list, so a chip's count never moves as you click. */
  readonly facets: Facets;
  /** Every book in the project, from the census — clean ones included. */
  readonly books: readonly BookId[];
  readonly class?: string;
}

export function FindingsFilters(props: FindingsFiltersProps) {
  const filter = (): FindingsFilter => props.state.filter();
  const shell = useShell();
  /** What the project calls a book, else the English name, else its id. */
  const nameOf = (bookId: BookId): string => bookName(bookId, metadataOf(shell.project()));

  /** "2 of 3" for an allow-list, and nothing at all when it allows everything. */
  const some = (kept: number, total: number): string =>
    kept >= total ? t("all") : t("{kept} of {total}", { kept, total });

  /** The same for a `null`-means-everything set. */
  const narrowedSummary = (held: readonly string[] | null, total: number): string =>
    held === null ? t("all") : t("{kept} of {total}", { kept: held.length, total });

  const byText = (value: string, query: string): boolean =>
    value.toLowerCase().includes(query.toLowerCase());

  return (
    <div
      class={cx("flex flex-wrap items-center gap-2", props.class)}
      aria-label={t("Filters")}
      data-findings-filters
    >
      <ToggleGroup
        label={t("Severity")}
        items={props.facets.severities.map((facet: Facet<Severity>) => ({
          value: facet.value,
          label: t(facet.value),
          adornment: <Badge tone={severityTone(facet.value)}>{facet.count}</Badge>,
        }))}
        pressed={(value) => filter().severities.includes(value)}
        onToggle={(value) =>
          props.state.update({ severities: toggled(filter().severities, value) })
        }
      />

      <MultiSelect
        id="producer"
        label={t("Producer")}
        summary={some(filter().producers.length, props.facets.producers.length)}
        narrowed={filter().producers.length < props.facets.producers.length}
        items={props.facets.producers}
        key={(facet: Facet<Producer>) => facet.value}
        selected={(facet) => filter().producers.includes(facet.value)}
        onToggle={(facet) =>
          props.state.update({ producers: toggled(filter().producers, facet.value) })
        }
      >
        {(facet) => (
          <>
            <span class="flex-1">{t(facet.value)}</span>
            <Badge>{facet.count}</Badge>
          </>
        )}
      </MultiSelect>

      <MultiSelect
        id="book"
        label={t("Books")}
        summary={narrowedSummary(filter().books, props.books.length)}
        narrowed={filter().books !== null}
        items={props.books}
        key={(bookId: BookId) => bookId}
        match={(bookId, query) => byText(nameOf(bookId), query) || byText(bookId, query)}
        selected={(bookId) => chosen(filter().books, bookId)}
        onToggle={(bookId) => props.state.update({ books: narrowed(filter().books, bookId) })}
        clear={{ label: t("All books"), onClear: () => props.state.update({ books: null }) }}
      >
        {(bookId) => (
          <>
            <span class="flex-1">{nameOf(bookId)}</span>
            <Badge>{countOf(props.facets.books, bookId)}</Badge>
          </>
        )}
      </MultiSelect>

      <Show when={props.facets.codes.length > 0}>
        <MultiSelect
          id="code"
          label={t("Codes")}
          summary={narrowedSummary(filter().codes, props.facets.codes.length)}
          narrowed={filter().codes !== null}
          items={props.facets.codes}
          key={(facet: Facet<string>) => facet.value}
          match={(facet, query) => byText(facet.value, query)}
          selected={(facet) => chosen(filter().codes, facet.value)}
          onToggle={(facet) => props.state.update({ codes: narrowed(filter().codes, facet.value) })}
          clear={{ label: t("All codes"), onClear: () => props.state.update({ codes: null }) }}
        >
          {(facet) => (
            <>
              <code class="flex-1 truncate font-mono">{facet.value}</code>
              <Badge>{facet.count}</Badge>
            </>
          )}
        </MultiSelect>
      </Show>

      {/* Inline, not folded: a text filter is the one control a reader reaches
          for without planning to, and a search box behind a menu is a search
          box nobody uses. */}
      <Input
        type="search"
        size="sm"
        wrapperClass="min-w-40 flex-1"
        icon={<Search />}
        aria-label={t("Filter findings")}
        placeholder={t("Filter by text…")}
        value={filter().text}
        onInput={(event) => props.state.update({ text: event.currentTarget.value })}
      />

      {/* TODO(2026-10-01, Will): hidden until we decide what replaces the
          "Hide stale" switch on this screen; the filter logic still holds. */}
      <Switch
        id="findings-hide-stale"
        class="hidden"
        checked={filter().hideStale}
        onChange={(on) => props.state.update({ hideStale: on })}
        label={t("Hide stale")}
      />
    </div>
  );
}
