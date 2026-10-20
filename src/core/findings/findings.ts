import type { BookId } from "@sefer/text/book";

import type { Finding } from "./finding";

export type { Finding } from "./finding";

const RANK: Readonly<Record<Finding["severity"], number>> = { error: 0, warning: 1, info: 2 };

export const list = (projectAnalysis: {
  findings: () => readonly Finding[];
}): readonly Finding[] => {
  const byBook = new Map<BookId, Finding[]>();
  for (const finding of projectAnalysis.findings()) {
    const held = byBook.get(finding.bookId);
    if (held === undefined) byBook.set(finding.bookId, [finding]);
    else held.push(finding);
  }
  const out: Finding[] = [];
  for (const group of byBook.values()) {
    group.sort(
      (a, b) =>
        RANK[a.severity] - RANK[b.severity] ||
        a.from - b.from ||
        a.to - b.to ||
        (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
    );
    out.push(...group);
  }
  return out;
};

export const navigateTarget = (
  finding: Finding,
): { readonly bookId: BookId; readonly from: number; readonly to: number } => ({
  bookId: finding.bookId,
  from: finding.from,
  to: finding.to,
});
