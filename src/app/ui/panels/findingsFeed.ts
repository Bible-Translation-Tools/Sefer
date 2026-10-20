import type { BookId } from "@sefer/text/book";
import { createMemo, type Accessor } from "solid-js";

import type { BookExcerpts, Excerpt, Occurrence, OutlineRow } from "#core/excerpts/excerpts";
import type { Finding, Severity } from "#core/findings/finding";

import { t } from "../../i18n";
import { createExcerptFeed, type ExcerptFeed, type MarkTone } from "../excerpts";
import type { FindingsView } from "./findingsFilter";

export interface FindingsRow {
  readonly key: string;
  readonly sectionKey: string;
  readonly excerpt: Excerpt;
  readonly findings: readonly Finding[];
  readonly bookName: string;
  readonly front: boolean;
}

export interface FindingsHead {
  readonly key: string;
  readonly label: string;
  readonly detail?: string;
  readonly count: number;
  readonly front: boolean;
}

export interface FindingsFeedOptions {
  readonly findings: Accessor<readonly Finding[]>;
  readonly view: Accessor<FindingsView>;
}

export interface FindingsFeed {
  readonly groups: Accessor<readonly BookExcerpts[]>;
  readonly outline: Accessor<readonly OutlineRow[]>;
  readonly rows: Accessor<readonly FindingsRow[]>;
  readonly row: (key: string) => FindingsRow | undefined;
  readonly head: (key: string) => FindingsHead | undefined;
  readonly toneOf: (source: number | undefined, excerpt: Excerpt) => MarkTone | undefined;
  readonly excerpts: ExcerptFeed;
}

const SEP = "|";

const FRONT = `${SEP}front`;

const ALL = "all";

const RANK: Readonly<Record<Severity, number>> = { error: 0, warning: 1, info: 2 };

const rankOfKey = (key: string): number =>
  key === "error" ? 0 : key === "warning" ? 1 : key === "info" ? 2 : 3;

const isFront = (excerpt: Excerpt): boolean => excerpt.address.kind === "intro";

const asFinding = (hit: Occurrence): Finding | undefined =>
  // SAFETY: guarded by the `severity` check above, which no non-finding occurrence in this application satisfies. A hit from anywhere else is skipped rather than mistaken for a finding.
  "severity" in hit ? (hit as unknown as Finding) : undefined;

const findingsOf = (excerpt: Excerpt): readonly Finding[] => {
  const out: Finding[] = [];
  for (const hit of excerpt.hits) {
    const held = asFinding(hit);
    if (held !== undefined) out.push(held);
  }
  return out;
};

const inPlace = (findings: readonly Finding[]): readonly Finding[] =>
  [...findings].sort(
    (a, b) => a.from - b.from || a.to - b.to || RANK[a.severity] - RANK[b.severity],
  );

export const inMarkup = (excerpt: Excerpt, finding: Finding): boolean =>
  !excerpt.marks.some((mark) => mark.source === finding.from);

export interface FindingRun {
  readonly head: Finding;
  readonly members: readonly Finding[];
}

export const foldRuns = (findings: readonly Finding[]): readonly FindingRun[] => {
  const out: { head: Finding; members: Finding[] }[] = [];
  for (const finding of findings) {
    const last = out.at(-1);
    if (
      last !== undefined &&
      last.head.code === finding.code &&
      last.head.message === finding.message
    )
      last.members.push(finding);
    else out.push({ head: finding, members: [finding] });
  }
  return out;
};

interface Bucket {
  readonly key: string;
  readonly label: string;
  readonly detail?: string;
  readonly front: boolean;
  readonly excerpts: Excerpt[];
  readonly findings: Map<string, Finding[]>;
  readonly bookName: string;
}

const groupKeyOf = (finding: Finding, view: FindingsView): string =>
  view === "code" ? finding.code : view === "severity" ? finding.severity : ALL;

