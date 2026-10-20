import { Effect, Option } from "effect";

import { Git } from "#core/git/git";
import {
  sameSource,
  shareLinkPath,
  sourceOf,
  versionStanding,
  type Source,
  type VersionStanding,
} from "#core/project/shareLink";
import { Remote } from "#core/remote/remote";

import { t } from "./i18n";
import type { Domain, Services } from "./services";
import { listProjects } from "./ui/landing/summaries";
import { toasts } from "./ui/primitives";

const sourceOfProject = (root: string): Effect.Effect<Source | undefined, never, Domain> =>
  Effect.gen(function* () {
    const git = yield* Git;
    const remote = yield* Remote;
    const repo = yield* git.open(root);
    const origin = yield* remote.origin(repo);
    return Option.isSome(origin) ? sourceOf(origin.value) : undefined;
  }).pipe(Effect.orElseSucceed(() => undefined));

export const projectsFrom = (
  services: Services,
  source: Source,
  recent: Readonly<Record<string, string>>,
): Effect.Effect<readonly string[], never, Domain> =>
  Effect.gen(function* () {
    const projects = yield* listProjects(services.projectsRoot, undefined, recent);
    const sources = yield* Effect.forEach(projects, (project) => sourceOfProject(project.root), {
      concurrency: 4,
    });
    return projects
      .filter((_, index) => {
        const held = sources[index];
        return held !== undefined && sameSource(held, source);
      })
      .toSorted((left, right) => (right.lastOpened ?? "").localeCompare(left.lastOpened ?? ""))
      .map((project) => project.root);
  });

export const standingOf = (
  root: string,
  at: string,
): Effect.Effect<VersionStanding, never, Domain> =>
  Effect.gen(function* () {
    const git = yield* Git;
    const repo = yield* git.open(root);
    const head = Option.getOrUndefined(yield* git.resolve(repo, "HEAD"));
    const base =
      head === undefined
        ? undefined
        : Option.getOrUndefined(
            yield* Effect.orElseSucceed(git.mergeBase(repo, head, at), () => Option.none<string>()),
          );
    const shallow = yield* Effect.orElseSucceed(git.shallow(repo), () => false);
    return versionStanding(at, head, base, shallow);
  }).pipe(Effect.orElseSucceed((): VersionStanding => "other"));

const shareLinkFor = (
  services: Services,
  root: string,
  rest: string,
  search: URLSearchParams,
): Effect.Effect<string | undefined, never, Domain> =>
  Effect.gen(function* () {
    const source = yield* sourceOfProject(root);
    if (source === undefined) return undefined;
    const git = yield* Git;
    const head = yield* Effect.orElseSucceed(
      Effect.flatMap(git.open(root), (repo) => git.resolve(repo, "HEAD")),
      () => Option.none<string>(),
    );
    return shareLinkPath(source, rest, search, Option.getOrUndefined(head));
  });

const writeLater = (text: Promise<string | undefined>): Promise<boolean> => {
  const blob = text.then((held) => {
    if (held === undefined) throw new Error("nothing to copy");
    return new Blob([held], { type: "text/plain" });
  });
  blob.catch(() => undefined);
  try {
    if (typeof ClipboardItem === "undefined") return Promise.resolve(false);
    return navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
};

export const copyPlaceLink = async (services: Services, root: string): Promise<void> => {
  const rest = /^\/project\/[^/]+(.*)$/u.exec(window.location.pathname)?.[1] ?? "";
  const origin = window.location.origin;
  const linked = services
    .run(shareLinkFor(services, root, rest, new URLSearchParams(window.location.search)))
    .then((path) => (path === undefined ? undefined : `${origin}${path}`));
  const writing = writeLater(linked);
  const link = await linked;
  if (link === undefined) {
    toasts.error({
      title: t("This project has no link to share"),
      message: t("A link names the shared project, and this one is only on this device."),
    });
    return;
  }
  const copied =
    (await writing) ||
    (await navigator.clipboard.writeText(link).then(
      () => true,
      () => false,
    ));
  if (copied) toasts.success({ title: t("Link copied"), message: link });
  else toasts.error({ title: t("Could not copy the link"), message: link });
};
