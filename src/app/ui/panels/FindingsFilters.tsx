import type { BookId } from "@sefer/text/book";
import { bookName } from "@sefer/text/location/canon";
import Search from "lucide-solid/icons/search";
import { Show, createEffect, createSignal, untrack } from "solid-js";

import type { Facet, Facets, FindingsFilter } from "#core/findings/filter";
import type { Producer, Severity } from "#core/findings/finding";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import {
  Badge,
  BookScope,
  Input,
  MultiSelect,
  scopeBooks,
  ToggleGroup,
  cx,
  severityTone,
  type BookScopeKind,
} from "../primitives";
import { metadataOf } from "../workspace/project";
import { codeLabel, producerLabel } from "./findingLabels";
import { chosen, narrowed, toggled, type FindingsFilterState } from "./findingsFilter";

const countOf = <T,>(rows: readonly Facet<T>[], value: T): number =>
  rows.find((row) => row.value === value)?.count ?? 0;

export interface FindingsFiltersProps {
  readonly state: FindingsFilterState;
  readonly facets: Facets;
  readonly books: readonly BookId[];
  readonly class?: string;
}

export function FindingsFilters(props: FindingsFiltersProps) {
  const filter = (): FindingsFilter => props.state.filter();
  const shell = useShell();
  const nameOf = (bookId: BookId): string => bookName(bookId, metadataOf(shell.project()));

  const [kind, setKind] = createSignal<BookScopeKind>(
    untrack(() => (filter().books === null ? "project" : "custom")),
    { name: "findingsScope" },
  );
  const [custom, setCustom] = createSignal<readonly BookId[]>(
    untrack(() => filter().books ?? []),
    {
      name: "findingsCustomBooks",
    },
  );
  const thisBook = (): BookId | undefined => {
    const project = shell.project();
    return (
      shell.focused()?.id ??
      (project === undefined ? undefined : shell.lastLocation(project.root)?.bookId)
    );
  };
  createEffect(
    () => ({ kind: kind(), custom: custom(), focused: thisBook(), books: props.books }),
    (now) => {
      const books = scopeBooks(now.kind, now.books, now.focused, now.custom) ?? null;
      untrack(() => props.state.update({ books }));
    },
  );

  const some = (kept: number, total: number): string =>
    kept >= total ? t("all") : t("{kept} of {total}", { kept, total });

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
            <span class="flex-1">{producerLabel(facet.value)}</span>
            <Badge>{facet.count}</Badge>
          </>
        )}
      </MultiSelect>

      <BookScope
        value={kind()}
        onChange={setKind}
        books={props.books.map((id) => ({
          id,
          name: nameOf(id),
          count: countOf(props.facets.books, id),
        }))}
        custom={custom()}
        onCustom={setCustom}
        hasFocused={thisBook() !== undefined}
      />

      <Show when={props.facets.codes.length > 0}>
        <MultiSelect
          id="code"
          label={t("Codes")}
          summary={narrowedSummary(filter().codes, props.facets.codes.length)}
          narrowed={filter().codes !== null}
          items={props.facets.codes}
          key={(facet: Facet<string>) => facet.value}
          match={(facet, query) =>
            byText(codeLabel(facet.value), query) || byText(facet.value, query)
          }
          selected={(facet) => chosen(filter().codes, facet.value)}
          onToggle={(facet) => props.state.update({ codes: narrowed(filter().codes, facet.value) })}
          clear={{ label: t("All codes"), onClear: () => props.state.update({ codes: null }) }}
        >
          {(facet) => (
            <>
              <span class="flex-1 truncate" title={facet.value}>
                {codeLabel(facet.value)}
              </span>
              <Badge>{facet.count}</Badge>
            </>
          )}
        </MultiSelect>
      </Show>

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
    </div>
  );
}