const bucketed = (
  groups: readonly BookExcerpts[],
  view: FindingsView,
  flatTitle: string,
): readonly Bucket[] => {
  const buckets = new Map<string, Bucket>();
  for (const group of groups)
    for (const excerpt of group.excerpts)
      for (const finding of findingsOf(excerpt)) {
        const key = groupKeyOf(finding, view);
        let bucket = buckets.get(key);
        if (bucket === undefined) {
          bucket = {
            key,
            label: view === "flat" ? flatTitle : key,
            front: false,
            excerpts: [],
            findings: new Map(),
            bookName: group.name,
          };
          buckets.set(key, bucket);
        }
        const held = bucket.findings.get(excerpt.sid);
        if (held === undefined) {
          bucket.findings.set(excerpt.sid, [finding]);
          bucket.excerpts.push(excerpt);
        } else held.push(finding);
      }

  const out = [...buckets.values()];
  const countOf = (bucket: Bucket): number =>
    [...bucket.findings.values()].reduce((sum, held) => sum + held.length, 0);
  if (view === "code") out.sort((a, b) => countOf(b) - countOf(a) || (a.key < b.key ? -1 : 1));
  if (view === "severity") out.sort((a, b) => rankOfKey(a.key) - rankOfKey(b.key));
  return out;
};

const byBook = (groups: readonly BookExcerpts[], frontTitle: string): readonly Bucket[] => {
  const out: Bucket[] = [];
  for (const group of groups) {
    const front: Excerpt[] = [];
    const rest: Excerpt[] = [];
    for (const excerpt of group.excerpts) (isFront(excerpt) ? front : rest).push(excerpt);
    const parts: readonly (readonly [boolean, readonly Excerpt[]])[] = [
      [true, front],
      [false, rest],
    ];
    for (const [front, excerpts] of parts) {
      if (excerpts.length === 0) continue;
      const findings = new Map<string, Finding[]>();
      for (const excerpt of excerpts) findings.set(excerpt.sid, [...findingsOf(excerpt)]);
      out.push({
        key: front ? `${group.bookId}${FRONT}` : group.bookId,
        label: group.bookId,
        detail: front ? frontTitle : group.name,
        front,
        excerpts: [...excerpts],
        findings,
        bookName: group.name,
      });
    }
  }
  return out;
};

export const createFindingsFeed = (options: FindingsFeedOptions): FindingsFeed => {
  const hits = createMemo((): readonly Occurrence[] => options.findings(), {
    name: "findingOccurrences",
  });

  const excerpts = createExcerptFeed({ hits, name: "findings" });

  const tones = createMemo(
    (): ReadonlyMap<BookId, Map<number, Severity>> => {
      const out = new Map<BookId, Map<number, Severity>>();
      for (const finding of options.findings()) {
        let inBook = out.get(finding.bookId);
        if (inBook === undefined) {
          inBook = new Map<number, Severity>();
          out.set(finding.bookId, inBook);
        }
        const held = inBook.get(finding.from);
        if (held === undefined || RANK[finding.severity] < RANK[held])
          inBook.set(finding.from, finding.severity);
      }
      return out;
    },
    { name: "findingTones" },
  );

  const model = createMemo(
    () => {
      const buckets =
        options.view() === "book"
          ? byBook(excerpts.groups(), t("Front matter"))
          : bucketed(excerpts.groups(), options.view(), t("Every finding"));

      const groups: BookExcerpts[] = [];
      const outline: OutlineRow[] = [];
      const rows: FindingsRow[] = [];
      const heads = new Map<string, FindingsHead>();
      const byKey = new Map<string, FindingsRow>();

      for (const bucket of buckets) {
        let count = 0;
        for (const excerpt of bucket.excerpts) {
          const findings = inPlace(bucket.findings.get(excerpt.sid) ?? []);
          count += findings.length;
          const row: FindingsRow = {
            key: `${bucket.key}${SEP}${excerpt.sid}`,
            sectionKey: bucket.key,
            excerpt,
            findings,
            bookName: bucket.bookName,
            front: bucket.front,
          };
          rows.push(row);
          byKey.set(row.key, row);
        }
        groups.push({
          bookId: bucket.key,
          name: bucket.detail ?? bucket.label,
          excerpts: bucket.excerpts,
          count,
        });
        outline.push({ bookId: bucket.key, name: bucket.label, count });
        heads.set(bucket.key, {
          key: bucket.key,
          label: bucket.label,
          ...(bucket.detail === undefined ? {} : { detail: bucket.detail }),
          count,
          front: bucket.front,
        });
      }

      return { groups, outline, rows, heads, byKey };
    },
    { name: "findingsSections" },
  );

  return {
    groups: () => model().groups,
    outline: () => model().outline,
    rows: () => model().rows,
    row: (key) => model().byKey.get(key),
    head: (key) => model().heads.get(key),
    toneOf: (source, excerpt) =>
      source === undefined ? undefined : tones().get(excerpt.bookId)?.get(source),
    excerpts,
  };
};
