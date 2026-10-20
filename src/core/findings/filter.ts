import type { BookId } from "@sefer/text/book";

import type { Finding, Producer, Severity } from "./finding";

export interface FindingsFilter {
  readonly severities: readonly Severity[];
  readonly producers: readonly Producer[];
  readonly books: readonly BookId[] | null;
  readonly codes: readonly string[] | null;
  readonly hideStale: boolean;
  readonly text: string;
}

export const SEVERITIES: readonly Severity[] = ["error", "warning", "info"];
export const PRODUCERS: readonly Producer[] = ["onion", "sous", "project"];

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

export const applyFilter = (
  findings: readonly Finding[],
  filter: FindingsFilter,
  isStale?: (finding: Finding) => boolean,
): readonly Finding[] => {
  const needle = filter.text.trim().toLowerCase();
  return findings.filter((finding) => passes(finding, filter, needle, isStale));
};

export interface Facet<T> {
  readonly value: T;
  readonly count: number;
}

export interface Facets {
  readonly total: number;
  readonly severities: readonly Facet<Severity>[];
  readonly producers: readonly Facet<Producer>[];
  readonly books: readonly Facet<BookId>[];
  readonly codes: readonly Facet<string>[];
}

const fixed = <T>(order: readonly T[], counts: Map<T, number>): readonly Facet<T>[] =>
  order.map((value) => ({ value, count: counts.get(value) ?? 0 }));

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

export type GroupKind = "book" | "code" | "severity";
