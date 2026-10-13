/**
 * Share links, the device's half: which of my projects came from a source,
 * how my copy stands against the version a link names, and the link to the
 * place I am looking at. The format is `core/project/shareLink.ts`.
 *
 * A project's source is its `origin`, which is the shared project in both
 * ways to work (in the copy mode the person's fork is `copy`, and a link
 * still names the shared project, documentation/architecture/sync.md).
 */

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

/** The source a project's `origin` points at, if it has one. */
const sourceOfProject = (root: string): Effect.Effect<Source | undefined, never, Domain> =>
  Effect.gen(function* () {
    const git = yield* Git;
    const remote = yield* Remote;
    const repo = yield* git.open(root);
    const origin = yield* remote.origin(repo);
    return Option.isSome(origin) ? sourceOf(origin.value) : undefined;
  }).pipe(Effect.orElseSucceed(() => undefined));

/**
 * This device's projects that came from `source`, most recently opened
 * first. Usually none or one; two when the same shared project was
 * downloaded twice, and then the caller takes the first.
 *
 * Reads every project's git config, once per arrival by link. An index of
 * sources would make this one read; it is not worth having until a device
 * holds enough projects for the wait to show.
 */
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

/** How the copy at `root` stands against the commit `at`. */
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

/**
 * The share link to a place in the project at `root`: `rest` is the path
 * after `/project/<slug>`, `search` the place's own query. Undefined when the
 * project has no shared project to name.
 */
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

/**
 * Starts a clipboard write NOW, in the gesture, with text that arrives later.
 * WebKit (Safari, and the macOS desktop's WKWebView) refuses a clipboard write
 * that starts after an `await`, outside the user's gesture; a `ClipboardItem`
 * holding a promise is the standard way round it. False when that is not
 * supported here or was refused, so the caller can fall back to `writeText`
 * (which Chromium allows after an await).
 */
const writeLater = (text: Promise<string | undefined>): Promise<boolean> => {
  const blob = text.then((held) => {
    if (held === undefined) throw new Error("nothing to copy");
    return new Blob([held], { type: "text/plain" });
  });
  // Nothing to copy is the caller's to say; the blob's rejection is not news.
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

/**
 * Copies the share link to the place on screen: the address bar's path after
 * `/project/<slug>`, with its query, in the project at `root`. The write starts
 * before the link is read (`writeLater`), so WebKit still counts it as the
 * press's.
 */
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
