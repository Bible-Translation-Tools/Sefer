import { Effect, Fiber, Stream } from "effect";
import { createSignal, onCleanup, type Accessor } from "solid-js";

import type { Project } from "#core/project/project";
import { mintSlug } from "#core/project/slug";

import type { Services } from "../services";
import type { RecentProjects, shellKeys } from "../settings";
import type { RecentProject } from "./types";

export const createSlugs = (
  services: Services,
  keys: ReturnType<typeof shellKeys>,
  project: Accessor<Project | undefined>,
) => {
  const justMinted = new Map<string, string>();
  const slugFor = (root: string): string => {
    const held = { ...services.settings.get(keys.projectSlugs), ...Object.fromEntries(justMinted) };
    const minted = mintSlug(root, held);
    if (held[minted] !== root) {
      justMinted.set(minted, root);
      void services.run(
        Effect.ignore(services.settings.set(keys.projectSlugs, { ...held, [minted]: root })),
      );
    }
    return minted;
  };

  const slug = (): string => {
    const root = project()?.root;
    return root === undefined ? "" : slugFor(root);
  };

  const fixtureFor = (slug: string): string | undefined => {
    const fixture = services.fixtureProject;
    return fixture !== undefined && slugFor(fixture) === slug ? fixture : undefined;
  };

  const rootForSlug = (slug: string): string | undefined =>
    justMinted.get(slug) ?? services.settings.get(keys.projectSlugs)[slug] ?? fixtureFor(slug);

  const asRows = (held: RecentProjects): readonly RecentProject[] =>
    Object.entries(held)
      .map(([root, at]) => ({ root, at, name: root.slice(root.lastIndexOf("/") + 1) || root }))
      .sort((left, right) => right.at.localeCompare(left.at));
  const [recentProjects, setRecentProjects] = createSignal<readonly RecentProject[]>(
    asRows(services.settings.get(keys.recentProjects)),
    { name: "recentProjects", equals: false },
  );
  const recents = services.runtime.runFork(
    Stream.runForEach(services.settings.changes(keys.recentProjects), (held) =>
      Effect.sync(() => setRecentProjects(asRows(held))),
    ),
  );
  onCleanup(() => {
    Effect.runFork(Fiber.interrupt(recents));
  });

  return { slugFor, slug, rootForSlug, recentProjects };
};
