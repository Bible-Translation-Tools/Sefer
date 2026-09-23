/**
 * The findings panel's filter toolbar — one row above the list.
 *
 * It used to be a column of chip groups down the left of the page: every
 * severity, every producer, every book in the project and the top eight codes,
 * all open at once. That is a lot of screen for four questions a reader asks
 * rarely, and on a project with sixty-six books the book chips alone pushed the
 * findings themselves below the fold. So each group folds into a Popover whose
 * trigger says what it is filtering to, and the row is four buttons and a
 * search box.
 *
 * Every control is still subtractive: a chip hides rows, it never deletes a
 * finding, and the header beside it always says "N of TOTAL shown" so a
 * filtered panel cannot read as a clean project.
 *
 * The chips inside are `<button>`s carrying `aria-pressed`, not checkboxes: the
 * state is the attribute a screen reader already reads, and a chip row is
 * easier to read when the pressed look comes from that attribute. The COUNT
 * inside a chip is a `Badge` — counts are what badges are for, and the severity
 * chips take the severity's own tone, which is the only colour here.
 *
 * `Badge` is deliberately not the button: the primitive is text only, never
 * interactive (see `primitives/Badge.tsx`), so the chip is the button and the
 * badge rides inside it.
 */

import type { JSX } from "@solidjs/web";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Search from "lucide-solid/icons/search";
import { For, Show, createSignal } from "solid-js";

import type { BookId } from "#core/book/book";
import type { Facet, Facets, FindingsFilter } from "#core/findings/filter";
import type { Producer, Severity } from "#core/findings/finding";

import { t } from "../../i18n";
import { Badge, Button, Input, Popover, Switch, cx, severityTone } from "../primitives";
import { chosen, narrowed, toggled, type FindingsFilterState } from "./findingsFilter";

/** How many codes the picker offers before it stops being a picker. */
const TOP_CODES = 12;

const CHIP = [
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
  "text-smallest font-medium whitespace-nowrap cursor-pointer select-none transition-colors",
  "border-surface-border bg-surface-primary text-on-surface-secondary",
  "hover:not-disabled:border-brand/40 hover:not-disabled:text-on-surface-primary",
  "aria-pressed:border-brand aria-pressed:bg-brand-light aria-pressed:text-brand",
].join(" ");

const TRIGGER = [
  "inline-flex items-center gap-1.5 rounded-md border border-surface-border bg-surface-primary",
  "px-2.5 py-1.5 text-smallest font-medium text-on-surface-secondary cursor-pointer",
  "hover:bg-surface-secondary hover:text-on-surface-primary transition-colors",
  "data-narrowed:border-brand data-narrowed:bg-brand-light data-narrowed:text-brand",
].join(" ");

/**
 * One dropdown. The trigger carries what the group is currently narrowed to —
 * "Severity: 2 of 3", "Books: all" — because a folded filter that does not say
 * it is filtering is how a reader comes to believe a project is clean.
 */
function Group(props: {
  readonly title: string;
  readonly summary: string;
  /** True when this group is hiding something; the trigger says so in brand. */
  readonly narrowed: boolean;
  readonly children: JSX.Element;
  readonly id: string;
  readonly open: string;
  readonly onOpen: (id: string) => void;
}) {
  return (
    <Popover
      label={props.title}
      side="bottom"
      align="start"
      class="w-72 max-h-[22rem] overflow-y-auto"
      open={props.open === props.id}
      onOpenChange={(open) => props.onOpen(open ? props.id : "")}
      trigger={
        <button
          type="button"
          class={TRIGGER}
          data-filter-group={props.id}
          data-narrowed={props.narrowed ? "" : undefined}
          aria-expanded={props.open === props.id ? "true" : "false"}
        >
          {props.title}
          <span class="text-on-surface-tertiary">{props.summary}</span>
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      }
    >
      <div class="space-y-2">{props.children}</div>
    </Popover>
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
  const [open, setOpen] = createSignal("", { name: "findingsFilterMenu" });

  const codes = (): readonly Facet<string>[] => props.facets.codes.slice(0, TOP_CODES);

  /** "2 of 3" for an allow-list, and nothing at all when it allows everything. */
  const some = (kept: number, total: number): string =>
    kept >= total ? t("all") : t("{kept} of {total}", { kept, total });

  /** The same for a `null`-means-everything set. */
  const narrowedSummary = (held: readonly string[] | null, total: number): string =>
    held === null ? t("all") : t("{kept} of {total}", { kept: held.length, total });

  return (
    <div
      class={cx("flex flex-wrap items-center gap-2", props.class)}
      aria-label={t("Filters")}
      data-findings-filters
    >
      <Group
        id="severity"
        title={t("Severity")}
        summary={some(filter().severities.length, props.facets.severities.length)}
        narrowed={filter().severities.length < props.facets.severities.length}
        open={open()}
        onOpen={setOpen}
      >
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

      <Group
        id="producer"
        title={t("Producer")}
        summary={some(filter().producers.length, props.facets.producers.length)}
        narrowed={filter().producers.length < props.facets.producers.length}
        open={open()}
        onOpen={setOpen}
      >
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
      </Group>

      <Group
        id="book"
        title={t("Books")}
        summary={narrowedSummary(filter().books, props.books.length)}
        narrowed={filter().books !== null}
        open={open()}
        onOpen={setOpen}
      >
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
        <Group
          id="code"
          title={t("Codes")}
          summary={narrowedSummary(filter().codes, props.facets.codes.length)}
          narrowed={filter().codes !== null}
          open={open()}
          onOpen={setOpen}
        >
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

      {/* Inline, not folded: a text filter is the one control a reader reaches
          for without planning to, and a search box behind a menu is a search
          box nobody uses. */}
      <Input
        type="search"
        size="sm"
        wrapperClass="min-w-40 flex-1"
        icon={<Search size={13} />}
        aria-label={t("Filter findings")}
        placeholder={t("Filter by text…")}
        value={filter().text}
        onInput={(event) => props.state.update({ text: event.currentTarget.value })}
      />

      <Switch
        id="findings-hide-stale"
        checked={filter().hideStale}
        onChange={(on) => props.state.update({ hideStale: on })}
        label={t("Hide stale")}
      />
    </div>
  );
}
