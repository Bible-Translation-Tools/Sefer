import type { BookId } from "@sefer/text/book";
import type { TocView } from "@sefer/text/location/locate";
import type { SourceStamp } from "@sefer/text/source";

import {
  booksByPattern,
  diagnosticMessage,
  diagnosticName,
  diagnosticSeverity,
  stampOf,
  type Analysis,
  type DiagnosticView,
  type EngineStamp,
  type Finding as CorpusFinding,
  type FindingMessage,
  type FindingQuery,
  type FindingsSnapshot,
  markBefore,
  type MarkBefore,
  type MaskMap,
  type Pattern,
  patternIdentity,
} from "../galley";
import { comparisonOf } from "./compare";
import { describeSous, render } from "./messages";
import {
  isEmpty,
  NO_SUPPRESSIONS,
  siteKeyOf,
  type SuppressionKeys,
  type Suppressions,
} from "./suppressions";

export type Severity = "error" | "warning" | "info";

export type Producer = "onion" | "sous" | "project";

export interface FixRef {
  readonly kind: "engine";
  readonly diagnosticIndex: number;
}

export interface Finding {
  readonly id: string;
  readonly bookId: BookId;
  readonly severity: Severity;
  readonly code: string;
  readonly producer: Producer;
  readonly message: string;
  readonly details?: string;
  readonly described?: FindingMessage;
  /** UTF-16 offsets into the text `stamp`/`engine` name. */
  readonly from: number;
  readonly to: number;
  readonly stamp: SourceStamp;
  readonly engine: EngineStamp;
  readonly fix?: FixRef;
  readonly expected?: number;
  readonly pattern?: number;
  readonly comparison?: readonly FindingQuery[];
  readonly suppression?: SuppressionKeys;
}

const identify = (
  producer: Producer,
  bookId: BookId,
  code: string,
  from: number,
  to: number,
): string => `${producer}:${bookId}:${code}:${from}-${to}`;

const rung = (severity: "error" | "warning" | "info" | "hint"): Severity =>
  severity === "hint" ? "info" : severity;

export const fromAnalysis = (
  bookId: BookId,
  analysis: Analysis,
  stamp: SourceStamp,
): readonly Finding[] =>
  fromDiagnostics({
    bookId,
    stamp,
    engine: stampOf(analysis),
    diagnostics: analysis.dish.diagnostics,
    text: analysis.text,
    usfmVersion: analysis.usfmVersion,
  });

const fromDiagnostics = (input: {
  readonly bookId: BookId;
  readonly stamp: SourceStamp;
  readonly engine: EngineStamp;
  readonly diagnostics: { readonly length: number; at(n: number): DiagnosticView | undefined };
  readonly text: string;
  readonly usfmVersion: string | null;
}): readonly Finding[] => {
  const { bookId, stamp, engine, diagnostics, text, usfmVersion } = input;
  const slice = (from: number, to: number): string => text.slice(from, to);
  const out: Finding[] = [];
  for (let index = 0; index < diagnostics.length; index += 1) {
    const view = diagnostics.at(index);
    if (view === undefined) continue;
    const severity = diagnosticSeverity(view, usfmVersion);
    if (severity === null) continue;
    const code = diagnosticName(view);
    const span = view.span();
    const fix: FixRef | undefined =
      view.fix() === null ? undefined : { kind: "engine", diagnosticIndex: index };
    out.push({
      id: identify("onion", bookId, code, span.from, span.to),
      bookId,
      severity: rung(severity),
      code,
      producer: "onion",
      message: diagnosticMessage(view, slice),
      from: span.from,
      to: span.to,
      stamp,
      engine,
      ...(fix === undefined ? {} : { fix }),
      ...(view.code().aux === "expectedNumber" ? { expected: view.aux() } : {}),
    });
  }
  return out;
};

const corpusSeverity = (finding: CorpusFinding): Severity => {
  switch (finding.kind) {
    case "Hygiene":
      return "error";
    case "Presence":
      return "warning";
    default:
      return "info";
  }
};

export interface PublishedBook {
  readonly bookId: BookId;
  readonly stamp: SourceStamp;
  readonly engine: EngineStamp;
  readonly text: string;
  readonly name: string;
  readonly mask?: () => MaskMap | undefined;
  readonly toc?: () => TocView;
}

const BEFORE_WINDOW = 32;

