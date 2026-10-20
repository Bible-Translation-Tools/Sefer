import { Effect, FileSystem, Option, Result } from "effect";
import { createSignal } from "solid-js";

import { ProjectAdmin } from "#core/admin/projectAdmin";
import { lastSegment } from "#core/fileSystem/path";
import { HostInfo } from "#core/host/hostInfo";
import {
  forgetProject,
  recordProject,
  repairProjectIndex,
  type ProjectRow,
} from "#core/project/projectIndex";
import { firstArrival, type ProjectOrigin } from "#core/project/provenance";

import { languageName, languageTag, projectDisplayName } from "../../language";
import type { Domain } from "../../services";

export interface ProjectSummary {
  readonly root: string;
  readonly folder: string;
  readonly name: string;
  readonly language: string;
  readonly languageTag: string;
  readonly books: number;
  readonly lastOpened: string | undefined;
  readonly from: ProjectOrigin | undefined;
  readonly fixture: boolean;
}

const isUsfm = (path: string): boolean => path.toLowerCase().endsWith(".usfm");

const summarize = (
  root: string,
  lastOpened: string | undefined,
  fixture: boolean,
): Effect.Effect<ProjectSummary, never, Domain> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const admin = yield* ProjectAdmin;
    const host = yield* HostInfo;

    const entries = yield* Effect.orElseSucceed(
      fileSystem.readDirectory(root, { recursive: true }),
      (): readonly string[] => [],
    );
    const metadata = yield* Effect.map(Effect.result(admin.metadata(root)), (result) =>
      Result.isSuccess(result) ? Option.getOrUndefined(result.success) : undefined,
    );
    const recorded = yield* Effect.map(admin.recordedName(root), Option.getOrUndefined);
    const from = yield* Effect.map(firstArrival(fileSystem, root), Option.getOrUndefined);

    const folder = lastSegment(root);
    const locale = host.locale();
    return {
      root,
      folder,
      name: recorded || projectDisplayName(metadata, locale) || folder,
      language: languageName(metadata, locale),
      languageTag: languageTag(metadata),
      books: entries.filter(isUsfm).length,
      lastOpened,
      from,
      fixture,
    };
  });

const asRow = (summary: ProjectSummary): ProjectRow => ({
  root: summary.root,
  name: summary.name,
  language: summary.language,
  ...(summary.languageTag === "" ? {} : { languageTag: summary.languageTag }),
  books: summary.books,
  ...(summary.lastOpened === undefined ? {} : { lastOpened: summary.lastOpened }),
  ...(summary.from === undefined ? {} : { from: summary.from }),
});

const asSummary = (row: ProjectRow, lastOpened: string | undefined): ProjectSummary => ({
  root: row.root,
  folder: lastSegment(row.root),
  name: row.name,
  language: row.language,
  languageTag: row.languageTag ?? "",
  books: row.books,
  lastOpened: row.lastOpened ?? lastOpened,
  from: row.from,
  fixture: false,
});

export const listProjects = (
  projectsRoot: string,
  fixtureRoot: string | undefined,
  recent: Readonly<Record<string, string>>,
): Effect.Effect<readonly ProjectSummary[], never, Domain> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const rows = yield* repairProjectIndex(fileSystem, projectsRoot, (root) =>
      Effect.map(summarize(root, recent[root], false), asRow),
    );
    const listed = rows.map((row) => asSummary(row, recent[row.root]));
    if (fixtureRoot === undefined) return listed;
    const fixture = yield* summarize(fixtureRoot, recent[fixtureRoot], true);
    return [fixture, ...listed];
  });

const [indexRevision, setIndexRevision] = createSignal(0, { name: "projectIndexRevision" });
export const projectIndexRevision = indexRevision;
const indexChanged = Effect.sync(() => {
  setIndexRevision((held) => held + 1);
});

export const rememberProject = (
  projectsRoot: string,
  root: string,
  lastOpened: string | undefined,
): Effect.Effect<void, never, Domain> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const summary = yield* summarize(root, lastOpened, false);
    yield* Effect.ignore(recordProject(fileSystem, projectsRoot, asRow(summary)));
    yield* indexChanged;
  });

export const forgetRemembered = (
  projectsRoot: string,
  root: string,
): Effect.Effect<void, never, Domain> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* Effect.ignore(forgetProject(fileSystem, projectsRoot, root));
    yield* indexChanged;
  });

export const formatDate = (iso: string | undefined): string => {
  if (iso === undefined) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};
