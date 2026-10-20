import { censusOf, type BookSummary } from "../analysis/projectAnalysis";
import type { GalleyService } from "../galley/galley";

export type Health = Pick<BookSummary, "chapters" | "verses" | "diagnostics">;

export const health = (galley: GalleyService, book: string, usfm: string): Health =>
  censusOf(book, galley.analyze(usfm, "migrate.health"));

export const validate = (usfm: string): string | undefined => {
  if (!/\\c\s+\d/.test(usfm)) return "it has no chapters";
  if (!/\\v\s+\d/.test(usfm)) return "it has no verses";
  return undefined;
};
