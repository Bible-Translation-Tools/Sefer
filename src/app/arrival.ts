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

import { Effect, FileSystem, Option, Stream, type Scope } from "effect";
import { createSignal } from "solid-js";

import { lastSegment } from "#core/fileSystem/path";
import { Git } from "#core/git/git";
import { Observability } from "#core/observability";
import { readProjectMetadata } from "#core/project/discovery";
import { cloneRepository } from "#core/remote/clone";
import { Remote } from "#core/remote/remote";
import type { CloneOptions, Progress } from "#core/remote/remote";
import { treeInFolder } from "#core/resources/kinds/tree";
import { Library, recognizeRoot, type Resource } from "#core/resources/library";
import {
  catalogueUrl,
  highestVersions,
  normaliseRepoUrl,
  resolveRelatedTexts,
  type RelatedResource,
} from "#core/resources/relationships";

import { describe, describeTransfer } from "./describe";
import { contentHostFor } from "./endpoints";
import { t } from "./i18n";
import { packFor } from "./kinds/table";
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
const libraryChanged = (): void => {
  setRevision((held) => held + 1);
};
/** For a screen that changed the Library itself (removed a copy), so the pickers re-read. */
export const noteLibraryChanged = libraryChanged;

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
    const clone = cloneRepository(
      url,
      into,
      options?.catalogueId,
      kind === "sourceText" ? { history: "latest" } : options?.clone,
    );
    // A failed clone can leave a partial folder, and git will not clone into
    // it again. In the Library's own folder that is ours to clear; a project
    // folder is the person's disk, and stays as it is (`clone.ts`).
    const cloned = yield* kind === "project"
      ? clone
      : Effect.tapError(clone, () =>
          Effect.ignore(services.fileSystem.remove(into, { recursive: true })),
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

/**
 * The Library's copy of a source text: the one already on this device when
 * there is one, else a fresh clone into the Library's folder. Once per device,
 * whoever asks — the projects page, a project's arrival, the reference column.
 */
export const sourceTextCopy = (
  services: Services,
  url: string,
  catalogueId?: string,
): Effect.Effect<Resource, unknown, Domain> =>
  Effect.gen(function* () {
    const library = yield* Library;
    const held = yield* library.cloned(url);
    if (Option.isSome(held)) return held.value;
    const arrived = yield* cloneArrival(
      services,
      "sourceText",
      url,
      catalogueId === undefined ? undefined : { catalogueId },
    );
    if (arrived.resource !== undefined) return arrived.resource;
    return yield* Effect.fail(new Error(`${url} arrived without a Library entry`));
  });

/** How far a reference copy has got, for a progress readout. */
export type CopyProgress =
  /** The transfer, as git reports it: its own step ("Receiving objects"), `loaded` of `total`. */
  | {
      readonly phase: "downloading";
      readonly step: string;
      readonly loaded: number;
      readonly total?: number;
      /** `bytes` while the pack itself arrives; otherwise git's object counts. */
      readonly unit?: "objects" | "bytes";
    }
  /** Unpacking what arrived and reading its manifest. */
  | { readonly phase: "reading" }
  /** Writing the kind's packs: book `done` of `of`. */
  | {
      readonly phase: "packing";
      readonly done: number;
      readonly of: number;
      readonly book: string;
    };

/** Every transfer progress event of the Remote in scope, as `downloading`, until interrupted. */
const reportDownload = (
  onProgress: ((progress: CopyProgress) => void) | undefined,
): Effect.Effect<void, never, Remote | Scope.Scope> =>
  onProgress === undefined
    ? Effect.void
    : Effect.asVoid(
        Effect.forkScoped(
          Effect.flatMap(Remote, (remote) =>
            Stream.runForEach(remote.progress(), (progress) =>
              Effect.sync(() =>
                onProgress({
                  phase: "downloading",
                  step: progress.phase,
                  loaded: progress.loaded,
                  ...(progress.total === undefined ? {} : { total: progress.total }),
                  ...(progress.unit === undefined ? {} : { unit: progress.unit }),
                }),
              ),
            ),
          ),
        ),
      );

/**
 * The Library's copy of reference material — a help, not a scripture text:
 * the one on this device, else a fresh one.
 *
 * Where disk is cheap (desktop) it is an ordinary clone into the Library's
 * folder, upstream's layout kept as it is; the kind's reader indexes it on
 * first read. On the Web the tree may be tens of thousands of files, and
 * OPFS pays per file (29,300 for `en_tn`, `storage.md`), so it is cloned
 * newest-only into MEMORY, recognised there by the same `recognizeRoot`
 * every other root is, and the kind's `pack` step writes only what the kind
 * reads: one file per book, the manifest and the licence. A kind with no
 * `pack` step is refused here rather than half-kept.
 *
 * A shallow clone, not an archive download (Will, 2026-10-12). Set aside the
 * same day after measuring: a clone with no working tree, reading the
 * commit's blobs through isomorphic-git, saved about 1.8 s of clone and cost
 * more than that in blob reads (14.1 s against 13.2 s in all).
 *
 * Nothing is registered until the copy is complete: a failed pack removes
 * what it wrote, and the Library never lists half a resource. `onProgress`
 * hears the download, the reading and each book packed.
 */
export const referenceCopy = (
  services: Services,
  url: string,
  onProgress?: (progress: CopyProgress) => void,
): Effect.Effect<Resource, unknown, Domain> =>
  Effect.gen(function* () {
    const library = yield* Library;
    const held = yield* library.cloned(url);
    if (Option.isSome(held)) return held.value;
    const inMemory = services.inMemoryTransfer?.();
    if (inMemory === undefined) {
      const arrived = yield* Effect.scoped(
        Effect.flatMap(reportDownload(onProgress), () => cloneArrival(services, "sourceText", url)),
      );
      if (arrived.resource !== undefined) return arrived.resource;
      return yield* Effect.fail(new Error(`${url} arrived without a Library entry`));
    }
    const into = arrivalRoot(services, "sourceText", url);
    const { owner, repo } = ownerAndRepo(url);
    const staged = `/staging/${owner}_${repo}`;
    const observability = yield* Observability;
    const stage: Effect.Effect<string | undefined, unknown, Domain> = Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const git = yield* Git;
          const cloning = observability.span("reference.clone");
          yield* reportDownload(onProgress);
          // Newest version only: a read-only copy never needs its history,
          // and `history` said is what keeps a backfill from starting behind.
          const { repo: cloned } = yield* cloneRepository(url, staged, undefined, {
            history: "latest",
          });
          cloning();
          onProgress?.({ phase: "reading" });
          const head = Option.getOrUndefined(yield* git.resolve(cloned, "HEAD"));
          const recognition = yield* recognizeRoot(fileSystem, staged);
          const pack = packFor(recognition.content);
          if (pack === undefined)
            return yield* Effect.fail(
              new Error(`${url} holds ${recognition.content}, which is cloned, not packed`),
            );
          const packing = observability.span("reference.pack");
          yield* pack(
            treeInFolder(fileSystem, staged),
            { fileSystem: services.fileSystem, root: into },
            { at: new Date().toISOString(), ...(head === undefined ? {} : { commit: head }) },
            (progress) => onProgress?.({ phase: "packing", ...progress }),
          );
          packing();
          yield* Effect.ignore(fileSystem.remove(staged, { recursive: true }));
          return head;
        }),
      ),
      inMemory,
    );
    const head = yield* stage;
    const resource = yield* Effect.tapError(
      library.add(into, head === undefined ? undefined : { url, commit: head }),
      () => Effect.ignore(services.fileSystem.remove(into, { recursive: true })),
    );
    yield* Effect.sync(libraryChanged);
    return resource;
  });

