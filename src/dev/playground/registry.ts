/**
 * Every experiment there is, found rather than listed.
 *
 * Two globs, and the second is the point:
 *
 *   * `experiments/` is COMMITTED. A variant worth showing somebody, or worth
 *     coming back to on Monday, lives here and travels with the repository.
 *   * `local/` is GITIGNORED. A sketch that exists to answer one question this
 *     afternoon lives there, appears in the picker the moment the file is
 *     saved, and never turns up in a diff.
 *
 * Globbing rather than a hand-maintained array because the list is the one part
 * of a prototyping surface guaranteed to rot: an index nobody updates is how a
 * playground ends up with four experiments in the tree and two in the menu.
 * `import.meta.glob` on a directory that does not exist returns nothing, so a
 * fresh checkout with no `local/` is not a broken build.
 *
 * Both globs are eager and both are inside `src/dev`, which the route only
 * imports behind `import.meta.env.DEV` — so none of this reaches a production
 * bundle. See `src/routes/project/$slug/playground.tsx`.
 */

import { isExperiment, type Experiment } from "./experiment";

const collect = (modules: Readonly<Record<string, unknown>>): readonly Experiment[] => {
  const found: Experiment[] = [];
  for (const path of Object.keys(modules).sort()) {
    const module = modules[path];
    if (typeof module !== "object" || module === null) continue;
    for (const exported of Object.values(module)) {
      if (isExperiment(exported)) found.push(exported);
    }
  }
  return found;
};

/**
 * Committed first, local second, so a scratch copy of a committed experiment
 * sits under the thing it was copied from rather than above it.
 */
export const experiments: readonly Experiment[] = [
  ...collect(import.meta.glob("./experiments/*.tsx", { eager: true })),
  ...collect(import.meta.glob("./local/*.tsx", { eager: true })),
];

export const experimentById = (id: string): Experiment | undefined =>
  experiments.find((experiment) => experiment.id === id);
