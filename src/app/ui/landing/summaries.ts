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

import { ProjectAdmin } from "../../../core/admin/projectAdmin";
import {
  recordProject,
  repairProjectIndex,
  type ProjectRow,
} from "../../../core/project/projectIndex";
import type { BurritoMetadata } from "../../../core/resources/burrito";
import type { Domain } from "../../services";

export interface ProjectSummary {
  readonly root: string;
  /** The folder's own name — the identity when metadata has none. */
  readonly folder: string;
  readonly name: string;
  /** "English (en)" when metadata declares a language; empty when it does not. */
  readonly language: string;
  /** `.usfm` files under the root, at any depth. */
  readonly books: number;
  /** ISO-8601, or undefined when this root has never been opened here. */
  readonly lastOpened: string | undefined;
  /** Dev only: the seeded in-memory fixture, which has no metadata at all. */
  readonly fixture: boolean;
}

const lastSegment = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * A localized Burrito string, preferring the project's own default locale.
 * Burrito stores every name under a locale key, and there is no guarantee the
 * reader's locale is one of them, so "any value at all" beats "nothing".
 */
const localized = (
  values: Readonly<Record<string, string>>,
  preferred: string | undefined,
): string => {
  if (preferred !== undefined && values[preferred] !== undefined) return values[preferred];
  return Object.values(values).at(0) ?? "";
};

const languageOf = (metadata: BurritoMetadata): string => {
  const language = metadata.languages.at(0);
  if (language === undefined) return "";
  const name = localized(language.name, metadata.meta.defaultLocale);
  return name === "" ? language.tag : `${name} (${language.tag})`;
};

const isUsfm = (path: string): boolean => path.toLowerCase().endsWith(".usfm");

/**
 * One row. Never fails: a root that cannot be read at all still lists, with a
 * zero book count, because a project that has become unreadable is exactly the
 * thing someone needs to see on this screen.
 */
export const summarize = (
  root: string,
  lastOpened: string | undefined,
  fixture: boolean,
): Effect.Effect<ProjectSummary, never, Domain> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const admin = yield* ProjectAdmin;

    const entries = yield* Effect.orElseSucceed(
      fileSystem.readDirectory(root, { recursive: true }),
      (): readonly string[] => [],
    );
    const metadata = yield* Effect.map(Effect.result(admin.metadata(root)), (result) =>
      Result.isSuccess(result) ? Option.getOrUndefined(result.success) : undefined,
    );

    const folder = lastSegment(root);
    return {
      root,
      folder,
      name:
        metadata === undefined
          ? folder
          : localized(metadata.identification.name, metadata.meta.defaultLocale) || folder,
      language: metadata === undefined ? "" : languageOf(metadata),
      books: entries.filter(isUsfm).length,
      lastOpened,
      fixture,
    };
  });

/** A summary as the index stores it: the four facts, minus how we drew them. */
export const asRow = (summary: ProjectSummary): ProjectRow => ({
  root: summary.root,
  name: summary.name,
  language: summary.language,
  books: summary.books,
  ...(summary.lastOpened === undefined ? {} : { lastOpened: summary.lastOpened }),
});

/** A row as the table draws it. `folder` is derived; the index need not store it. */
const asSummary = (row: ProjectRow, lastOpened: string | undefined): ProjectSummary => ({
  root: row.root,
  folder: lastSegment(row.root),
  name: row.name,
  language: row.language,
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
