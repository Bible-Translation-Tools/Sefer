/**
 * Where a clone goes, and who is told.
 *
 * Every clone is one of two things, and that decides both the folder and the
 * list that must notice it:
 *
 *   project      `projectsRoot/<repo>`; the projects index and its list
 *   sourceText   `libraryRoot/<owner>/<repo>`; the Library and its pickers
 *
 * Callers say which and nothing else, so no screen chooses a folder or a
 * signal (Will, 2026-10-06). A source text never appears in "Your projects";
 * the reference picker lists it.
 *
 * A project's arrival then pulls the source texts its metadata declares,
 * each one at most once per device: the Library finds a copy by the URL it
 * was cloned from, and a held copy is used, not cloned again.
 */

import { Effect, Option } from "effect";
import { createSignal } from "solid-js";

import { lastSegment } from "#core/fileSystem/path";
import { Git } from "#core/git/git";
import { Observability } from "#core/observability";
import { readProjectMetadata } from "#core/project/discovery";
import { cloneRepository } from "#core/remote/clone";
import type { CloneOptions, Progress } from "#core/remote/remote";
import { Library, type Resource } from "#core/resources/library";
import {
  catalogueUrl,
  highestVersions,
  normaliseRepoUrl,
  resolveRelatedTexts,
  type RelatedResource,
} from "#core/resources/relationships";

import { describe } from "./describe";
import { contentHostFor } from "./endpoints";
import { t } from "./i18n";
import type { Domain, Services } from "./services";
import { rememberProject } from "./ui/landing/summaries";
import { toasts } from "./ui/primitives";

export type ArrivalKind = "project" | "sourceText";

/**
 * Bumped whenever the Library gains a copy, so a picker open at the time
 * re-reads. The Library's own state is not a signal, and this is its one
 * announcement, the way `projectIndexRevision` is the projects list's.
 */
const [revision, setRevision] = createSignal(0, { name: "libraryRevision" });
export const libraryRevision = revision;
export const libraryChanged = (): void => {
  setRevision((held) => held + 1);
};

/** `https://host/Owner/repo.git` → `owner`, `repo`, as the folder they clone into. */
const ownerAndRepo = (url: string): { readonly owner: string; readonly repo: string } => {
  const parts = normaliseRepoUrl(url).split("/");
  return { repo: parts.at(-1) ?? "repo", owner: parts.at(-2) ?? "unknown" };
};

/** Where an arrival of this kind lands. */
export const arrivalRoot = (services: Services, kind: ArrivalKind, url: string): string => {
  const { owner, repo } = ownerAndRepo(url);
  return kind === "project"
    ? `${services.projectsRoot}/${lastSegment(url.replace(/\.git$/u, ""))}`
    : `${services.libraryRoot}/${owner}/${repo}`;
};

/**
 * Clones `url` as `kind`, and tells the list that shows it. A source text is
 * the newest version only: it is read beside a translation, never worked in.
 */
export const cloneArrival = (
  services: Services,
  kind: ArrivalKind,
  url: string,
  options?: { readonly catalogueId?: string; readonly clone?: CloneOptions },
): Effect.Effect<
  { readonly root: string; readonly progress: Progress; readonly resource?: Resource },
  unknown,
  Domain
> =>
  Effect.gen(function* () {
    const into = arrivalRoot(services, kind, url);
    const cloned = yield* cloneRepository(
      url,
      into,
      options?.catalogueId,
      kind === "sourceText" ? { history: "latest" } : options?.clone,
    );
    if (kind === "project") {
      yield* rememberProject(services.projectsRoot, into, undefined);
      return { root: into, progress: cloned.progress };
    }
    const git = yield* Git;
    const head = Option.getOrUndefined(yield* git.resolve(cloned.repo, "HEAD"));
    const library = yield* Library;
    const resource = yield* library.add(
      into,
      head === undefined ? undefined : { url, commit: head },
    );
    yield* Effect.sync(libraryChanged);
    return { root: into, progress: cloned.progress, resource };
  });

/** One declared source text, after the pull: held already, pulled now, or not. */
export interface SourceTextRow {
  readonly ref: RelatedResource;
  readonly title: string;
  readonly outcome: "held" | "pulled" | "failed";
  /** The version note, or why it failed. */
  readonly note?: string;
}

/**
 * Pulls what a project's metadata declares as its source texts. Never fails:
 * a source text that cannot be had fails its own row, and the project is
 * unaffected (it opens either way). With no content host configured there is
 * nowhere to look, and nothing is attempted.
 */
