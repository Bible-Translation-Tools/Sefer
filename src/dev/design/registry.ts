/**
 * Every design screen there is, found rather than listed — the same bargain
 * the playground registry makes, and for the same reason: an index nobody
 * updates is how a prototyping surface ends up with four screens in the tree
 * and two in the menu.
 *
 *   * `screens/` is COMMITTED. A screen worth sending somebody a link to, or
 *     worth coming back to on Monday, lives here and travels with the
 *     repository.
 *   * `local/` is GITIGNORED. A sketch that answers one question this
 *     afternoon lives there, appears in the picker as soon as the file is
 *     saved, and never turns up in a diff.
 *
 * `import.meta.glob` over a directory that does not exist returns nothing, so
 * a fresh checkout without `local/` is not a broken build.
 *
 * Both globs are eager and both sit under `src/dev`, which only the gated
 * route imports — see `src/routes/design.tsx`.
 */

import { isScreen, type Screen } from "./screen";

const collect = (modules: Readonly<Record<string, unknown>>): readonly Screen[] => {
  const found: Screen[] = [];
  for (const path of Object.keys(modules).sort()) {
    const module = modules[path];
    if (typeof module !== "object" || module === null) continue;
    for (const exported of Object.values(module)) {
      if (isScreen(exported)) found.push(exported);
    }
  }
  return found;
};

/**
 * Committed first, local second, so a scratch copy of a committed screen sits
 * under the thing it was copied from rather than above it.
 */
export const screens: readonly Screen[] = [
  ...collect(import.meta.glob("./screens/*.tsx", { eager: true })),
  ...collect(import.meta.glob("./local/*.tsx", { eager: true })),
];

export const screenById = (id: string): Screen | undefined =>
  screens.find((screen) => screen.id === id);
