/**
 * The findings panel's filter card — the left column of `<FindingsPanel>`.
 *
 * Every control here is subtractive: a chip hides rows, it never deletes a
 * finding, and the header beside it always says "N of TOTAL shown" so a
 * filtered panel cannot read as a clean project.
 *
 * The chips are `<button>`s carrying `aria-pressed`, not checkboxes: the state
 * is the attribute a screen reader already reads, and a chip row is easier to
 * read when the pressed look comes from that attribute. The COUNT inside a
 * chip is a `Badge` — counts are what badges are for, and the severity chips
 * take the severity's own tone, which is the only colour on this card.
 *
 * `Badge` is deliberately not the button: the primitive is text only, never
 * interactive (see `primitives/Badge.tsx`), so the chip is the button and the
 * badge rides inside it.
 */

import type { JSX } from "@solidjs/web";
import Search from "lucide-solid/icons/search";
import { For, Show } from "solid-js";

import type { BookId } from "../../../core/book/book";
import type { Facet, Facets, FindingsFilter } from "../../../core/findings/filter";
import type { Producer, Severity } from "../../../core/findings/finding";
import { t } from "../../i18n";
import { Badge, Button, Card, Input, Switch, cx, severityTone } from "../primitives";
import { chosen, narrowed, toggled, type FindingsFilterState } from "./findingsFilter";

/** How many codes the picker offers before it stops being a picker. */
const TOP_CODES = 8;

const CHIP = [
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
  "text-smallest font-medium whitespace-nowrap cursor-pointer select-none transition-colors",
  "border-surface-border bg-surface-primary text-on-surface-secondary",
  "hover:not-disabled:border-brand/40 hover:not-disabled:text-on-surface-primary",
  "aria-pressed:border-brand aria-pressed:bg-brand-light aria-pressed:text-brand",
].join(" ");

/** A titled band of chips. The rule above it is the whole separation. */
function Group(props: { readonly title: string; readonly children: JSX.Element }) {
  return (
    <section class="space-y-2 border-t border-surface-border pt-3 first:border-0 first:pt-0">
      <h3 class="text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

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

  const codes = (): readonly Facet<string>[] => props.facets.codes.slice(0, TOP_CODES);

  return (
    <Card class={cx("space-y-3", props.class)} aria-label={t("Filters")}>
      <Group title={t("Severity")}>
        <div class="flex flex-wrap gap-1.5" data-filter="severity">
          <For each={props.facets.severities}>
            {(facet: Facet<Severity>) => (
              <button
                type="button"
                class={CHIP}
                data-severity={facet.value}
                aria-pressed={filter().severities.includes(facet.value) ? "true" : "false"}
                onClick={() =>
                  props.state.update({ severities: toggled(filter().severities, facet.value) })
                }
              >
                {t(facet.value)}
                <Badge tone={severityTone(facet.value)}>{facet.count}</Badge>
              </button>
            )}
          </For>
        </div>
      </Group>

      <Group title={t("Producer")}>
        <div class="flex flex-wrap gap-1.5" data-filter="producer">
          <For each={props.facets.producers}>
            {(facet: Facet<Producer>) => (
              <button
                type="button"
                class={CHIP}
                data-producer={facet.value}
                aria-pressed={filter().producers.includes(facet.value) ? "true" : "false"}
                onClick={() =>
                  props.state.update({ producers: toggled(filter().producers, facet.value) })
                }
              >
                {t(facet.value)}
                <Badge>{facet.count}</Badge>
              </button>
            )}
          </For>
        </div>
        <Switch
          id="findings-hide-stale"
          checked={filter().hideStale}
          onChange={(on) => props.state.update({ hideStale: on })}
          label={t("Hide stale")}
        />
      </Group>

      <Group title={t("Books")}>
        <div class="flex flex-wrap gap-1.5" data-filter="book">
          <For each={props.books}>
            {(bookId) => (
              <button
                type="button"
                class={CHIP}
                data-book={bookId}
                aria-pressed={chosen(filter().books, bookId) ? "true" : "false"}
                onClick={() => props.state.update({ books: narrowed(filter().books, bookId) })}
              >
                {bookId}
                <Badge>{countOf(props.facets.books, bookId)}</Badge>
              </button>
            )}
          </For>
        </div>
        <Show when={filter().books !== null}>
          <Button size="sm" variant="tertiary" onClick={() => props.state.update({ books: null })}>
            {t("All books")}
          </Button>
        </Show>
      </Group>

      <Show when={codes().length > 0}>
        <Group title={t("Codes")}>
          <div class="flex flex-wrap gap-1.5" data-filter="code">
            <For each={codes()}>
              {(facet) => (
                <button
                  type="button"
                  class={CHIP}
                  data-code={facet.value}
                  aria-pressed={chosen(filter().codes, facet.value) ? "true" : "false"}
                  onClick={() =>
                    props.state.update({ codes: narrowed(filter().codes, facet.value) })
                  }
                >
                  <code class="font-mono">{facet.value}</code>
                  <Badge>{facet.count}</Badge>
                </button>
              )}
            </For>
          </div>
          <Show when={filter().codes !== null}>
            <Button
              size="sm"
              variant="tertiary"
              onClick={() => props.state.update({ codes: null })}
            >
              {t("All codes")}
            </Button>
          </Show>
        </Group>
      </Show>

      <Group title={t("Text")}>
        <Input
          type="search"
          size="sm"
          wrapperClass="w-full"
          icon={<Search size={13} />}
          aria-label={t("Filter findings")}
          placeholder={t("Filter by text…")}
          value={filter().text}
          onInput={(event) => props.state.update({ text: event.currentTarget.value })}
        />
      </Group>
    </Card>
  );
}
