// finding.ts
//
// The ONE shape (seams §3.7; editor-and-save §2 "One shape"; vision §11.2).
// Two producers speak completely different dialects — Onion emits catalogued
// USFM diagnostics with a severity ladder and offered repairs, Sous emits
// statistical corpus findings with digests and no severity at all — and every
// consumer above them (the panel, navigation, the counts in the census, the
// fix previews) wants one record. This file is the only place either dialect
// is translated, so a producer's vocabulary never leaks into a reader.
//
// Three rules the whole file exists to hold:
//
//  - Positions are ENGINE positions in the text the stamp names. Nothing here
//    re-derives or shifts an offset. If the stamp moved, the finding is stale
//    and is recomputed, not adjusted (`stale`).
//  - Every finding carries both stamps: the Book's `SourceStamp` (revision
//    within one Book's lifetime) and the engine's `EngineStamp` (hash + length,
//    which survives across lifetimes and across products).
//  - Identity is SEMANTIC. A row index into a parse or a publication is not a
//    durable id — the next publication renumbers everything — so `id` is built
//    from producer, book, code and span. Two rows with the same code at the
//    same span are one finding, which is what a panel wants anyway.
//
// `message` is panel text: it quotes the document. It must never reach
// Observability, which records counts and codes only.

import type { BookId } from "../book/book";
import {
  CODES,
  diagnosticMessage,
  diagnosticName,
  diagnosticSeverity,
  stampOf,
  type Analysis,
  type DiagnosticView,
  type EngineStamp,
  type Finding as CorpusFinding,
  type FindingsSnapshot,
} from "../galley";
import type { SourceStamp } from "../source/source";

/**
 * The three rungs a reader is shown. Onion's `hint` folds into `info` and its
 * `form`/absent severities are dropped entirely — see `fromAnalysis`.
 */
export type Severity = "error" | "warning" | "info";

/**
 * Which half of the engine said so, or Sefer itself. `project` is reserved for
 * findings Sefer computes across books without the engine (a missing book, a
 * duplicate `\id`); nothing emits it yet.
 */
export type Producer = "onion" | "sous" | "project";

/**
 * A pointer back into the analysis the finding came from, NOT the edits.
 * Resolving it costs a walk of the fix section, so the preview is computed on
 * demand by `src/core/fixes`; a panel showing four hundred findings pays for
 * none of them. The index is only meaningful for the exact analysis whose
 * `EngineStamp` this finding carries.
 */
export interface FixRef {
  readonly kind: "engine";
  readonly diagnosticIndex: number;
}

export interface Finding {
  /** `producer:bookId:code:from-to`. Semantic, not a row number. */
  readonly id: string;
  readonly bookId: BookId;
  readonly severity: Severity;
  /** The producer's stable code: a catalogue name, or `sous.<lane>`. */
  readonly code: string;
  readonly producer: Producer;
  /** Panel text. Quotes the document; never goes to telemetry. */
  readonly message: string;
  /** UTF-16 offsets into the text `stamp`/`engine` name. */
  readonly from: number;
  readonly to: number;
  readonly stamp: SourceStamp;
  readonly engine: EngineStamp;
  readonly fix?: FixRef;
  /**
   * Row in the publication's pattern table, for a Sous `Convention` finding
   * only. It is NOT a durable identity — the next publication renumbers the
   * table exactly as it renumbers findings — so it is only meaningful against
   * the snapshot this finding was read from, which is the one ProjectAnalysis
   * still holds. It is carried because the character inventory
   * (`src/core/findings/inventory.ts`) is the pattern table's reader and the
   * panel wants to say "the other sites of THIS pattern"; re-deriving it would
   * mean re-walking the snapshot for every row.
   */
  readonly pattern?: number;
}

const identify = (
  producer: Producer,
  bookId: BookId,
  code: string,
  from: number,
  to: number,
): string => `${producer}:${bookId}:${code}:${from}-${to}`;

/**
 * `hint` is a rung the one shape does not carry. It becomes `info` rather than
 * being dropped: the engine still wants the reader to see the site, and a
 * panel that filters by code can hide it without the shape growing a rung.
 */
