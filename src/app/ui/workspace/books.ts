/**
 * The canon as the workspace shows it, and how a project's own names reach the
 * parser that reads what somebody typed.
 *
 * The table itself and the parser both live in core now
 * (`core/reference/canon.ts`, `core/reference/reference.ts`) — a canon is Bible
 * data, and "is `luk 3` a place" is not a question about widgets. What stays
 * here is the join: a `Project`'s decoded metadata, turned into the two things
 * the UI and the parser each need.
 */

import type { Project } from "../../../core/project/project";
import { CANON, testamentOf, type Testament } from "../../../core/reference/canon";
import { parseReference, type ReferenceLookup } from "../../../core/reference/reference";
import { localized, type ProjectMetadata } from "../../../core/resources/projectMetadata";

export { CANON, testamentOf, parseReference };
export type { Testament, ReferenceLookup };

const BY_ID = new Map(CANON.map((book) => [book.id, book]));

/**
 * What to call a book: what the project calls it, else the English canon, else
 * the id itself. Never blank — the id is always something a reader can act on.
 */
export const bookName = (id: string, metadata?: ProjectMetadata): string => {
  const local = localized(metadata?.bookNames[id], [metadata?.defaultLocale]);
  return local !== "" ? local : (BY_ID.get(id.toUpperCase())?.name ?? id);
};

/**
 * Everything a reference parser needs to know about one open project: the
 * books it holds, and every name it publishes for each of them.
 *
 * EVERY name, not the one that would be displayed. A translator on a Spanish
 * project may still type "Luke", and a project that names its books in two
 * locales should answer to both — so this hands over all of them and lets the
 * parser decide, rather than picking one here and losing the rest.
 */
export const lookupFor = (
  project: Project | undefined,
  metadata: ProjectMetadata | undefined,
): ReferenceLookup => ({
  known: project?.books.map((book) => book.id) ?? [],
  named: (id) => Object.values(metadata?.bookNames[id] ?? {}).filter((name) => name !== ""),
});
