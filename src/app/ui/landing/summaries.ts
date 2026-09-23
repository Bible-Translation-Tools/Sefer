/**
 * What the landing screen needs to know about a project root without opening it.
 *
 * Opening a project parses every book, seats it in the editor and attaches an
 * analysis. A list of projects must not do that once per row, so this reads the
 * two cheap things instead: the Burrito metadata (a name and a language) and a
 * directory listing (a book count). Both degrade — a folder with no
 * `metadata.json` is still a project, it is just one whose name is its folder.
 *
 * Those two cheap things are still two reads per project per visit, which is
 * why the answers are written down: `src/core/project/projectIndex.ts` holds
 * one row per project and `listProjects` below reads THAT, calling `summarize`
 * only for a folder the index has never heard of. The index is the list; this
 * file is how a row is first learned and how the fixture — which is in memory
 * and belongs in no index — joins it.
 *
 * `lastOpened` is the one field the filesystem cannot answer. It lives in the
 * index, written as a project is opened, and falls back to the
 * `shell.recentProjects` preference for a row written before this build.
 */

import { Effect, FileSystem, Option, Result } from "effect";

import { ProjectAdmin } from "#core/admin/projectAdmin";
import { lastSegment } from "#core/fileSystem/path";
import { HostInfo } from "#core/host/hostInfo";
import { recordProject, repairProjectIndex, type ProjectRow } from "#core/project/projectIndex";

import { languageName, languageTag, projectDisplayName } from "../../language";
import type { Domain } from "../../services";

export interface ProjectSummary {
  readonly root: string;
  /** The folder's own name — the identity when metadata has none. */
  readonly folder: string;
  readonly name: string;
  /**
   * The language's NAME — "English", not "en" and never the folder. Empty when
   * the project's metadata declares no language at all.
   */
  readonly language: string;
  /** The BCP-47 tag beside it, for the muted second line. Empty with the name. */
  readonly languageTag: string;
  /** `.usfm` files under the root, at any depth. */
  readonly books: number;
  /** ISO-8601, or undefined when this root has never been opened here. */
  readonly lastOpened: string | undefined;
  /** Dev only: the seeded in-memory fixture, which has no metadata at all. */
  readonly fixture: boolean;
}

const isUsfm = (path: string): boolean => path.toLowerCase().endsWith(".usfm");

/**
 * One row. Never fails: a root that cannot be read at all still lists, with a
 * zero book count, because a project that has become unreadable is exactly the
 * thing someone needs to see on this screen.
 */
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
    // The second answer for a name, and the only one a project with no burrito
    // has: what `ProjectAdmin.rename` wrote into `.sefer/project.json`.
    const recorded = yield* Effect.map(admin.recordedName(root), Option.getOrUndefined);

    const folder = lastSegment(root);
    const locale = host.locale();
    return {
      root,
      folder,
      name: projectDisplayName(metadata, locale) || recorded || folder,
      language: languageName(metadata, locale),
      languageTag: languageTag(metadata),
      books: entries.filter(isUsfm).length,
      lastOpened,
      fixture,
    };
  });

/** A summary as the index stores it: the four facts, minus how we drew them. */
const asRow = (summary: ProjectSummary): ProjectRow => ({
  root: summary.root,
  name: summary.name,
  language: summary.language,
  ...(summary.languageTag === "" ? {} : { languageTag: summary.languageTag }),
  books: summary.books,
  ...(summary.lastOpened === undefined ? {} : { lastOpened: summary.lastOpened }),
});

/** A row as the table draws it. `folder` is derived; the index need not store it. */
const asSummary = (row: ProjectRow, lastOpened: string | undefined): ProjectSummary => ({
  root: row.root,
  folder: lastSegment(row.root),
  name: row.name,
  language: row.language,
  languageTag: row.languageTag ?? "",
  books: row.books,
  lastOpened: row.lastOpened ?? lastOpened,
  fixture: false,
});

/**
 * The projects list, from the index — one file read — repaired against the
 * folder names actually present, and with the seeded fixture in front of it.
 *
 * `recent` is `shell.recentProjects`, used only where the index has no
 * `lastOpened` of its own: an index row written before this build knows the
 * project but not when it was last visited, and the preference still does.
 */
export const listProjects = (
  projectsRoot: string,
  fixtureRoot: string | undefined,
  recent: Readonly<Record<string, string>>,
): Effect.Effect<readonly ProjectSummary[], never, Domain> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const rows = yield* repairProjectIndex(fileSystem, projectsRoot, (root) =>
      // Only ever called for a folder with no row: the first sight of a
      // project Sefer did not import (a sync client, a copy, an older build).
      Effect.map(summarize(root, recent[root], false), asRow),
    );
    const listed = rows.map((row) => asSummary(row, recent[row.root]));
    if (fixtureRoot === undefined) return listed;
    // The fixture lives in memory, per page. It belongs in no index — writing
    // it down would leave a row for a project that vanishes on reload.
    const fixture = yield* summarize(fixtureRoot, recent[fixtureRoot], true);
    return [fixture, ...listed];
  });

/** Adds or refreshes one project's row — import, create and rename all end here. */
export const rememberProject = (
  projectsRoot: string,
  root: string,
  lastOpened: string | undefined,
): Effect.Effect<void, never, Domain> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const summary = yield* summarize(root, lastOpened, false);
    yield* Effect.ignore(recordProject(fileSystem, projectsRoot, asRow(summary)));
  });

/** Human date for the table; an absent value is the caller's em dash. */
export const formatDate = (iso: string | undefined): string => {
  if (iso === undefined) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};