const rung = (severity: "error" | "warning" | "info" | "hint"): Severity =>
  severity === "hint" ? "info" : severity;

/**
 * Onion diagnostics → findings, for one book at one revision.
 *
 * `stamp` is the Book's stamp for the text `analysis` describes — the caller
 * holds both, and pairing them here is cheaper than making this function
 * re-read the Book. It is a caller bug to pass a stamp from a different text;
 * `describesExactly` is the door that proves it.
 *
 * A diagnostic whose severity is `null` at this document's declared `\usfm`
 * version is DROPPED, not downgraded: the catalogue is saying the code has
 * nothing to report at that version (and `diagnosticSeverity` already folds
 * the `form` category away, since a formatting observation is the formatter's
 * business, not a reader's). Suppressing it here rather than in the panel
 * keeps the census counts honest.
 */
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

/**
 * The same, over a LINT report rather than a whole parse.
 *
 * A lint buffer is a parse buffer with only the diagnostics section plated —
 * no tree, no tokens, no TOC — and it costs about a tenth of a parse. The four
 * things a finding needs from a parse are all still in it: the diagnostics
 * themselves, the declared `\usfm` version that gates their severity, and the
 * source hash and length that stamp them. The text is the caller's, because
 * the caller is who holds the Book.
 *
 * This is what lets a project open with every badge already right, having
 * parsed nothing.
 */
const fromDiagnostics = (input: {
  readonly bookId: BookId;
  readonly stamp: SourceStamp;
  readonly engine: EngineStamp;
  /**
   * Indexable rather than iterable, and tolerant of a hole, so that BOTH
   * sources fit without either copying: the parse buffer's `Diagnostics` is a
   * cursor whose `at` always answers, and a lint report's is a plain array
   * whose `at` is `Array.prototype.at`.
   */
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
    // The only way to know whether THIS site was offered a repair is to read
    // the fix section: `fixLabel` is a catalogue-level statement about the
    // code, not about the occurrence.
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
    });
  }
  return out;
};

/**
 * Sous carries no severity ladder — it reports what it measured and leaves the
 * judgement to the consumer — so these three lines are Sefer's presentation
 * policy, stated once. Hygiene is an `error` because a C0 control, a
 * replacement character or a merge conflict marker inside scripture text is a
 * defect in the file rather than an opinion about the translation. Presence is
 * a `warning`: a verse coverage gap is usually real and occasionally
 * deliberate. Everything else is statistical and advisory.
 */
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

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** `+` marks a lane the engine clamped, so the number reads as "at least". */
const atLeast = (n: number, saturated: boolean): string => `${n}${saturated ? "+" : ""}`;

/**
 * A glyph the message can quote. Zero means the channel judges no scalar (the
 * word lanes carry a hash instead), and the pooled-digit sentinel is above the
 * Unicode range, so one bounds check rejects both without a constant.
 */
const glyphText = (glyph: number): string | null =>
  glyph > 0 && glyph <= 0x10ffff ? String.fromCodePoint(glyph) : null;

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

const corpusMessage = (
  finding: CorpusFinding,
  pattern:
    | { readonly channel: string; readonly glyph: number; readonly shareBp: number }
    | undefined,
): string => {
  switch (finding.kind) {
    case "Hygiene": {
      const { class: hygiene, run, saturated } = finding.hygiene;
      return `${atLeast(run, saturated)} ${plural(run, "character", "characters")} of ${hygiene}`;
    }
    case "Presence": {
      const { kind, keys, saturated } = finding.presence;
      const verses = `${atLeast(keys, saturated)} ${plural(keys, "verse", "verses")}`;
      if (kind === "Missing") return `${verses} the source has are missing here`;
      if (kind === "Extra") return `${verses} here are not in the source`;
      return `${verses} here are empty`;
    }
    case "SourceCopy": {
      const { run, eligible, saturated } = finding.sourceCopy;
      return `${atLeast(run, saturated)} consecutive ${plural(run, "word", "words")} also in the paired source verse, of ${eligible} eligible`;
    }
    case "LengthProportionality": {
      const { bookScope, projectScope } = finding.digest;
      const book = bookScope === null ? "n/a" : bookScope.toFixed(2);
      const project = projectScope === null ? "n/a" : projectScope.toFixed(2);
      return `verse length is out of proportion with the source (book ${book}, project ${project})`;
    }
    case "Convention": {
      const reasons = finding.convention.reasons;
      if (pattern === undefined) return `unconventional here (${reasons.join(", ")})`;
      const glyph = glyphText(pattern.glyph);
      const what = glyph === null ? "this word" : `“${glyph}”`;
      // The channel is usually also one of the reasons; naming it twice reads
      // as a bug. The rarity lane convicts on scarcity, so its share is zero
      // by construction and "0.0% of sites" would too.
      const lanes = [pattern.channel, ...reasons.filter((reason) => reason !== pattern.channel)];
      const share = pattern.shareBp > 0 ? `, ${(pattern.shareBp / 100).toFixed(2)}% of sites` : "";
      return `${what} is used unconventionally for this project (${lanes.join(", ")}${share})`;
    }
  }
};

