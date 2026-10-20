import { Effect, Fiber, Stream } from "effect";
import { createSignal, onCleanup, type Accessor } from "solid-js";

import { DEFAULT_FILTER, type FindingsFilter, type GroupKind } from "#core/findings/filter";

import type { Services } from "../../services";
import { shellKeys, type FindingsFilterPreference } from "../../settings";

export type FindingsView = GroupKind | "flat";

export const VIEWS: readonly { readonly value: FindingsView; readonly label: string }[] = [
  { value: "book", label: "By book" },
  { value: "code", label: "By code" },
  { value: "severity", label: "By severity" },
  { value: "flat", label: "Flat" },
];

export interface FindingsFilterState {
  readonly filter: Accessor<FindingsFilter>;
  readonly update: (patch: Partial<FindingsFilter>) => void;
  readonly view: Accessor<FindingsView>;
  readonly setView: (view: FindingsView) => void;
}

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

export const toggled = <T>(held: readonly T[], value: T): readonly T[] =>
  held.includes(value) ? held.filter((each) => each !== value) : [...held, value];

export const narrowed = <T>(held: readonly T[] | null, value: T): readonly T[] | null => {
  if (held === null) return [value];
  const next = toggled(held, value);
  return next.length === 0 ? null : next;
};

export const chosen = <T>(held: readonly T[] | null, value: T): boolean =>
  held === null || held.includes(value);
