/**
 * The findings panel's filter row, and the state behind it.
 *
 * Two things live here because they are one decision. `createFindingsFilter`
 * owns the filter value — seeded from `Settings`, kept live by a fiber over
 * `settings.changes`, and written back whenever a persistent part moves — and
 * `<FindingsFilters>` is the chip row that edits it. One source of truth, so
 * the panel, the counts and the keyboard cursor cannot disagree about what is
 * being shown.
 *
 * What persists and what does not is the interesting part (vision §11.4):
 * severity, producer and "hide stale" are PREFERENCES and go through
 * `findings.filter` in settings; the free-text box, the book selection and the
 * view are SESSION state, because a remembered text filter presents as an
 * empty project and a remembered book set hides the book you just opened.
 *
 * Nothing here decides what a finding is. `applyFilter` (core) does the
 * subtraction and never deletes anything: every chip below is about a screen.
 *
 * The chips are `Button`s with `aria-pressed`, not checkboxes: the state is
 * the attribute a screen reader already reads, and the primitive styles it.
 */

import { Effect, Fiber, Stream } from "effect";
import { For, Show, createSignal, onCleanup, type Accessor } from "solid-js";

import type { BookId } from "../../core/book/book";
import {
  DEFAULT_FILTER,
  type Facet,
  type Facets,
  type FindingsFilter,
  type GroupKind,
} from "../../core/findings/filter";
import type { Producer, Severity } from "../../core/findings/finding";
import { t } from "../i18n";
import type { Services } from "../services";
import { shellKeys, type FindingsFilterPreference } from "../settings";
import { Button, Card, Input } from "./primitives";

/** How the list is broken up. `flat` is the absence of grouping. */
export type FindingsView = GroupKind | "flat";

const VIEWS: readonly { readonly view: FindingsView; readonly label: string }[] = [
  { view: "book", label: "By book" },
  { view: "code", label: "By code" },
  { view: "severity", label: "By severity" },
  { view: "flat", label: "Flat" },
];

/** How many codes the picker offers before it stops being a picker. */
const TOP_CODES = 8;

/** Every chip wears the same shape; only the state differs. */
const CHIP = "rounded-full px-2.5";

export interface FindingsFilterState {
  readonly filter: Accessor<FindingsFilter>;
  /** Replaces the named parts; persistent parts are written through Settings. */
  readonly update: (patch: Partial<FindingsFilter>) => void;
  readonly view: Accessor<FindingsView>;
  readonly setView: (view: FindingsView) => void;
}

/**
 * The filter, live.
 *
 * Call it from a component body: it forks a fiber over `settings.changes` and
 * interrupts it on cleanup, exactly as `ProjectContext` does for
 * `editor.preferChapterView` — a second window, or the settings file changing
 * underneath us, must move this panel rather than wait for a reload.
 *
 * A write goes to `Settings.set` on every click. No debounce: a chip click is
 * a deliberate act, the file is small, and `set` writes it atomically.
 */
export const createFindingsFilter = (services: Services): FindingsFilterState => {
  const keys = shellKeys(services.settings);
  const stored = services.settings.get(keys.findingsFilter);
  const [filter, setFilter] = createSignal<FindingsFilter>(
    { ...DEFAULT_FILTER, ...stored },
    { name: "findingsFilter" },
  );
  const [view, setView] = createSignal<FindingsView>("book", { name: "findingsView" });

  const watching = services.runtime.runFork(
    Stream.runForEach(services.settings.changes(keys.findingsFilter), (next) =>
      Effect.sync(() => setFilter((held) => ({ ...held, ...next }))),
    ),
  );
  onCleanup(() => {
    Effect.runFork(Fiber.interrupt(watching));
  });

  const persist = (next: FindingsFilter): void => {
    const preference: FindingsFilterPreference = {
      severities: next.severities,
      producers: next.producers,
      hideStale: next.hideStale,
    };
    // Fire and forget, through `Effect.result` so a refused write cannot
    // reject an unhandled promise: the in-memory value is already what the
    // reader asked for, and Settings notes its own refusals.
    void services.run(Effect.result(services.settings.set(keys.findingsFilter, preference)));
  };

  const update = (patch: Partial<FindingsFilter>): void => {
    const next = { ...filter(), ...patch };
    setFilter(next);
    const touchesPreference =
      patch.severities !== undefined ||
      patch.producers !== undefined ||
      patch.hideStale !== undefined;
    if (touchesPreference) persist(next);
  };

  return {
    filter,
    update,
    view,
    setView: (next) => {
      setView(next);
    },
  };
};

/**
 * Adds or removes one member of an allow-list. Toggling the last one off is
 * allowed: "no severities" shows an empty list, which is a state the reader
 * can see and can undo, and pretending otherwise would make one chip
 * un-clickable for no reason a reader could infer.
 */
const toggled = <T,>(held: readonly T[], value: T): readonly T[] =>
  held.includes(value) ? held.filter((each) => each !== value) : [...held, value];

/**
 * The same for a `null`-means-everything set. `null` → just this one; the last
 * one off → back to `null`, because a set the reader emptied means "stop
 * restricting", not "show nothing".
 */
