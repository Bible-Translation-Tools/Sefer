/**
 * Is a staged book one book, and how healthy is it?
 *
 * Two different questions, kept apart:
 *
 * - `validate` REFUSES. A candidate that renders to no chapters or no verses
 *   is not a book. (A manifest that names another book than its listing is
 *   refused earlier, in `openCandidate`.) It refuses that candidate only.
 * - `health` never refuses; it informs the choice. It is the Book census row
 *   the book list will show once the book arrives — chapters, verses, and
 *   onion's errors and warnings — computed by the same `censusOf`, so the
 *   two cannot disagree. No new check: onion already reports duplicate verses,
 *   gaps and a missing verse 1, and no proofreading (Sous) runs here.
 *
 * Expected counts come from the SOURCE TEXT when one is on this device, not
 * from the manifest's versification: `ufw` says nothing (Will, 2026-10-06).
 * The bwc 1 John case (2026-10-06): Moffat_chola's Primary reads 5 ch · 124 v,
 * Jude's text and 1 John's interleaved; mary_chishimba's reads 5 ch · 105 v,
 * the count English ULB has.
 */

import { censusOf, type BookSummary } from "../analysis/projectAnalysis";
import type { GalleyService } from "../galley/galley";

export type Health = Pick<BookSummary, "chapters" | "verses" | "diagnostics">;

export const health = (galley: GalleyService, book: string, usfm: string): Health =>
  censusOf(book, galley.analyze(usfm, "migrate.health"));

/** Why a rendered book is refused, or `undefined` when it is a book. */
export const validate = (usfm: string): string | undefined => {
  if (!/\\c\s+\d/.test(usfm)) return "it has no chapters";
  if (!/\\v\s+\d/.test(usfm)) return "it has no verses";
  return undefined;
};