/** What a progress toast says for a copy's progress. */
export const describeCopy = (progress: CopyProgress): string => {
  switch (progress.phase) {
    case "downloading":
      return t("Downloading: {transfer}", {
        transfer: describeTransfer({
          phase: progress.step,
          loaded: progress.loaded,
          total: progress.total,
          ...(progress.unit === undefined ? {} : { unit: progress.unit }),
        }),
      });
    case "reading":
      return t("Reading what arrived…");
    case "packing":
      return progress.done >= progress.of
        ? t("Finishing…")
        : t("Packing {book}: book {at} of {of}", {
            book: progress.book,
            at: progress.done + 1,
            of: progress.of,
          });
  }
};

/** One declared source text, after the pull: held already, pulled now, or not. */
interface SourceTextRow {
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
const pullSourceTexts = (
  services: Services,
  projectRoot: string,
  fromHost?: string,
): Effect.Effect<readonly SourceTextRow[], never, Domain> =>
  Effect.gen(function* () {
    // The cloud the project came from, when the caller knows it: a project
    // from another host (a share link with `host=`) declares texts that live
    // THERE, and the configured host may not hold them at all.
    const host = fromHost ?? contentHostFor(services.settings);
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
  fromHost?: string,
): Promise<void> => {
  const rows = await services.run(pullSourceTexts(services, projectRoot, fromHost));
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