export const pullSourceTexts = (
  services: Services,
  projectRoot: string,
): Effect.Effect<readonly SourceTextRow[], never, Domain> =>
  Effect.gen(function* () {
    const host = contentHostFor(services.settings);
    const read = yield* readProjectMetadata(services.fileSystem, projectRoot);
    const refs = Option.match(read.metadata, {
      onNone: () => [],
      onSome: (metadata) => highestVersions(metadata.related),
    });
    if (host === null || refs.length === 0) return [];
    const library = yield* Library;
    const rows: SourceTextRow[] = [];
    for (const ref of refs) {
      const url = catalogueUrl(host, ref);
      const operation = Option.getOrUndefined(yield* Effect.serviceOption(Observability));
      const held = yield* library.cloned(url);
      if (Option.isSome(held)) {
        rows.push({ ref, title: held.value.title, outcome: "held" });
        operation?.note("sources.resolve", "passed", undefined, { "sources.how": "held" });
        continue;
      }
      const pulled = yield* Effect.result(cloneArrival(services, "sourceText", url));
      if (pulled._tag === "Failure") {
        rows.push({
          ref,
          title: `${ref.language}_${ref.resource}`,
          outcome: "failed",
          note: describe(pulled.failure),
        });
        operation?.note("sources.resolve", "refused", undefined, { "sources.how": "clone" });
        continue;
      }
      rows.push({
        ref,
        title: pulled.success.resource?.title ?? `${ref.language}_${ref.resource}`,
        outcome: "pulled",
      });
      operation?.note("sources.resolve", "passed", undefined, { "sources.how": "clone" });
    }
    // The version notes, now every copy that could be had is here.
    const resources = yield* library.resources();
    const versionOf = (url: string): string | undefined =>
      resources.find((resource) => resource.upstream?.url === url)?.version;
    const notes = new Map(
      resolveRelatedTexts(refs, host, versionOf).map((resolution) => [
        resolution.ref,
        resolution.note,
      ]),
    );
    return rows.map((row) => {
      const note = row.outcome === "failed" ? row.note : notes.get(row.ref);
      return note === undefined ? { ...row } : { ...row, note };
    });
  });

/**
 * `pullSourceTexts`, said where the person will read it: one toast for the
 * whole arrival, quiet when nothing was declared or everything was held with
 * the listed version.
 */
export const announceSourceTexts = async (
  services: Services,
  projectRoot: string,
): Promise<void> => {
  const rows = await services.run(pullSourceTexts(services, projectRoot));
  const worth = rows.filter((row) => row.outcome !== "held" || row.note !== undefined);
  if (worth.length === 0) return;
  const lines = worth.map((row) => {
    const said =
      row.outcome === "failed"
        ? t("{title} could not be downloaded", { title: row.title })
        : row.outcome === "pulled"
          ? t("{title} downloaded", { title: row.title })
          : t("{title} is already on this device", { title: row.title });
    return row.note === undefined ? said : `${said} (${row.note})`;
  });
  const failed = rows.some((row) => row.outcome === "failed");
  (failed ? toasts.error : toasts.success)({
    title: t("Source texts"),
    message: lines.join("\n"),
  });
};

/** `root`, or `root-2`, `root-3`… whichever does not exist yet. */
const freeRoot = (services: Services, root: string): Effect.Effect<string, never, Domain> =>
  Effect.gen(function* () {
    for (let attempt = 1; ; attempt += 1) {
      const candidate = attempt === 1 ? root : `${root}-${String(attempt)}`;
      const taken = yield* Effect.orElseSucceed(services.fileSystem.exists(candidate), () => true);
      if (!taken) return candidate;
    }
  });

/**
 * "Edit it as your own project": a Library copy becomes a project, by a full
 * move. Once edited it is no longer WA's official text (Will, 2026-10-06), so
 * it leaves the Library, and every project that read it as a source text
 * falls back to downloading the official one again.
 */
export const adoptAsProject = (
  services: Services,
  resource: Resource,
): Effect.Effect<string, unknown, Domain> =>
  Effect.gen(function* () {
    const into = yield* freeRoot(
      services,
      `${services.projectsRoot}/${lastSegment(resource.root)}`,
    );
    const fileSystem = services.fileSystem;
    // A directory move where the host has one; OPFS without `move` copies.
    yield* Effect.catch(fileSystem.rename(resource.root, into), () =>
      Effect.andThen(fileSystem.copy(resource.root, into), () =>
        fileSystem.remove(resource.root, { recursive: true }),
      ),
    );
    const library = yield* Library;
    yield* library.remove(resource.id);
    yield* Effect.sync(libraryChanged);
    yield* rememberProject(services.projectsRoot, into, undefined);
    return into;
  });
