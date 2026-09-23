// findings.ts
//
// The panel's half of slice 14: how findings are ordered, and what "navigate
// to this finding" means in a module that cannot navigate.
//
// `finding.ts` holds the shape and the two adapters. This file holds the
// reading policy, and it is deliberately tiny — if it grows a filter model, a
// grouping DSL or a selection state, those belong to the shell, because
// filtering is presentation policy and hiding a category does not alter
// analysis truth (vision §11.4).

import type { BookId, Ref } from "../book/book";
import type { Analysis } from "../galley";
import type { Finding } from "./finding";

export type { Finding } from "./finding";

/** Errors first within a book, so the panel's first row is the worst one. */
const RANK: Readonly<Record<Finding["severity"], number>> = { error: 0, warning: 1, info: 2 };

/**
 * Every finding a ProjectAnalysis holds, grouped by book in the project's own
 * order and then ordered within a book by severity, position and code.
 *
 * Takes the pieces of the service it actually reads rather than the service
 * itself, so a satellite panel over a subset, or a caller that already has the
 * array, needs no Layer. `findings()` is memoised inside ProjectAnalysis, so
 * calling this per render costs the sort and nothing else.
 *
 * The book order is the order ids first appear in `findings()`, which is the
 * insertion order of the analyses — i.e. the project's canonical book order.
 * Sorting by book id instead would put 3 John before Jude.
 */
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

/**
 * Where a finding points, as a plain value.
 *
 * Core cannot navigate: opening a book, clipping a chapter and placing a caret
 * are the shell's and the editor's business, and a core module that reached
 * into either would need the router and CodeMirror. So this returns the target
 * and stops. The shell calls `project.instantiate(bookId)`, mounts a view, and
 * scrolls the span into place.
 *
 * `from`/`to` are the SEMANTIC span, exactly as the engine reported it, even
 * when visual mode hides the markup it covers (vision §11.3). A presentation
 * anchor near a visible point is the view's own decision; it must never be
 * substituted here, because the same span is what a fix would edit.
 *
 * `ref` is filled in only when the caller hands over an analysis that
 * describes the very text the finding was computed from — the table of
 * contents is the only route from an offset to a chapter and verse, and one
 * from a different revision would name the wrong verse with total confidence.
 * The finding's own shape carries no `Ref` for the same reason: a stored
 * reference would outlive the text it was derived from.
 */
export const navigateTarget = (
  finding: Finding,
  analysis?: Analysis,
): {
  readonly bookId: BookId;
  readonly from: number;
  readonly to: number;
  readonly ref?: Ref;
} => {
  const target = { bookId: finding.bookId, from: finding.from, to: finding.to };
  if (analysis === undefined) return target;
  if (
    analysis.docLen !== finding.engine.docLen ||
    analysis.sourceHash !== finding.engine.sourceHash
  )
    return target;
  const at = analysis.dish.toc.at(finding.from);
  if (at === null) return target;
  return {
    ...target,
    ref: {
      book: finding.bookId,
      chapter: at.chapter,
      ...(at.verse > 0 ? { verse: at.verse } : {}),
    },
  };
};
