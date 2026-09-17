// filter.ts
//
// Reading policy for a panel of findings: which rows a reader has chosen to
// see, and how they are grouped (vision §11.4).
//
// This is presentation policy, so it is deliberately PURE and deliberately
// subtractive-only. Two rules the whole file exists to hold:
//
//  - A filter never deletes a finding. `applyFilter` returns a view over the
//    array `ProjectAnalysis` already holds; the census, the inline marks and
//    the corpus counts are untouched by anything here. Hiding a category is a
//    reader's choice about a screen, not a claim about the project.
//  - Nothing here re-derives a position, a severity or a stamp. Freshness is
//    the caller's answer (`isStale`), because only the shell holds the Books.
//
// It lives in core rather than in the shell because it is a total function
// over the one shape with no host in it — the same policy a satellite panel, a
// diff view or a headless report would want — but it takes no Effect and no
// Solid: a click is a click, and a filter that could suspend would be a filter
// the panel has to await on every keystroke.

import type { BookId } from "../book/book";
import type { Finding, Producer, Severity } from "./finding";

/**
 * A reader's chosen view of the findings.
 *
 * `severities` and `producers` are ALLOW-lists: a rung or a producer absent
 * from them is hidden. `books` and `codes` are `null` for "no restriction",
 * which is not the same as `[]` (a reader who has unticked every book sees
 * nothing, and should — that is a state they can see and undo).
 *
 * `text` matches the message, the code and the book id, case-insensitively.
 * It is a plain substring: a panel filter is a way to find a row you can
 * already see, not a query language.
 */
export interface FindingsFilter {
  readonly severities: readonly Severity[];
  readonly producers: readonly Producer[];
  /** `null` = every book. */
  readonly books: readonly BookId[] | null;
  /** `null` = every code. */
  readonly codes: readonly string[] | null;
  readonly hideStale: boolean;
  readonly text: string;
}

/** The three rungs and the three producers, in the order a legend reads them. */
export const SEVERITIES: readonly Severity[] = ["error", "warning", "info"];
export const PRODUCERS: readonly Producer[] = ["onion", "sous", "project"];

/**
 * Everything shown, nothing hidden — including stale rows, which carry a badge
 * instead. The default has to be "show me the truth": a panel that opened
 * pre-filtered would let a reader believe a project is clean when a preference
 * from six months ago is hiding the reason it is not.
 */
export const DEFAULT_FILTER: FindingsFilter = {
  severities: SEVERITIES,
  producers: PRODUCERS,
  books: null,
  codes: null,
  hideStale: false,
  text: "",
};

const matchesText = (finding: Finding, needle: string): boolean =>
  finding.message.toLowerCase().includes(needle) ||
  finding.code.toLowerCase().includes(needle) ||
  finding.bookId.toLowerCase().includes(needle);

/**
 * The findings a reader has asked to see, in the order they arrived.
 *
 * Order is the CALLER's: `findings.list` has already ordered by book (project
 * order), then severity, then position, and a filter that re-sorted would
 * quietly override that. Filtering is a `filter`, in the exact sense.
 *
 * `isStale` is consulted only when `filter.hideStale` is set, so a panel that
 * shows stale rows (the default) pays for no freshness checks at all — the
 * check costs a Book lookup per finding in the shell.
 */
export const applyFilter = (
  findings: readonly Finding[],
  filter: FindingsFilter,
  isStale?: (finding: Finding) => boolean,
): readonly Finding[] => {
  const needle = filter.text.trim().toLowerCase();
  return findings.filter((finding) => passes(finding, filter, needle, isStale));
};

/** One row of a facet list: the value, and how many findings carry it. */
export interface Facet<T> {
  readonly value: T;
  readonly count: number;
}

/**
 * How many findings each filterable value has, for the chips that offer them.
 *
 * Computed over the UNFILTERED list on purpose: a chip whose count fell to
 * zero because the chip itself is off would be a chip nobody could turn back
 * on, and a count that changes as you tick other boxes is a count nobody can
 * reason about. So these are the project's counts, and the filter is what
 * hides rows.
 *
 * Severities and producers appear in their legend order even at zero, because
 * they are a fixed ladder a reader learns the position of. Books appear in
 * first-appearance order — which is the project's canonical book order, since
 * `list` grouped them that way — and codes by descending count, because a
 * code picker is a "what is wrong most often here" list.
 */
export interface Facets {
  readonly total: number;
  readonly severities: readonly Facet<Severity>[];
  readonly producers: readonly Facet<Producer>[];
  readonly books: readonly Facet<BookId>[];
  readonly codes: readonly Facet<string>[];
}

const fixed = <T>(order: readonly T[], counts: Map<T, number>): readonly Facet<T>[] =>
  order.map((value) => ({ value, count: counts.get(value) ?? 0 }));

