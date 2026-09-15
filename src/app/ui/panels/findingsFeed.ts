/**
 * The findings page's feed: findings in, the multibuffer's own model out.
 *
 * `/findings` shows the SAME cards `/find` shows — the projected verse, the
 * verse numbers, the context either side with its chevrons, Edit as a
 * satellite, sticky headers and an outline column — because a reader scanning
 * a place wants to see everything that might be wrong there in one gesture,
 * with the workflow they already have from searching (Will, 2026-09-15). So
 * nothing here draws anything: it turns findings into `Occurrence`s, hands
 * them to `createExcerptFeed` exactly as Find hands it search hits, and then
 * says how the excerpts that come back are SECTIONED and which findings each
 * card is answering for.
 *
 * Three things are worth stating.
 *
 * **An occurrence remembers its finding.** `core/excerpts` keeps the very
 * objects it was handed on `Excerpt.hits`, so a card can be asked "which
 * findings are you about" without re-matching offsets against a list — which
 * is the kind of arithmetic that silently answers "the wrong ones" when two
 * findings share a span.
 *
 * **A section is not always a book.** By code, by severity and flat are the
 * same cards under different headers, and a verse holding two codes appears in
 * two sections — so a row's key carries its section, which is why
 * `ExcerptDecor.rowKey` exists. Front matter is its own section above a book's
 * chapters, because "GEN front" is a place, not chapter zero.
 *
 * **"In markup" is read off the marks, not re-derived.** A finding whose span
 * produced no mark in the projection has no character in the reading — it is
 * inside a marker name, an attribute, a control character — which is exactly
 * what `Excerpts.quote` reports as `projected: false`. Asking the excerpt
 * costs nothing and needs no second analysis, and the raw slice is cut from
 * `Excerpt.source`, which is the text of the card's own span.
 *
 * ### What belongs in core later
 *
 * `markupSlice` and `foldRuns` are pure functions over values core already
 * owns, and both would sit comfortably beside `quote` and `groupBy`. They are
 * here because this pass may not edit `src/core`; nothing in either reaches
 * for Solid, the router or a host.
 */

import { createMemo, type Accessor } from "solid-js";

import type {
  BookExcerpts,
  Excerpt,
  Occurrence,
  OutlineRow,
} from "../../../core/excerpts/excerpts";
import type { Finding, Severity } from "../../../core/findings/finding";
import { t } from "../../i18n";
import { createExcerptFeed, type ExcerptFeed, type MarkTone } from "../excerpts";
import type { FindingsView } from "./findingsFilter";

/** An occurrence that remembers which finding produced it. */
interface FindingOccurrence extends Occurrence {
  readonly finding: Finding;
}

/** One card on the page: an excerpt, in a section, answering for findings. */
export interface FindingsRow {
  /** `<section>|<sid>` — unique across sections, which the sid alone is not. */
  readonly key: string;
  readonly sectionKey: string;
  readonly excerpt: Excerpt;
  /** This section's findings inside this verse, in position order. */
  readonly findings: readonly Finding[];
  /** The book's own display name, for a front-matter card's label. */
  readonly bookName: string;
  /** Is this the matter before the book's first chapter? */
  readonly front: boolean;
}

/** What a sticky header says. `count` is FINDINGS, never rows. */
export interface FindingsHead {
  readonly key: string;
  /** `GEN`, `unknown-marker`, `warning`, or the flat view's one title. */
  readonly label: string;
  /** `Genesis`, `Front matter` — the second half of a book header. */
  readonly detail?: string;
  readonly count: number;
  readonly front: boolean;
}

export interface FindingsFeedOptions {
  /** The filtered findings, in `findings.list` order. */
  readonly findings: Accessor<readonly Finding[]>;
  readonly view: Accessor<FindingsView>;
}