/**
 * Sous corpus findings → findings, for a whole publication.
 *
 * `resolveBook` maps the host id a book was published under back to the stamps
 * of the text we published; a book the caller no longer holds (closed between
 * the `publish` and this call) is SKIPPED rather than stamped with a guess,
 * because a finding without a provable stamp cannot be checked for freshness
 * and so cannot be navigated to or fixed.
 *
 * A publication whose coordinates are UTF-8 byte offsets is dropped whole: the
 * offsets in the one shape are UTF-16 code units into canonical LF text, and
 * silently mixing spaces is exactly the class of bug the stamps exist to
 * prevent. The engine flags UTF-16 when the books were published that way,
 * which is what `ProjectAnalysis` does.
 */
export const fromSnapshot = (
  snapshot: FindingsSnapshot,
  resolveBook: (
    id: string,
  ) =>
    | { readonly bookId: BookId; readonly stamp: SourceStamp; readonly engine: EngineStamp }
    | undefined,
): readonly Finding[] => {
  if (snapshot.coordinateSpace !== "utf16") return [];
  const patterns = snapshot.patterns();
  const out: Finding[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const book = snapshot.book(index);
    if (book === undefined) continue;
    const resolved = resolveBook(book.id);
    if (resolved === undefined) continue;
    for (let row = 0; row < book.count; row += 1) {
      const finding = book.at(row);
      const pattern =
        finding.kind === "Convention" ? patterns[finding.convention.pattern] : undefined;
      const code = corpusCode(finding, pattern?.channel);
      out.push({
        id: identify("sous", resolved.bookId, code, finding.from, finding.to),
        bookId: resolved.bookId,
        severity: corpusSeverity(finding),
        code,
        producer: "sous",
        message: corpusMessage(finding, pattern),
        from: finding.from,
        to: finding.to,
        stamp: resolved.stamp,
        engine: resolved.engine,
        ...(finding.kind === "Convention" ? { pattern: finding.convention.pattern } : {}),
      });
    }
  }
  return out;
};

/**
 * Has the book moved on since this finding was computed?
 *
 * The Book's revision is the authority inside one Book's lifetime, and that is
 * the whole scope of a panel finding: a stale finding is recomputed, never
 * shifted. Across lifetimes (a release, a reload, a product handed between
 * modules) the engine hash on `finding.engine` is the check instead, which is
 * what `src/core/fixes` uses before it will touch text.
 */
export const stale = (finding: Finding, book: { source: () => { stamp: SourceStamp } }): boolean =>
  book.source().stamp.revision !== finding.stamp.revision;

/**
 * The severity an Onion code carries with NO declared `\usfm` version — the
 * catalogue's base rung, for a filter list or a legend. It is deliberately not
 * what a finding reports: several codes escalate once a document declares a
 * version, so the per-finding severity from `fromAnalysis` is authoritative.
 *
 * `null` for a code that says nothing (its severity is absent, or it is a
 * `form` observation), and for a name that is not in the catalogue at all.
 */
const severityOf = (code: string): Severity | null => {
  const row = CODES.find((entry) => entry.name === code);
  if (row === undefined) return null;
  switch (row.severity) {
    case "error":
    case "warning":
    case "info":
      return row.severity;
    case "hint":
      return "info";
    default:
      return null;
  }
};
