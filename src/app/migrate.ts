import { Effect, FileSystem, Option, Result } from "effect";

import { makeMemoryFileSystem } from "#core/fileSystem/memory";
import { joinPath, lastSegment } from "#core/fileSystem/path";
import { Git } from "#core/git/git";
import type { IntakeResult } from "#core/git/intake";
import { addBooks, assemble, type AssembleForm } from "#core/migrate/assemble";
import { openCandidate, type BookCandidate, type StagedBook } from "#core/migrate/candidate";
import { health, validate, type Health } from "#core/migrate/check";
import { localCandidates } from "#core/migrate/local";
import { recognizeWriter } from "#core/migrate/writerBook";
import { UPSTREAM_TIMEOUT } from "#core/migrate/writerWork";
import { Observability } from "#core/observability";
import { Remote } from "#core/remote/remote";
import { Library, answers } from "#core/resources/library";
import { highestVersions, type RelatedResource } from "#core/resources/relationships";

import { APP_AUTHOR } from "./author";
import { catalogueFor, type WriterLanguage } from "./catalogue";
import { describe } from "./describe";
import { t } from "./i18n";
import type { Domain, Services } from "./services";
import { rememberProject } from "./ui/landing/summaries";

const stagingRootOf = (services: Services): string => `${services.hostInfo.paths().temp}/migrate`;

export type Opened =
  | { readonly state: "waiting" }
  | { readonly state: "opening" }
  | { readonly state: "ready"; readonly staged: StagedBook; readonly health: Health }
  | { readonly state: "refused"; readonly reason: string };

let writerList: Promise<readonly WriterLanguage[]> | undefined;

/**
 * Every language with Writer projects, asked for once per session (~1.6 s) and
 * searched in the page after. A failure is not kept, so the next ask retries.
 */
export const writerLanguages = (services: Services): Promise<readonly WriterLanguage[]> => {
  writerList ??= catalogueFor(services.settings)
    .writerLanguages()
    .catch((cause: unknown) => {
      writerList = undefined;
      throw cause;
    });
  return writerList;
};

export const remoteCandidates = (
  services: Services,
  language: string,
): Promise<readonly BookCandidate[]> => catalogueFor(services.settings).writerBooks(language);

const picked = new Map<string, FileSystem.FileSystem>();

export const forgetPicked = (): void => picked.clear();

const pickedFor = (candidate: BookCandidate): FileSystem.FileSystem | undefined => {
  if (candidate.origin.kind === "remote") return undefined;
  const { root } = candidate.origin;
  for (const [base, fileSystem] of picked)
    if (root === base || root.startsWith(`${base}/`)) return fileSystem;
  return undefined;
};

export const pickLocal = async (
  services: Services,
  kind: "folder" | "zip",
): Promise<readonly BookCandidate[] | undefined> => {
  const capabilities = services.hostInfo.capabilities();
  if (kind === "folder" && capabilities.nativeDisk && capabilities.dialogs) {
    const chosen = Option.getOrUndefined(
      await services.run(services.dialogs.pickFolder("Select BTT Writer projects")),
    );
    if (chosen === undefined) return undefined;
    return services.run(
      localCandidates(services.fileSystem, chosen, "folder", lastSegment(chosen)),
    );
  }
  const intake = await import("#platform/web/intake");
  const files = kind === "zip" ? await intake.pickZip() : await intake.pickFolder();
  if (files === undefined) return undefined;
  const memory = makeMemoryFileSystem().fileSystem;
  const staged = await services.run(intake.intake(memory, "/picked", files));
  picked.set(staged.root, memory);
  return services.run(localCandidates(memory, staged.root, kind, files.name));
};

class NotWriterUrl extends Error {
  override readonly name = "NotWriterUrl";
}

export const urlCandidate = async (services: Services, typed: string): Promise<BookCandidate> => {
  const url = typed
    .trim()
    .replace(/\/+$/u, "")
    .replace(/\.git$/iu, "");
  const parts = (() => {
    try {
      return new URL(url).pathname.split("/").filter((part) => part !== "");
    } catch {
      return [];
    }
  })();
  const owner = parts.at(-2);
  const repo = parts.at(-1);
  if (owner === undefined || repo === undefined)
    throw new NotWriterUrl(t("That is not a repository URL: {url}", { url }));

  const probe = await services.run(
    Effect.timeoutOption(
      Effect.flatMap(Remote, (remote) => remote.probe(url)),
      UPSTREAM_TIMEOUT,
    ),
  );
  if (Option.isNone(probe)) throw new NotWriterUrl(t("{url} did not answer in time.", { url }));
  if (probe.value.empty) throw new NotWriterUrl(t("{url} has nothing in it yet.", { url }));

  const inMemory = services.inMemoryTransfer?.();
  const root = `${inMemory === undefined ? stagingRootOf(services) : "/url-check"}/${owner}_${repo}`;
  const look = Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const remote = yield* Remote;
    const git = yield* Git;
    yield* Effect.ignore(fileSystem.remove(root, { recursive: true }));
    const { repo: cloned } = yield* remote.clone(url, root, { history: "latest" });
    const project = yield* recognizeWriter(fileSystem, root);
    const newest = (yield* Effect.orElseSucceed(git.log(cloned), () => []))[0];
    yield* Effect.ignore(fileSystem.remove(root, { recursive: true }));
    return { project, newest };
  });
  const where: Effect.Effect<
    Effect.Success<typeof look>,
    Effect.Error<typeof look>,
    Domain
  > = inMemory === undefined ? look : Effect.provide(look, inMemory);
  const { project, newest } = await services.run(where);
  if (project === undefined)
    throw new NotWriterUrl(
      t("{repo} is not a BTT Writer project: it has no manifest.json naming a book.", { repo }),
    );
  return {
    id: `remote:${url}:${project.book}`,
    book: project.book,
    language: project.language.id.toLowerCase(),
    resource: project.resource,
    origin: { kind: "remote", owner, repo, url },
    hints: newest === undefined ? {} : { modified: new Date(newest.at).toISOString() },
  };
};

