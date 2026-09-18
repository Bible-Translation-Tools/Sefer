/**
 * The playground frame: a dial bar, an experiment picker, and one real bench.
 *
 * It is deliberately NOT a screen of the application. It sits under
 * `/project/$slug` so the shell has already opened a project — real books, real
 * text, the real Galley service — and then gets out of the way: no icon rail,
 * no location bar, no command palette. What is left is the thing being tried.
 *
 * Everything the frame knows how to do, it does once for every experiment:
 *
 *   * pick a book, and a baseline to put beside it (`bench.ts`);
 *   * render whatever dials an experiment declared, and remember them;
 *   * remember which experiment was open, so a reload lands back on it.
 *
 * Remembered in `sessionStorage` rather than the URL: the state is "where I had
 * got to", not a place anyone should link to, and a prototype whose settings
 * live in search params grows a `validateSearch` schema nobody wants to
 * maintain. Per tab, so two tabs can show two variants side by side.
 */

import { For, Show, createMemo, createSignal } from "solid-js";

import { useShell } from "../../app/ProjectContext";
import { Badge, Card, SegmentedControl, Select, Switch } from "../../app/ui/primitives";
import { ShellGate } from "../../app/ui/ShellGate";
import { benchFor } from "./bench";
import type { Dial, DialValues, Experiment } from "./experiment";
import { experiments } from "./registry";

const STORE = "sefer.playground";