const narrowed = <T,>(held: readonly T[] | null, value: T): readonly T[] | null => {
  if (held === null) return [value];
  const next = toggled(held, value);
  return next.length === 0 ? null : next;
};

/** `null` (unrestricted) reads as pressed on every chip: everything is shown. */
const chosen = <T,>(held: readonly T[] | null, value: T): boolean =>
  held === null || held.includes(value);

const countOf = <T,>(rows: readonly Facet<T>[], value: T): number =>
  rows.find((row) => row.value === value)?.count ?? 0;

export interface FindingsFiltersProps {
  readonly state: FindingsFilterState;
  /** Counts over the UNFILTERED list, so a chip's count never moves as you click. */
  readonly facets: Facets;
  /** Every book in the project, from the census — clean ones included. */
  readonly books: readonly BookId[];
}

export function FindingsFilters(props: FindingsFiltersProps) {
  const filter = (): FindingsFilter => props.state.filter();

  const codes = (): readonly Facet<string>[] => props.facets.codes.slice(0, TOP_CODES);

  return (
    <Card class="space-y-2" aria-label={t("Filters")}>
      <div class="flex flex-wrap items-center gap-1.5" data-filter="severity">
        <span class="text-smallest text-on-surface-tertiary">{t("Severity")}</span>
        <For each={props.facets.severities}>
          {(facet: Facet<Severity>) => (
            <Button
              size="sm"
              variant="tertiary"
              class={CHIP}
              data-severity={facet.value}
              aria-pressed={filter().severities.includes(facet.value) ? "true" : "false"}
              onClick={() =>
                props.state.update({ severities: toggled(filter().severities, facet.value) })
              }
            >
              {t(facet.value)} <span class="opacity-60">{facet.count}</span>
            </Button>
          )}
        </For>

        <span class="ms-2 text-smallest text-on-surface-tertiary">{t("Producer")}</span>
        <For each={props.facets.producers}>
          {(facet: Facet<Producer>) => (
            <Button
              size="sm"
              variant="tertiary"
              class={CHIP}
              data-producer={facet.value}
              aria-pressed={filter().producers.includes(facet.value) ? "true" : "false"}
              onClick={() =>
                props.state.update({ producers: toggled(filter().producers, facet.value) })
              }
            >
              {t(facet.value)} <span class="opacity-60">{facet.count}</span>
            </Button>
          )}
        </For>

        <Button
          size="sm"
          variant="tertiary"
          class={`${CHIP} ms-auto`}
          aria-pressed={filter().hideStale ? "true" : "false"}
          onClick={() => props.state.update({ hideStale: !filter().hideStale })}
        >
          {t("Hide stale")}
        </Button>
      </div>

      <div class="flex flex-wrap items-center gap-1.5" data-filter="book">
        <span class="text-smallest text-on-surface-tertiary">{t("Books")}</span>
        <For each={props.books}>
          {(bookId) => (
            <Button
              size="sm"
              variant="tertiary"
              class={CHIP}
              data-book={bookId}
              aria-pressed={chosen(filter().books, bookId) ? "true" : "false"}
              onClick={() => props.state.update({ books: narrowed(filter().books, bookId) })}
            >
              {bookId} <span class="opacity-60">{countOf(props.facets.books, bookId)}</span>
            </Button>
          )}
        </For>
        <Show when={filter().books !== null}>
          <Button size="sm" variant="tertiary" onClick={() => props.state.update({ books: null })}>
            {t("All books")}
          </Button>
        </Show>
      </div>

      <Show when={codes().length > 0}>
        <div class="flex flex-wrap items-center gap-1.5" data-filter="code">
          <span class="text-smallest text-on-surface-tertiary">{t("Codes")}</span>
          <For each={codes()}>
            {(facet) => (
              <Button
                size="sm"
                variant="tertiary"
                class={CHIP}
                data-code={facet.value}
                aria-pressed={chosen(filter().codes, facet.value) ? "true" : "false"}
                onClick={() => props.state.update({ codes: narrowed(filter().codes, facet.value) })}
              >
                <code class="font-mono">{facet.value}</code>{" "}
                <span class="opacity-60">{facet.count}</span>
              </Button>
            )}
          </For>
          <Show when={filter().codes !== null}>
            <Button
              size="sm"
              variant="tertiary"
              onClick={() => props.state.update({ codes: null })}
            >
              {t("All codes")}
            </Button>
          </Show>
        </div>
      </Show>

      <div class="flex flex-wrap items-center gap-1.5" data-filter="view">
        <Input
          type="search"
          size="sm"
          wrapperClass="w-56"
          aria-label={t("Filter findings")}
          placeholder={t("Filter by text…")}
          value={filter().text}
          onInput={(event) => props.state.update({ text: event.currentTarget.value })}
        />
        <div class="ms-auto flex flex-wrap items-center gap-1.5">
          <For each={VIEWS}>
            {(option) => (
              <Button
                size="sm"
                variant="tertiary"
                class={CHIP}
                data-view={option.view}
                aria-pressed={props.state.view() === option.view ? "true" : "false"}
                onClick={() => props.state.setView(option.view)}
              >
                {t(option.label)}
              </Button>
            )}
          </For>
        </div>
      </div>
    </Card>
  );
}