const CANDIDATE_TIMEOUT = "60 seconds";

export const openOne = async (services: Services, candidate: BookCandidate): Promise<Opened> => {
  const operation = services.composition.observability.operation("migrate.open", {
    "migrate.book": candidate.book,
    "migrate.origin": candidate.origin.kind,
  });
  try {
    const held = pickedFor(candidate);
    const inMemory =
      candidate.origin.kind === "remote" || held !== undefined
        ? services.inMemoryTransfer?.(held)
        : undefined;
    const open = Effect.timeoutOption(
      openCandidate(candidate, inMemory === undefined ? stagingRootOf(services) : "/staging"),
      CANDIDATE_TIMEOUT,
    );
    const where: Effect.Effect<Option.Option<StagedBook>, unknown, Domain> = inMemory === undefined
      ? open
      : Effect.provide(open, inMemory);
    const opened = await services.run(Effect.provideService(where, Observability, operation));
    if (Option.isNone(opened)) {
      operation.end("unavailable", { "migrate.reason": "timeout" });
      return { state: "refused", reason: t("it did not answer in time") };
    }
    const staged = opened.value;
    const refused = validate(staged.usfm);
    if (refused !== undefined) {
      operation.end("refused", { "migrate.reason": refused });
      return { state: "refused", reason: refused };
    }
    const measured = operation.span("migrate.health");
    const census = health(services.galley, staged.project.book, staged.usfm);
    measured();
    operation.end("passed");
    return { state: "ready", staged, health: census };
  } catch (cause) {
    operation.end("failed", { "migrate.reason": describe(cause) });
    return { state: "refused", reason: describe(cause) };
  }
};

export const sourceCensus = (
  services: Services,
  sources: readonly RelatedResource[],
  book: string,
): Effect.Effect<{ readonly title: string; readonly health: Health } | undefined, never, Domain> =>
  Effect.gen(function* () {
    const library = yield* Library;
    const held = yield* library.resources();
    for (const ref of highestVersions(sources)) {
      const copy = held.find((resource) => answers(resource, ref));
      if (copy === undefined) continue;
      const text = yield* Effect.orElseSucceed(library.readBook(copy.id, book), () =>
        Option.none<string>(),
      );
      if (Option.isNone(text)) continue;
      return { title: copy.title, health: health(services.galley, book, text.value) };
    }
    return undefined;
  });

export const passagesDiffering = (
  services: Services,
  picked: string,
  other: string,
): number | undefined => {
  if (picked === other) return 0;
  const diffed = services.galley.diff(picked, other);
  return Result.isSuccess(diffed)
    ? diffed.success.units.filter((unit) => unit.status !== "unchanged").length
    : undefined;
};

const freeFolder = (services: Services, name: string): Effect.Effect<string, never, Domain> =>
  Effect.gen(function* () {
    for (let attempt = 1; ; attempt += 1) {
      const root = joinPath(
        services.projectsRoot,
        attempt === 1 ? name : `${name}-${String(attempt)}`,
      );
      const taken = yield* Effect.orElseSucceed(services.fileSystem.exists(root), () => true);
      if (!taken) return root;
    }
  });

export const assembleProject = (
  services: Services,
  folder: string,
  form: AssembleForm,
  books: readonly StagedBook[],
): Effect.Effect<{ readonly root: string; readonly result: IntakeResult }, unknown, Domain> =>
  Effect.gen(function* () {
    const operation = services.composition.observability.operation("migrate.assemble", {
      "migrate.books": books.length,
    });
    const assembled = yield* Effect.result(
      Effect.provideService(
        Effect.gen(function* () {
          const root = yield* freeFolder(services, folder);
          const result = yield* assemble({
            root,
            form,
            books,
            author: APP_AUTHOR,
            date: new Date().toISOString().slice(0, 10),
          });
          yield* rememberProject(services.projectsRoot, root, undefined);
          return { root, result };
        }),
        Observability,
        operation,
      ),
    );
    if (Result.isFailure(assembled)) {
      operation.end("failed", { "migrate.reason": describe(assembled.failure) });
      return yield* Effect.fail(assembled.failure);
    }
    operation.end("passed");
    return assembled.success;
  });

export const addToProject = (
  services: Services,
  root: string,
  held: readonly string[],
  books: readonly StagedBook[],
): Effect.Effect<IntakeResult, unknown, Domain> =>
  Effect.gen(function* () {
    const operation = services.composition.observability.operation("migrate.assemble", {
      "migrate.books": books.length,
      "migrate.into": true,
    });
    const added = yield* Effect.result(
      Effect.provideService(
        addBooks({
          root,
          books,
          held,
          author: APP_AUTHOR,
          date: new Date().toISOString().slice(0, 10),
        }),
        Observability,
        operation,
      ),
    );
    if (Result.isFailure(added)) {
      operation.end("failed", { "migrate.reason": describe(added.failure) });
      return yield* Effect.fail(added.failure);
    }
    operation.end("passed");
    yield* rememberProject(services.projectsRoot, root, undefined);
    return added.success;
  });