/** One flat map for everything the frame remembers; see the module note. */
const remembered = (): Readonly<Record<string, string>> => {
  try {
    const held: unknown = JSON.parse(sessionStorage.getItem(STORE) ?? "{}");
    if (typeof held !== "object" || held === null) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(held)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
};

const remember = (key: string, value: string): void => {
  try {
    sessionStorage.setItem(STORE, JSON.stringify({ ...remembered(), [key]: value }));
  } catch {
    // A prototype that refuses to render because storage is disabled would be
    // a worse tool than one that forgets.
  }
};

/** A remembered signal: reads once from storage, writes back on every set. */
const stored = (key: string, fallback: string): [() => string, (value: string) => void] => {
  const [held, setHeld] = createSignal(remembered()[key] ?? fallback, {
    name: `playground:${key}`,
  });
  return [
    held,
    (value: string) => {
      setHeld(value);
      remember(key, value);
    },
  ];
};

const dialInitial = (dial: Dial): string =>
  dial.kind === "toggle" ? String(dial.initial ?? false) : (dial.initial ?? dial.options[0] ?? "");

function Playground() {
  const shell = useShell();
  const services = shell.services;

  const [chosenId, setChosenId] = stored("experiment", experiments[0]?.id ?? "");
  const [bookId, setBookId] = stored("book", "");
  const [baseline, setBaseline] = stored("baseline", "draft");
  const [density, setDensity] = stored("density", "light");
  const [dials, setDials] = createSignal<Readonly<Record<string, string>>>(remembered(), {
    name: "playgroundDials",
  });

  const chosen = createMemo(
    (): Experiment | undefined =>
      experiments.find((experiment) => experiment.id === chosenId()) ?? experiments[0],
    { name: "playgroundExperiment" },
  );

  const books = (): readonly string[] => shell.project()?.books.map((book) => book.id) ?? [];

  /** The book on the bench: what was remembered, else whatever the project has first. */
  const onBench = (): string | undefined => {
    const held = bookId();
    return books().includes(held) ? held : books()[0];
  };

  const bench = createMemo(
    () =>
      benchFor({
        project: shell.project(),
        galley: services.galley,
        save: services.save,
        bookId: onBench(),
        baseline: baseline() === "disk" ? "disk" : "draft",
        density: density(),
      }),
    { name: "playgroundBench" },
  );

  /**
   * A dial's value, defaulted from its declaration. Keyed by experiment id as
   * well as dial key, so two experiments may both have a `layout` without
   * inheriting each other's answer.
   */
  const dialKey = (key: string): string => `${chosen()?.id ?? ""}.${key}`;
  const dialValue = (key: string): string => {
    const spec = chosen()?.dials?.[key];
    if (spec === undefined) return "";
    return dials()[dialKey(key)] ?? dialInitial(spec);
  };
  const setDial = (key: string, value: string): void => {
    setDials((held) => ({ ...held, [dialKey(key)]: value }));
    remember(dialKey(key), value);
  };

  const values: DialValues = {
    toggle: (key) => dialValue(key) === "true",
    choice: (key) => dialValue(key),
  };

  const stage = (): Experiment | undefined => chosen();

  return (
    <div class="flex h-full min-h-0 flex-col bg-surface-primary">
      <header class="flex flex-col gap-2 border-b border-surface-border px-4 py-3">
        <div class="flex flex-wrap items-center gap-3">
          <Badge tone="warning">dev only</Badge>
          <h1 class="text-base font-semibold text-on-surface-primary">Playground</h1>
          <p class="text-smallest text-on-surface-tertiary">
            Real project text, no clicking around. Drop a file in{" "}
            <code>src/dev/playground/local/</code> and it appears here, untracked.
          </p>
        </div>

        {/* The bench: which book, against what. Shared by every experiment,
            because "the thing I am looking at" should not reset when I switch
            between two layouts of it. */}
        <div class="flex flex-wrap items-center gap-3 text-smallest text-on-surface-secondary">
          <label class="flex items-center gap-1.5">
            Book
            <Select
              size="sm"
              wrapperClass="w-28"
              value={onBench() ?? ""}
              onChange={(event) => setBookId(event.currentTarget.value)}
            >
              <For each={books()}>{(id) => <option value={id}>{id}</option>}</For>
            </Select>
          </label>

          <label class="flex items-center gap-1.5">
            Against
            <Select
              size="sm"
              wrapperClass="w-56"
              value={baseline()}
              onChange={(event) => setBaseline(event.currentTarget.value)}
            >
              <option value="draft">a synthetic earlier draft</option>
              <option value="disk">the file on disk</option>
            </Select>
          </label>

          <Show when={baseline() === "draft"}>
            <SegmentedControl
              size="sm"
              label="How much the draft differs"
              value={density()}
              onChange={setDensity}
              items={[
                { value: "light", label: "light" },
                { value: "normal", label: "normal" },
                { value: "heavy", label: "heavy" },
              ]}
            />
          </Show>

          <Show when={bench()}>
            {(held) => (
              <span class="text-on-surface-tertiary">
                {held().skeleton?.units.filter((unit) => unit.status !== "unchanged").length ?? 0}{" "}
                changed units of {held().skeleton?.units.length ?? 0}
              </span>
            )}
          </Show>
        </div>

        {/* The experiments, and then whatever the chosen one asked for. */}
        <div class="flex flex-wrap items-center gap-3">
          <Show
            when={experiments.length > 0}
            fallback={
              <p class="text-smallest text-on-surface-tertiary">
                No experiments yet — add one under <code>experiments/</code> or <code>local/</code>.
              </p>
            }
          >
            <SegmentedControl
              size="sm"
              label="Experiment"
              value={chosen()?.id ?? ""}
              onChange={setChosenId}
              items={experiments.map((experiment) => ({
                value: experiment.id,
                label: experiment.title,
                title: experiment.blurb,
              }))}
            />
          </Show>

          <For each={Object.entries(stage()?.dials ?? {})}>
            {([key, dial]) => (
              <Show
                when={dial.kind === "choice" ? dial : undefined}
                fallback={
                  <Switch
                    class="text-smallest text-on-surface-secondary"
                    checked={dialValue(key) === "true"}
                    onChange={(on) => setDial(key, String(on))}
                    label={dial.label}
                  />
                }
              >
                {(choice) => (
                  <label class="flex items-center gap-1.5 text-smallest text-on-surface-secondary">
                    {choice().label}
                    <Select
                      size="sm"
                      wrapperClass="w-36"
                      value={dialValue(key)}
                      onChange={(event) => setDial(key, event.currentTarget.value)}
                    >
                      <For each={choice().options}>
                        {(option) => <option value={option}>{option}</option>}
                      </For>
                    </Select>
                  </label>
                )}
              </Show>
            )}
          </For>
        </div>
      </header>

      <main class="min-h-0 flex-1 overflow-auto" data-experiment={chosen()?.id}>
        {/* `keyed`, and it matters: without it a `Show` re-runs its child only
            when the condition crosses falsy, so switching experiments would
            swap the label and leave the previous one on screen. Keyed remounts
            on identity, which is exactly "a different experiment". */}
        <Show
          keyed
          when={stage()}
          fallback={
            <Card class="m-4 p-4 text-small text-on-surface-secondary">Nothing to show yet.</Card>
          }
        >
          {(experiment) =>
            experiment.view({
              get bench() {
                return bench();
              },
              dials: values,
            })
          }
        </Show>
      </main>
    </div>
  );
}

/** The route's component: the gate, then the frame. */
export const PlaygroundPage = () => <ShellGate>{() => <Playground />}</ShellGate>;