export interface FindingsFeed {
  /** The sections, in the shape `ExcerptList` renders. */
  readonly groups: Accessor<readonly BookExcerpts[]>;
  readonly outline: Accessor<readonly OutlineRow[]>;
  /** Every card, in reading order: what the keyboard cursor walks. */
  readonly rows: Accessor<readonly FindingsRow[]>;
  readonly row: (key: string) => FindingsRow | undefined;
  readonly head: (key: string) => FindingsHead | undefined;
  /** A mark's severity, by the source offset of the finding it came from. */
  readonly toneOf: (source: number | undefined, excerpt: Excerpt) => MarkTone | undefined;
  /** Everything Find's feed already does: seat, analyse, open, expand. */
  readonly excerpts: ExcerptFeed;
}

/** The key separator. Neither a sid, a code nor a severity contains it. */
const SEP = "|";

/** A book's front matter, as a section key that cannot collide with a book id. */
const FRONT = `${SEP}front`;

/** The flat view's one section. */
const ALL = "all";

const RANK: Readonly<Record<Severity, number>> = { error: 0, warning: 1, info: 2 };

/** A section key's place on the ladder; an unknown key sorts last, never throws. */
const rankOfKey = (key: string): number =>
  key === "error" ? 0 : key === "warning" ? 1 : key === "info" ? 2 : 3;

/**
 * The matter before the first chapter.
 *
 * An excerpt built around a span with no verse anchor carries chapter 0 and no
 * verse (`core/excerpts`, `buildExcerpt`) — an id line, a running header, a
 * table of contents entry. "Genesis 0" is not a chapter anybody has, so the
 * page groups these under their own header and labels the card itself.
 */
const isFront = (excerpt: Excerpt): boolean =>
  excerpt.ref.verse === undefined && excerpt.ref.chapter < 1;

/** Which findings an excerpt was built from — the occurrences, read back. */
export const findingsOf = (excerpt: Excerpt): readonly Finding[] => {
  const out: Finding[] = [];
  for (const hit of excerpt.hits) {
    // SAFETY: every occurrence this page produces is a `FindingOccurrence`,
    // and `core/excerpts` hands the very objects back on `Excerpt.hits`. The
    // narrowing is checked rather than assumed — a hit from anywhere else
    // simply has no `finding` and is skipped.
    const held = "finding" in hit ? (hit as FindingOccurrence).finding : undefined;
    if (held !== undefined) out.push(held);
  }
  return out;
};

/** Position order, then the ladder: a card reads down the verse it shows. */
const inPlace = (findings: readonly Finding[]): readonly Finding[] =>
  [...findings].sort(
    (a, b) => a.from - b.from || a.to - b.to || RANK[a.severity] - RANK[b.severity],
  );

/**
 * Has this finding no character in the reading?
 *
 * `marksFor` produces one mark per contiguous run of projected characters the
 * span covers, tagged with the occurrence's source offset. No mark means the
 * span is markup — a marker name, an attribute, a control character — which is
 * the same answer `Excerpts.quote` gives as `projected: false`, arrived at
 * without projecting the window a second time.
 */
export const inMarkup = (excerpt: Excerpt, finding: Finding): boolean =>
  !excerpt.marks.some((mark) => mark.source === finding.from);

/** A quotation cut from raw USFM, in three parts so the span can be marked. */
export interface RawSlice {
  readonly before: string;
  readonly hit: string;
  readonly after: string;
}

const BEFORE = 24;
const AFTER = 32;

const flat = (part: string): string => part.replace(/\s+/g, " ");

/**
 * The raw USFM around a finding's span, cut from the card's own source.
 *
 * `Excerpt.source` is the text of `Excerpt.span`, so this is a subtraction and
 * not a mapping — the same arithmetic the card's USFM mode does. Clamped at
 * both ends, because a span may reach past the verses the card is showing.
 */
export const markupSlice = (excerpt: Excerpt, finding: Finding): RawSlice => {
  const base = excerpt.span.from;
  const length = excerpt.source.length;
  const at = Math.max(0, Math.min(length, finding.from - base));
  const to = Math.max(at, Math.min(length, finding.to - base));
  const start = Math.max(0, at - BEFORE);
  const end = Math.min(length, to + AFTER);
  return {
    before: `${start > 0 ? "…" : ""}${flat(excerpt.source.slice(start, at))}`,
    hit: flat(excerpt.source.slice(at, to)),
    after: `${flat(excerpt.source.slice(to, end))}${end < length ? "…" : ""}`,
  };
};