/** Whether one finding passes a filter. `applyFilter` and `summarise` share it. */
const passes = (
  finding: Finding,
  filter: FindingsFilter,
  needle: string,
  isStale?: (finding: Finding) => boolean,
): boolean => {
  if (!filter.severities.includes(finding.severity)) return false;
  if (!filter.producers.includes(finding.producer)) return false;
  if (filter.books !== null && !filter.books.includes(finding.bookId)) return false;
  if (filter.codes !== null && !filter.codes.includes(finding.code)) return false;
  if (needle !== "" && !matchesText(finding, needle)) return false;
  if (filter.hideStale && isStale !== undefined && isStale(finding)) return false;
  return true;
};

const facetsOf = (
  total: number,
  severities: Map<Severity, number>,
  producers: Map<Producer, number>,
  books: Map<BookId, number>,
  codes: Map<string, number>,
): Facets => ({
  total,
  severities: fixed(SEVERITIES, severities),
  producers: fixed(PRODUCERS, producers),
  books: [...books].map(([value, count]) => ({ value, count })),
  codes: [...codes]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1)),
});

/**
 * ONE loop, four tallies.
 *
 * It used to be four `map`s into four `tally`s, which on a project with twenty
 * thousand findings is four throwaway arrays of twenty thousand strings before
 * any counting starts.
 */
export const facets = (findings: Iterable<Finding>): Facets => {
  const severities = new Map<Severity, number>();
  const producers = new Map<Producer, number>();
  const books = new Map<BookId, number>();
  const codes = new Map<string, number>();
  let total = 0;
  for (const finding of findings) {
    total += 1;
    severities.set(finding.severity, (severities.get(finding.severity) ?? 0) + 1);
    producers.set(finding.producer, (producers.get(finding.producer) ?? 0) + 1);
    books.set(finding.bookId, (books.get(finding.bookId) ?? 0) + 1);
    codes.set(finding.code, (codes.get(finding.code) ?? 0) + 1);
  }
  return facetsOf(total, severities, producers, books, codes);
};

/**
 * What a HEADER needs, in one pass and without a list.
 *
 * "20,352 of 20,352 shown" and a row of filter chips are counts, and counts do
 * not need the findings sorted, grouped or even collected — but asking for them
 * through `list` + `facets` + `applyFilter` meant three walks of every finding
 * plus a sort, all of it before the panel could paint. This is the same answers
 * in one walk and no intermediate array.
 *
 * `shown` applies the filter; the facets deliberately do NOT, because a chip's
 * own count must not move as you click it.
 */
export const summarise = (
  findings: Iterable<Finding>,
  filter: FindingsFilter,
  isStale?: (finding: Finding) => boolean,
): { readonly total: number; readonly shown: number; readonly facets: Facets } => {
  const needle = filter.text.trim().toLowerCase();
  const severities = new Map<Severity, number>();
  const producers = new Map<Producer, number>();
  const books = new Map<BookId, number>();
  const codes = new Map<string, number>();
  let total = 0;
  let shown = 0;
  for (const finding of findings) {
    total += 1;
    severities.set(finding.severity, (severities.get(finding.severity) ?? 0) + 1);
    producers.set(finding.producer, (producers.get(finding.producer) ?? 0) + 1);
    books.set(finding.bookId, (books.get(finding.bookId) ?? 0) + 1);
    codes.set(finding.code, (codes.get(finding.code) ?? 0) + 1);
    if (passes(finding, filter, needle, isStale)) shown += 1;
  }
  return { total, shown, facets: facetsOf(total, severities, producers, books, codes) };
};

/** The three axes a reader can group by. `flat` is the absence of grouping. */
export type GroupKind = "book" | "code" | "severity";

/**
 * One collapsible section of the panel. `key` is stable for a given kind, so
 * a `<For>` keyed on it keeps a section's open/closed state across a refresh.
 */
export interface FindingGroup {
  readonly key: string;
  readonly count: number;
  readonly findings: readonly Finding[];
}

/** A group key's place on the ladder; unknown keys sort last rather than throw. */
const rankOf = (key: string): number => {
  const found = SEVERITIES.findIndex((severity) => severity === key);
  return found === -1 ? SEVERITIES.length : found;
};

/**
 * The findings, in ordered groups, with each group's own order preserved.
 *
 * Group order is chosen per axis, because the useful order differs: by book it
 * is the project's canonical order (first appearance, since the caller already
 * grouped that way — sorting ids would put 3 John before Jude); by severity it
 * is the ladder; by code it is descending count, so the code to deal with
 * first is the one at the top. An empty input yields no groups, which is the
 * shape `<Show>` wants for the "nothing to report" line.
 */
export const groupBy = (findings: readonly Finding[], kind: GroupKind): readonly FindingGroup[] => {
  const keyOf = (finding: Finding): string =>
    kind === "book" ? finding.bookId : kind === "code" ? finding.code : finding.severity;
  const grouped = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = keyOf(finding);
    const held = grouped.get(key);
    if (held === undefined) grouped.set(key, [finding]);
    else held.push(finding);
  }
  const groups: FindingGroup[] = [...grouped].map(([key, held]) => ({
    key,
    count: held.length,
    findings: held,
  }));
  if (kind === "code") groups.sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));
  if (kind === "severity") groups.sort((a, b) => rankOf(a.key) - rankOf(b.key));
  return groups;
};
