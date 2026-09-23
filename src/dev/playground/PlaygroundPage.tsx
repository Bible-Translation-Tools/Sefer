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
 *   * render whatever dials an experiment declared;
 *   * hold all of it in the URL.
 *
 * That last one used to be the opposite. This file argued for `sessionStorage`
 * on the grounds that the state was "where I had got to, not a place anyone
 * should link to", and that search params would grow a `validateSearch` schema
 * nobody wants to maintain.
 *
 * Both halves have stopped being true. A designer works here now, and the
 * whole of that job is sending somebody two links and asking which is better —
 * so which experiment, which book, which baseline and every dial have to
 * survive copy, paste and reload. And the schema worry is answered by not
 * having one: the route keeps whatever string keys it is given, dial keys are
 * namespaced by experiment id, and adding a knob still costs one line in the
 * experiment and nothing anywhere else.
 *
 * Nothing is left in storage, so two tabs still show two variants side by side
 * — they just do it with two URLs, which is the version you can send.
 */

import { getRouteApi, useNavigate } from "@tanstack/solid-router";
import { For, Show, createMemo } from "solid-js";

import { useShell } from "../../app/ProjectContext";
import { Badge, Card, SegmentedControl, Select, Switch } from "../../app/ui/primitives";
import { ShellGate } from "../../app/ui/ShellGate";
import { dialValues, withDial, type Dials } from "../dials";
import { benchFor } from "./bench";
import type { DialValues, Experiment } from "./experiment";
import { experiments } from "./registry";

// By id, not by importing the route module: that module lazy-loads this
// page, so importing it back would make a cycle.
const Route = getRouteApi("/_app/project/$slug/playground");

function Playground() {
  const shell = useShell();
  const services = shell.services;
  const navigate = useNavigate();
  const search = Route.useSearch();

  /**
   * One navigation, merged over what the URL already says. `replace`, so
   * turning a dial four times leaves one entry in the history rather than four
   * — Back should undo the last thing you looked at, not the last keystroke.
   */
  const ask = (next: Record<string, string>): void => {
    void navigate({
      to: "/project/$slug/playground",
      params: { slug: shell.slug() },
      search: next,
      replace: true,
    });
  };

  /** A top-level frame key: written when it differs from the default, dropped when it does not. */
  const set = (key: string, value: string, fallback: string): void => {
    const next = { ...search() };
    if (value === fallback) delete next[key];
    else next[key] = value;
    ask(next);
  };

  const chosenId = (): string => search()["experiment"] ?? experiments[0]?.id ?? "";
  const setChosenId = (id: string): void => set("experiment", id, experiments[0]?.id ?? "");
  const bookId = (): string => search()["book"] ?? "";
  const setBookId = (id: string): void => set("book", id, "");
  const baseline = (): string => search()["baseline"] ?? "draft";
  const setBaseline = (which: string): void => set("baseline", which, "draft");
  const density = (): string => search()["density"] ?? "light";
  const setDensity = (how: string): void => set("density", how, "light");

  const chosen = createMemo(
    (): Experiment | undefined =>
      experiments.find((experiment) => experiment.id === chosenId()) ?? experiments[0],
    { name: "playgroundExperiment" },
  );

  const books = (): readonly string[] => shell.project()?.books.map((book) => book.id) ?? [];

  /**
   * The book on the bench: whatever the URL names, else the project's first.
   * A link naming a book this project does not have falls back rather than
   * showing nothing, because the commonest way to get one is to send a
   * playground link to somebody with a different project open.
   */
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
   * Dials, from `src/dev/dials.ts` — shared with `/design`, because a knob on
   * a prototype is the same idea whichever frame is holding it. Keyed by
   * experiment id as well as dial key, so two experiments may both have a
   * `layout` without inheriting each other's answer.
   */
  const dialsOf = (): Dials => chosen()?.dials ?? {};
  const current = (): DialValues => dialValues(chosen()?.id ?? "", dialsOf(), search);
  const values: DialValues = {
    toggle: (key) => current().toggle(key),
    choice: (key) => current().choice(key),
  };
  const dialValue = (key: string): string => values.choice(key);
  const setDial = (key: string, value: string): void => {
    ask(withDial(search(), chosen()?.id ?? "", dialsOf(), key, value));
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