/** A run of identical findings, folded into the one line that stands for them. */
export interface FindingRun {
  readonly head: Finding;
  readonly members: readonly Finding[];
}

/**
 * Consecutive findings with the same code AND the same message are one thing
 * said N times — seventy-six lines of "\s5 is not a known marker" is a wall,
 * not a report. Only CONSECUTIVE ones fold, so the fold never re-orders, and
 * it is purely presentational: every count on the page is still over findings.
 */
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

/** One section under construction. */
interface Bucket {
  readonly key: string;
  readonly label: string;
  readonly detail?: string;
  readonly front: boolean;
  readonly excerpts: Excerpt[];
  /** The findings this section shows in each of its excerpts, by sid. */
  readonly findings: Map<string, Finding[]>;
  readonly bookName: string;
}

const groupKeyOf = (finding: Finding, view: FindingsView): string =>
  view === "code" ? finding.code : view === "severity" ? finding.severity : ALL;

/**
 * The sections, for a view that is not "by book".
 *
 * A verse holding two codes belongs to two sections, and carries only that
 * section's findings in each — a card under "unknown-marker" that listed an
 * unrelated warning would be answering a question nobody asked.
 */
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
  // The same orders `core/findings/filter.groupBy` uses: codes by descending
  // count, because the code to deal with first belongs at the top; severities
  // on the ladder.
  if (view === "code") out.sort((a, b) => countOf(b) - countOf(a) || (a.key < b.key ? -1 : 1));
  if (view === "severity") out.sort((a, b) => rankOfKey(a.key) - rankOfKey(b.key));
  return out;
};

/** The sections for "by book": front matter above the chapters, per book. */
const byBook = (groups: readonly BookExcerpts[], frontTitle: string): readonly Bucket[] => {
  const out: Bucket[] = [];
  for (const group of groups) {
    const parts: readonly (readonly [boolean, readonly Excerpt[]])[] = [
      [true, group.excerpts.filter((excerpt) => isFront(excerpt))],
      [false, group.excerpts.filter((excerpt) => !isFront(excerpt))],
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

/**
 * The findings page's model.
 *
 * Call it from a component body: `createExcerptFeed` owns signals and a
 * navigate, and everything below is memos over what it produces.
 */
export const createFindingsFeed = (options: FindingsFeedOptions): FindingsFeed => {
  /**
   * One occurrence per finding, carrying the finding. Zero-width and
   * markup-only spans are kept: `group` still files them under the verse they
   * fall in, and a card that shows no highlight still shows the verse and says
   * why in its header.
   */
  const hits = createMemo(
    (): readonly Occurrence[] =>
      options.findings().map(
        (finding): FindingOccurrence => ({
          bookId: finding.bookId,
          from: finding.from,
          to: finding.to,
          finding,
        }),
      ),
    { name: "findingOccurrences" },
  );

  const excerpts = createExcerptFeed({ hits, name: "findings" });

  /**
   * The worst severity claimed at each source offset, by book. A mark carries
   * the source offset of the occurrence it came from, and that plus the card's
   * book is the only pair that identifies a finding's span across the project.
   */
  const tones = createMemo(
    (): ReadonlyMap<string, Severity> => {
      const out = new Map<string, Severity>();
      for (const finding of options.findings()) {
        const key = `${finding.bookId}${SEP}${finding.from}`;
        const held = out.get(key);
        if (held === undefined || RANK[finding.severity] < RANK[held])
          out.set(key, finding.severity);
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
        // `bookId` is the SECTION key here — `ExcerptList` keys its sections by
        // it and nothing downstream reads it as a book. The book a card belongs
        // to is `excerpt.bookId`, which is where Edit and Go read it from.
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
      source === undefined ? undefined : tones().get(`${excerpt.bookId}${SEP}${source}`),
    excerpts,
  };
};
