/**
 * The canon as the workspace shows it, and what a project calls each book.
 *
 * The table lives in core (`core/location/canon.ts`) because a canon is Bible
 * data; reading what somebody typed is `core/location/citation.ts`, reached
 * through the shell's location service (`app/location.ts`). What stays here
 * is the display join: a `Project`'s decoded metadata, turned into a name.
 */

import { CANON, testamentOf, type Testament } from "#core/location/canon";
import { localized, type ProjectMetadata } from "#core/resources/projectMetadata";

export { CANON, testamentOf };
export type { Testament };

const BY_ID = new Map(CANON.map((book) => [book.id, book]));

/**
 * What to call a book: what the project calls it, else the English canon, else
 * the id itself. Never blank — the id is always something a reader can act on.
 */
export const bookName = (id: string, metadata?: ProjectMetadata): string => {
  const local = localized(metadata?.bookNames[id], [metadata?.defaultLocale]);
  return local !== "" ? local : (BY_ID.get(id.toUpperCase())?.name ?? id);
};
