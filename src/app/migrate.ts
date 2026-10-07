/**
 * "Migrate from Writer", as the screen runs it: where candidates come from,
 * opening them, the health line, and the assembly.
 *
 * The policy is core's (`src/core/migrate`); this is the app's half, because
 * it knows the catalogue (a `fetch`), the pickers, the staging folder and the
 * Library — things core may not name.
 */

import { Effect, Option, Result } from "effect";

import { joinPath, lastSegment } from "#core/fileSystem/path";
import type { IntakeResult } from "#core/git/intake";
import { addBooks, assemble, type AssembleForm } from "#core/migrate/assemble";
import { openCandidate, type BookCandidate, type StagedBook } from "#core/migrate/candidate";
import { health, validate, type Health } from "#core/migrate/check";
import { localCandidates } from "#core/migrate/local";
import { UPSTREAM_TIMEOUT } from "#core/migrate/writerWork";
import { Observability } from "#core/observability";
import { Library, answers } from "#core/resources/library";
import { highestVersions, type RelatedResource } from "#core/resources/relationships";

import { APP_AUTHOR } from "./author";
import { catalogueFor, type WriterLanguage } from "./catalogue";
import { describe } from "./describe";
import { t } from "./i18n";
import type { Domain, Services } from "./services";
import { rememberProject } from "./ui/landing/summaries";

/** Where opened candidates are staged. Temporary: nothing here is a project. */
const stagingRootOf = (services: Services): string => `${services.hostInfo.paths().temp}/migrate`;

/** A candidate as the screen holds it, from listed to opened or refused. */
export type Opened =
  | { readonly state: "waiting" }
  | { readonly state: "opening" }
  | { readonly state: "ready"; readonly staged: StagedBook; readonly health: Health }
  | { readonly state: "refused"; readonly reason: string };

/** The languages with Writer projects matching a search of two letters or more. */
export const writerLanguages = (
  services: Services,
  search: string,
): Promise<readonly WriterLanguage[]> => catalogueFor(services.settings).writerLanguages(search);

/** The catalogue's Writer projects for one language. */
export const remoteCandidates = (
  services: Services,
  language: string,
): Promise<readonly BookCandidate[]> => catalogueFor(services.settings).writerBooks(language);

/**
 * A picked folder or zip, as candidates. The browser copies what was picked
 * into staging first (the import hub's own intake); a native host reads the
 * folder where it is.
 */
export const pickLocal = async (
  services: Services,
  kind: "folder" | "zip",
): Promise<readonly BookCandidate[] | undefined> => {
  const capabilities = services.hostInfo.capabilities();
  if (kind === "folder" && capabilities.nativeDisk && capabilities.dialogs) {
    const picked = Option.getOrUndefined(
      await services.run(services.dialogs.pickFolder("Select BTT Writer projects")),
    );
    if (picked === undefined) return undefined;
    return services.run(
      localCandidates(services.fileSystem, picked, "folder", lastSegment(picked)),
    );
  }
  const intake = await import("#platform/web/intake");
  const picked = kind === "zip" ? await intake.pickZip() : await intake.pickFolder();
  if (picked === undefined) return undefined;
  const staged = await services.run(
    intake.intake(services.fileSystem, `${stagingRootOf(services)}/picked`, picked),
  );
  return services.run(localCandidates(services.fileSystem, staged.root, kind, picked.name));
};

/** Opens, renders, validates and measures one candidate. Never rejects. */
export const openOne = async (services: Services, candidate: BookCandidate): Promise<Opened> => {
  const operation = services.composition.observability.operation("migrate.open", {
    "migrate.book": candidate.book,
    "migrate.origin": candidate.origin.kind,
  });
  try {
    // A clone that does not finish in time is refused like an unreachable
    // one, so one slow repository never holds the run's Next behind it.
    // A remote candidate is cloned, read once and dropped, so on the Web it is
    // cloned into memory: OPFS writes were most of its cost. A folder or zip
    // candidate is read where it is.
    const inMemory = candidate.origin.kind === "remote" ? services.inMemoryTransfer?.() : undefined;
    const open = Effect.timeoutOption(
      openCandidate(candidate, inMemory === undefined ? stagingRootOf(services) : "/staging"),
      UPSTREAM_TIMEOUT,
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

/**
 * The census of `book` in a source text on this device, for the health line
 * to read against ("English ULB has 5 ch · 105 v"). The manifest's `ufw`
 * versification says nothing, so the source text is the only honest
 * expectation; with none here, there is none.
 */
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

/**
 * How many passages of `other` differ from `picked`: Review's own decision
 * units, counted. `undefined` when the engine's diff door is missing.
 */
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

/** A folder name for the new project that is not taken yet. */
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

/** Assembles the chosen books into a new project, and lists it. */
export const assembleProject = (
  services: Services,
  folder: string,
  form: AssembleForm,
  books: readonly StagedBook[],
): Effect.Effect<{ readonly root: string; readonly result: IntakeResult }, unknown, Domain> =>
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
  });

/** Adds the chosen books to a project that exists, in one commit. */
export const addToProject = (
  services: Services,
  root: string,
  held: readonly string[],
  books: readonly StagedBook[],
): Effect.Effect<IntakeResult, unknown, Domain> =>
  Effect.gen(function* () {
    const result = yield* addBooks({
      root,
      books,
      held,
      author: APP_AUTHOR,
      date: new Date().toISOString().slice(0, 10),
    });
    yield* rememberProject(services.projectsRoot, root, undefined);
    return result;
  });
