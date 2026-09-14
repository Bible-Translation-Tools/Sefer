/**
 * What the landing screen needs to know about a project root without opening it.
 *
 * Opening a project parses every book, seats it in the editor and attaches an
 * analysis. A list of projects must not do that once per row, so this reads the
 * two cheap things instead: the Burrito metadata (a name and a language) and a
 * directory listing (a book count). Both degrade — a folder with no
 * `metadata.json` is still a project, it is just one whose name is its folder.
 *
 * `lastOpened` comes from `shell.recentProjects`, which `open()` writes. It is
 * the only field the filesystem cannot answer.
 */

import { Effect, FileSystem, Option, Result } from "effect";

import { ProjectAdmin } from "../../../core/admin/projectAdmin";
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

/** Every project root under `projectsRoot`, plus the fixture when seeded. */
export const listProjectRoots = (
  projectsRoot: string,
  fixtureRoot: string | undefined,
): Effect.Effect<readonly { readonly root: string; readonly fixture: boolean }[], never, Domain> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const names = yield* Effect.orElseSucceed(
      fileSystem.readDirectory(projectsRoot),
      (): readonly string[] => [],
    );
    const roots = [...names]
      .sort()
      .map((name) => ({ root: `${projectsRoot}/${name}`, fixture: false }));
    return fixtureRoot === undefined ? roots : [{ root: fixtureRoot, fixture: true }, ...roots];
  });

/** Human date for the table; an absent value is the caller's em dash. */
export const formatDate = (iso: string | undefined): string => {
  if (iso === undefined) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};