const markBeforeIn = (text: string, mask: MaskMap, at: number): MarkBefore | undefined => {
  let low = 0;
  let high = mask.rangeCount;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (mask.range(mid).sourceFrom < at) low = mid + 1;
    else high = mid;
  }
  let reading = "";
  for (let row = low - 1; row >= 0 && reading.length < BEFORE_WINDOW; row -= 1) {
    const range = mask.range(row);
    reading = text.slice(range.sourceFrom, Math.min(range.sourceTo, at)) + reading;
  }
  return markBefore(reading, reading.length);
};

const corpusCode = (finding: CorpusFinding, channel: string | undefined): string => {
  switch (finding.kind) {
    case "Hygiene":
      return `sous.hygiene.${finding.hygiene.class}`;
    case "Presence":
      return `sous.presence.${finding.presence.kind}`;
    case "SourceCopy":
      return "sous.source-copy";
    case "LengthProportionality":
      return "sous.length-proportionality";
    case "Convention":
      return `sous.convention.${channel ?? "unknown"}`;
  }
};

export interface CorpusReader {
  of(bookId: BookId): readonly Finding[];
  all(): readonly Finding[];
  suppressed(): readonly Finding[];
  totals(): { readonly errors: number; readonly warnings: number };
}

/**
 * The conversion of a publication's corpus findings, a book at a time.
 *
 * Converting every finding in every book on every publication — and formatting
 * each one's two sentences through IntlMessageFormat — was ~27 ms per
 * keystroke on a slow machine, for a list nothing showed: the badges want
 * counts, the editor wants its own book's squiggles, and only the Findings
 * panel wants the whole. So a book is converted when something asks for it,
 * the counts come from severities, and a finding's `message` and `details`
 * are formatted the first time they are read.
 */
