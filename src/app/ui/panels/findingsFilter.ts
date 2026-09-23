/**
 * The findings filter's state, and the views it can be read through.
 *
 * `createFindingsFilter` owns the filter value — seeded from `Settings`, kept
 * live by a fiber over `settings.changes`, and written back whenever a
 * persistent part moves. `<FindingsFilters>` (the card beside the list) is the
 * only thing that edits it and `<FindingsPanel>` the only thing that reads it,
 * so the panel, the counts and the keyboard cursor cannot disagree about what
 * is being shown.
 *
 * What persists and what does not is the interesting part (vision §11.4):
 * severity, producer and "hide stale" are PREFERENCES and go through
 * `findings.filter` in settings; the free-text box, the book selection and the
 * view are SESSION state, because a remembered text filter presents as an
 * empty project and a remembered book set hides the book you just opened.
 *
 * Nothing here decides what a finding is. `applyFilter` (core) does the
 * subtraction and never deletes anything: every chip is about a screen.
 */

import { Effect, Fiber, Stream } from "effect";
import { createSignal, onCleanup, type Accessor } from "solid-js";

import { DEFAULT_FILTER, type FindingsFilter, type GroupKind } from "#core/findings/filter";

import type { Services } from "../../services";
import { shellKeys, type FindingsFilterPreference } from "../../settings";

/** How the list is broken up. `flat` is the absence of grouping. */
export type FindingsView = GroupKind | "flat";

/** The segments of the view control, in the order they are offered. */
export const VIEWS: readonly { readonly value: FindingsView; readonly label: string }[] = [
  { value: "book", label: "By book" },
  { value: "code", label: "By code" },
  { value: "severity", label: "By severity" },
  { value: "flat", label: "Flat" },
];

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
export const toggled = <T>(held: readonly T[], value: T): readonly T[] =>
  held.includes(value) ? held.filter((each) => each !== value) : [...held, value];

/**
 * The same for a `null`-means-everything set. `null` → just this one; the last
 * one off → back to `null`, because a set the reader emptied means "stop
 * restricting", not "show nothing".
 */
export const narrowed = <T>(held: readonly T[] | null, value: T): readonly T[] | null => {
  if (held === null) return [value];
  const next = toggled(held, value);
  return next.length === 0 ? null : next;
};

/** `null` (unrestricted) reads as chosen on every chip: everything is shown. */
export const chosen = <T>(held: readonly T[] | null, value: T): boolean =>
  held === null || held.includes(value);
