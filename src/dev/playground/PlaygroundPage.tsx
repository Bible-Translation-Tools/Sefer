import { getRouteApi, useNavigate } from "@tanstack/solid-router";
import { For, Show, createMemo } from "solid-js";

import { useShell } from "#app/ProjectContext";
import { Badge, Card, SegmentedControl, Select, Switch } from "#app/ui/primitives";
import { ShellGate } from "#app/ui/ShellGate";
import { BackToEditor } from "#app/ui/workspace/BackToEditor";

import { dialValues, withDial, type Dials } from "../dials";
import { benchFor } from "./bench";
import type { DialValues, Experiment } from "./experiment";
import { experiments } from "./registry";

const Route = getRouteApi("/_app/project/$slug/playground");

const SENTINEL = "__sefer_playground_surface__";

function Playground() {
  const shell = useShell();
  const services = shell.services;
  const navigate = useNavigate();
  const search = Route.useSearch();

  const ask = (next: Record<string, string>): void => {
    void navigate({
      to: "/project/$slug/playground",
      params: { slug: shell.slug() },
      search: next,
      replace: true,
    });
  };

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
          <div class="ms-auto">
            <BackToEditor />
          </div>
        </div>

        {}
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

        {}
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

      <main
        class="min-h-0 flex-1 overflow-auto"
        data-experiment={chosen()?.id}
        data-prototype-surface={SENTINEL}
      >
        {}
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

export const PlaygroundPage = () => <ShellGate>{() => <Playground />}</ShellGate>;