export const corpusReader = (
  snapshot: FindingsSnapshot,
  resolveBook: (id: string) => PublishedBook | undefined,
  suppressions: Suppressions = NO_SUPPRESSIONS,
): CorpusReader => {
  const usable = snapshot.coordinateSpace === "utf16";
  const bookCount = snapshot.length;
  let shared:
    | {
        readonly patterns: ReturnType<FindingsSnapshot["patterns"]>;
        readonly patternBooks: ReturnType<typeof booksByPattern>;
        readonly bookName: (index: number) => string;
      }
    | undefined;
  const context = () => {
    if (shared !== undefined) return shared;
    shared = {
      patterns: snapshot.patterns(),
      patternBooks: booksByPattern(snapshot),
      bookName: (index: number): string => {
        const book = snapshot.book(index);
        if (book === undefined) return String(index + 1);
        return resolveBook(book.id)?.name ?? book.key;
      },
    };
    return shared;
  };
  const masks = new Map<string, MaskMap | undefined>();
  const before = (
    resolved: PublishedBook,
    finding: CorpusFinding,
    pattern: Pattern | undefined,
  ): { readonly before?: MarkBefore } => {
    if (pattern?.key.kind !== "Casing" || resolved.mask === undefined) return {};
    if (!masks.has(resolved.bookId)) {
      const mask = resolved.mask();
      masks.set(resolved.bookId, mask?.sourceLen === resolved.text.length ? mask : undefined);
    }
    const mask = masks.get(resolved.bookId);
    const mark = mask === undefined ? undefined : markBeforeIn(resolved.text, mask, finding.from);
    return mark === undefined ? {} : { before: mark };
  };

  let indexes:
    | Map<BookId, { readonly index: number; readonly resolved: PublishedBook }>
    | undefined;
  const indexOf = () => {
    if (indexes !== undefined) return indexes;
    indexes = new Map();
    if (!usable) return indexes;
    for (let index = 0; index < snapshot.length; index += 1) {
      const book = snapshot.book(index);
      if (book === undefined) continue;
      const resolved = resolveBook(book.id);
      if (resolved !== undefined) indexes.set(resolved.bookId, { index, resolved });
    }
    return indexes;
  };

  const filtering = !isEmpty(suppressions);
  const bookKey = (index: number): string => snapshot.book(index)?.key ?? String(index);
  const isSuppressed = (keys: SuppressionKeys | undefined): boolean =>
    keys !== undefined &&
    (suppressions.here.has(keys.here) ||
      (keys.everywhere !== undefined && suppressions.everywhere.has(keys.everywhere)));

  const converted = new Map<
    BookId,
    { readonly shown: readonly Finding[]; readonly hidden: readonly Finding[] }
  >();
  const NONE = { shown: [], hidden: [] };
  const convert = (
    bookId: BookId,
  ): { readonly shown: readonly Finding[]; readonly hidden: readonly Finding[] } => {
    const held = converted.get(bookId);
    if (held !== undefined) return held;
    const at = indexOf().get(bookId);
    const book = at === undefined ? undefined : snapshot.book(at.index);
    if (at === undefined || book === undefined) {
      converted.set(bookId, NONE);
      return NONE;
    }
    const { patterns, patternBooks, bookName } = context();
    const resolved = at.resolved;
    const out: Finding[] = [];
    for (let row = 0; row < book.count; row += 1) {
      const finding = book.at(row);
      const pattern =
        finding.kind === "Convention" ? patterns[finding.convention.pattern] : undefined;
      const code = corpusCode(finding, pattern?.channel);
      const described = describeSous(finding, pattern, {
        siteText: resolved.text.slice(finding.from, finding.to),
        bookCount,
        bookName,
        patternBooks,
        snapshot,
        ...before(resolved, finding, pattern),
      });
      const comparison = comparisonOf(described);
      let headline: string | undefined;
      let more: string | undefined;
      let keys: SuppressionKeys | null | undefined;
      const suppression = (): SuppressionKeys | undefined => {
        if (keys !== undefined) return keys ?? undefined;
        const toc = resolved.toc?.();
        const here =
          toc === undefined
            ? undefined
            : siteKeyOf(resolved.bookId, resolved.text, toc, finding.from, finding.to);
        keys =
          here === undefined
            ? null
            : {
                here,
                ...(pattern === undefined
                  ? {}
                  : { everywhere: patternIdentity(pattern, { bookKey }) }),
              };
        return keys ?? undefined;
      };
      out.push({
        id: identify("sous", resolved.bookId, code, finding.from, finding.to),
        bookId: resolved.bookId,
        severity: corpusSeverity(finding),
        code,
        producer: "sous",
        get message() {
          headline ??= render(described, "headline");
          return headline;
        },
        get details() {
          more ??= render(described, "details");
          return more;
        },
        described,
        from: finding.from,
        to: finding.to,
        stamp: resolved.stamp,
        engine: resolved.engine,
        ...(finding.kind === "Convention" ? { pattern: finding.convention.pattern } : {}),
        ...(comparison === undefined ? {} : { comparison }),
        get suppression() {
          return suppression();
        },
      });
    }
    const split = filtering
      ? {
          shown: out.filter((finding) => !isSuppressed(finding.suppression)),
          hidden: out.filter((finding) => isSuppressed(finding.suppression)),
        }
      : { shown: out, hidden: [] };
    converted.set(bookId, split);
    return split;
  };
  const of = (bookId: BookId): readonly Finding[] => convert(bookId).shown;

  let everything: readonly Finding[] | undefined;
  let hidden: readonly Finding[] | undefined;
  let counted: { readonly errors: number; readonly warnings: number } | undefined;
  return {
    of,
    all: () => {
      everything ??= [...indexOf().keys()].flatMap(of);
      return everything;
    },
    suppressed: () => {
      if (!filtering) return [];
      hidden ??= [...indexOf().keys()].flatMap((bookId) => convert(bookId).hidden);
      return hidden;
    },
    totals: () => {
      if (counted !== undefined) return counted;
      let errors = 0;
      let warnings = 0;
      if (filtering) {
        for (const bookId of indexOf().keys())
          for (const finding of of(bookId))
            if (finding.severity === "error") errors += 1;
            else if (finding.severity === "warning") warnings += 1;
        counted = { errors, warnings };
        return counted;
      }
      for (const { index } of indexOf().values()) {
        const book = snapshot.book(index);
        if (book === undefined) continue;
        for (let row = 0; row < book.count; row += 1) {
          const severity = corpusSeverity(book.at(row));
          if (severity === "error") errors += 1;
          else if (severity === "warning") warnings += 1;
        }
      }
      counted = { errors, warnings };
      return counted;
    },
  };
};

export const stale = (finding: Finding, book: { source: () => { stamp: SourceStamp } }): boolean =>
  book.source().stamp.revision !== finding.stamp.revision;
