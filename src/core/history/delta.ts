/**
 * Pure projection from Galley's paired-text diff into book/chapter/verse facts.
 *
 * The caller must pass the exact before/after strings that produced `skeleton`.
 * Lengths are checked as a cheap stale-result guard, but equal-length text
 * changes cannot be detected from a DiffSkeleton alone. No git, author,
 * remote, editor, or decision policy belongs here.
 */
import type { Addr, DiffSkeleton, DecisionUnit } from "../galley/diff";

export interface UnitChangeFact {
  readonly id: string;
  readonly status: DecisionUnit["status"];
  readonly kind: DecisionUnit["kind"];
  readonly before: Addr | undefined;
  readonly after: Addr | undefined;
  readonly relabeled: boolean;
  readonly whitespaceOnly: boolean;
  readonly usfmStructureOnly: boolean;
  readonly duplicate: boolean;
  readonly displaced: boolean;
}

export interface BookChangeScope {
  readonly book: string;
  readonly unitIds: readonly string[];
}

export interface ChapterChangeScope {
  readonly book: string;
  /** `0` is front matter; chapter numbers are otherwise the USFM designator. */
  readonly chapter: number;
  readonly occurrence: number;
  readonly kind: Addr["kind"];
  /** SIDs retain verse bridges, duplicate suffixes, and non-verse addresses. */
  readonly refs: readonly string[];
  readonly unitIds: readonly string[];
}

export interface DeltaScope {
  readonly beforeLength: number;
  readonly afterLength: number;
  readonly changedUnits: readonly UnitChangeFact[];
  readonly books: readonly BookChangeScope[];
  readonly chapters: readonly ChapterChangeScope[];
}

export type DeltaScopeError = "baseline-length-mismatch" | "current-length-mismatch";
export type DeltaScopeResult =
  | { readonly ok: true; readonly value: DeltaScope }
  | { readonly ok: false; readonly error: DeltaScopeError };

const isChanged = (unit: DecisionUnit): boolean =>
  unit.status !== "unchanged" ||
  unit.relabeled ||
  unit.isWhitespaceChange ||
  unit.isUsfmStructureChange;

const addrKey = (addr: Addr): string => `${addr.book}\0${addr.chapter}\0${addr.cdup}\0${addr.kind}`;

/**
 * Derive location metadata for one exact, already-aligned text pair.
 *
 * This does not decide whether a person should accept, reject, or apply any
 * unit. Addresses and unit identity come from Galley; both sides are retained
 * so moves and relabels are not flattened into one guessed location.
 */
export const deriveDeltaScope = (
  beforeText: string,
  afterText: string,
  skeleton: DiffSkeleton,
): DeltaScopeResult => {
  if (skeleton.baselineLen !== beforeText.length)
    return { ok: false, error: "baseline-length-mismatch" };
  if (skeleton.currentLen !== afterText.length)
    return { ok: false, error: "current-length-mismatch" };

  const changedUnits = skeleton.units.filter(isChanged).map((unit): UnitChangeFact => ({
    id: unit.id,
    status: unit.status,
    kind: unit.kind,
    before: unit.baselineAddr,
    after: unit.currentAddr,
    relabeled: unit.relabeled,
    whitespaceOnly: unit.isWhitespaceChange,
    usfmStructureOnly: unit.isUsfmStructureChange,
    duplicate: unit.isDup,
    displaced: unit.displaced,
  }));

  const bookUnits = new Map<string, Set<string>>();
  const chapterUnits = new Map<
    string,
    {
      book: string;
      chapter: number;
      occurrence: number;
      kind: Addr["kind"];
      refs: Set<string>;
      ids: Set<string>;
    }
  >();

  for (const unit of changedUnits) {
    const locations = [unit.before, unit.after].filter((addr): addr is Addr => addr !== undefined);
    const seenAt = new Set<string>();
    for (const addr of locations) {
      const book = addr.book;
      const ids = bookUnits.get(book) ?? new Set<string>();
      ids.add(unit.id);
      bookUnits.set(book, ids);

      const key = addrKey(addr);
      if (seenAt.has(key)) continue;
      seenAt.add(key);
      const chapter = chapterUnits.get(key) ?? {
        book,
        chapter: addr.chapter,
        occurrence: addr.cdup,
        kind: addr.kind,
        refs: new Set<string>(),
        ids: new Set<string>(),
      };
      chapter.ids.add(unit.id);
      chapter.refs.add(addr.sid);
      chapterUnits.set(key, chapter);
    }
  }

  return {
    ok: true,
    value: {
      beforeLength: beforeText.length,
      afterLength: afterText.length,
      changedUnits,
      books: [...bookUnits].map(([book, ids]) => ({ book, unitIds: [...ids] })),
      chapters: [...chapterUnits.values()].map((chapter) => ({
        book: chapter.book,
        chapter: chapter.chapter,
        occurrence: chapter.occurrence,
        kind: chapter.kind,
        refs: [...chapter.refs],
        unitIds: [...chapter.ids],
      })),
    },
  };
};
