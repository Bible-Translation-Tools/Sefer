// fixes.ts
//
// Slice 15: applying the engine's OWN repairs, and nothing else.
//
// Sefer writes no USFM transformations. Onion attaches the edits to the
// diagnostic that found the problem, and since scripture-kitchen v0.1.0 it
// also hands over a whole-book format transaction; this module's job is to
// carry both from the engine to `book.apply` without letting a stale one
// through. There is deliberately no second JS formatter here and no generic
// command language.
//
// The freshness discipline is the reason the module exists. A `FixRef` is a
// row index into one parse, and its edits are offsets into one text. Applying
// them to a different text would corrupt the document silently — the classic
// stale-range bug, and the worst one available here, because the result is
// plausible-looking scripture. So every door checks twice:
//
//   preview  the analysis must describe the Book's text EXACTLY
//            (`describesExactly`) and must be the analysis the finding came
//            from (`engine` hash + length).
//   apply    the Book's revision must still be the one the preview stamped.
//
// Edits go in through `book.apply(changes, 'fix', trustedBy('fix'))`: a fix is
// a trusted origin, so it bypasses the keyboard guards the way a fix-it does,
// but it still goes through the ONE write path — Undo, Save, Recovery and the
// findings panel all learn about it because they subscribe to the Book.

import { Data, Result } from "effect";

import { Refusal, trustedBy, type Book, type Receipt } from "../book/book";
import type { Finding } from "../findings/finding";
import {
  describesExactly,
  diagnosticFixLabel,
  diagnosticName,
  type Analysis,
  type EngineStamp,
  type GalleyService,
  type OverlayOptions,
} from "../galley";
import type { Change, SourceStamp } from "../source/source";

/**
 * One offered repair, resolved into Sefer's own vocabulary and stamped with
 * the text it was computed against. Hold it across a confirmation dialog if
 * you like — `apply` refuses it once the Book has moved on.
 */
export interface FixPreview {
  readonly finding: Finding;
  /** In before-text coordinates, as `book.apply` expects. Never overlapping. */
  readonly changes: readonly Change[];
  /** The catalogue's label for the repair, for the button. */
  readonly label: string;
  readonly stamp: SourceStamp;
  readonly engine: EngineStamp;
}

/**
 * `NoFixOffered` — the diagnostic has no repair at this site. `NotEngineFix` —
 * the finding came from Sous, which measures and does not edit. `Stale` — the
 * analysis or the Book has moved since the finding was computed, so the offsets
 * name text that no longer exists.
 */
export class NoFix extends Data.TaggedError("NoFix")<{
  readonly reason: "NoFixOffered" | "NotEngineFix" | "Stale";
  readonly description: string;
}> {}

/**
 * The artifact in hand does not expose the operation. Loud on purpose: a silent
 * no-op would read to the user as "the document was already formatted", which
 * is a different sentence and one this module CAN say honestly (`FormatPreview.
 * empty`). Since scripture-kitchen v0.1.0 this is only reachable from an
 * artifact that is not the vendored build.
 */
export class Unsupported extends Data.TaggedError("Unsupported")<{
  readonly operation: string;
  readonly description: string;
}> {}

const noFix = (reason: NoFix["reason"], description: string): NoFix =>
  new NoFix({ reason, description });

/**
 * Resolve a finding's `FixRef` into the edits the engine offered.
 *
 * `analysis` must be the analysis the finding was built from — the caller
 * holds it (the editor's current one, or `ProjectAnalysis.analysis(bookId)`)
 * and this refuses anything else. Two separate checks, because they catch
 * different mistakes: `describesExactly` proves the analysis matches the text
 * we are about to edit, and the engine stamp proves the diagnostic INDEX is
 * still the one the finding recorded. A same-length edit passes the first
 * check on length alone, which is why the hash is also read.
 *
 * The code name is compared as well. It is nearly free and it is the one check
 * that would survive a hash collision or a caller pairing a finding with the
 * right text but the wrong parse.
 */
export const preview = (
  finding: Finding,
  book: Book,
  analysis: Analysis,
): Result.Result<FixPreview, NoFix> => {
  if (finding.fix === undefined)
    return Result.fail(noFix("NoFixOffered", `${finding.code} offers no repair here`));
  if (finding.producer !== "onion")
    return Result.fail(
      noFix("NotEngineFix", `${finding.producer} findings carry no edits, only measurements`),
    );

  const source = book.source();
  if (!describesExactly(analysis, source.text))
    return Result.fail(noFix("Stale", `the analysis does not describe ${book.id}'s current text`));
  if (
    finding.engine.docLen !== analysis.docLen ||
    finding.engine.sourceHash !== analysis.sourceHash
  )
    return Result.fail(noFix("Stale", `${finding.id} was computed from a different parse`));

  const { diagnostics } = analysis.dish;
  const index = finding.fix.diagnosticIndex;
  if (index < 0 || index >= diagnostics.length)
    return Result.fail(noFix("Stale", `${finding.id} names diagnostic ${index}, which is gone`));
  const view = diagnostics.at(index);
  if (diagnosticName(view) !== finding.code)
    return Result.fail(
      noFix("Stale", `diagnostic ${index} is now ${diagnosticName(view)}, not ${finding.code}`),
    );

  const edits = view.fix();
  if (edits === null || edits.length === 0)
    return Result.fail(noFix("NoFixOffered", `${finding.code} offers no repair here`));

  return Result.succeed({
    finding,
    changes: edits.map((edit) => ({ from: edit.from, to: edit.to, insert: edit.insert })),
    label: diagnosticFixLabel(view) ?? finding.code,
    stamp: source.stamp,
    engine: { docLen: analysis.docLen, sourceHash: analysis.sourceHash },
  });
};

/**
 * The refusal a stale preview produces — the same `Refusal` shape `book.apply`
 * returns, so a caller handles one failure type from both doors. `rule` names
 * this module so a trace says which door closed.
 */
const staleRefusal = (book: Book, previewed: SourceStamp, current: SourceStamp): Refusal =>
  new Refusal({
    rule: "fixes.apply",
    reason: "Stale",
    description: `${book.id} moved from r${previewed.revision} to r${current.revision} since the preview`,
  });

/**
 * Apply one preview. Refuses when the Book's revision has moved since the
 * preview was computed: the offsets would land in text nobody looked at.
 *
 * Everything else — whether the markup rules accept the edit at all — is the
 * Book's own business. An editor-backed Book runs its phases here, and a fix
 * that would break structure is refused by the rules rather than by a check in
 * this module.
 */
export const apply = (fix: FixPreview, book: Book): Result.Result<Receipt, Refusal> => {
  const current = book.source().stamp;
  if (current.revision !== fix.stamp.revision)
    return Result.fail(staleRefusal(book, fix.stamp, current));
  return book.apply(fix.changes, "fix", trustedBy("fix"));
};

/**
 * Apply several previews for ONE book in a single `apply`, so the whole set is
 * one Undo step and subscribers see one receipt (seams §3.8 `applyAll`).
 *
 * Every preview must belong to `book` and to the revision it currently holds;
 * one stale member refuses the whole set, because a partially applied batch is
 * the failure mode slice 15 names first — "invalid or partially applicable
 * edits fail with source unchanged". Overlapping edits are refused by the
 * Book's own range checks, not filtered here: silently dropping one of two
 * overlapping repairs would produce a document neither fix intended.
 */
export const applyAll = (
  previews: readonly FixPreview[],
  book: Book,
): Result.Result<Receipt, Refusal> => {
  const current = book.source().stamp;
  const changes: Change[] = [];
  for (const one of previews) {
    if (one.finding.bookId !== book.id)
      return Result.fail(
        new Refusal({
          rule: "fixes.applyAll",
          reason: "WrongBook",
          description: `a fix for ${one.finding.bookId} was offered to ${book.id}`,
        }),
      );
    if (one.stamp.revision !== current.revision)
      return Result.fail(staleRefusal(book, one.stamp, current));
    changes.push(...one.changes);
  }
  if (changes.length === 0)
    return Result.fail(
      new Refusal({
        rule: "fixes.applyAll",
        reason: "NothingToApply",
        description: `no fix edits were offered for ${book.id}`,
      }),
    );
  return book.apply(changes, "fix", trustedBy("fix"));
};

/**
 * A whole book's normalisation, stamped with the text it was computed against.
 *
 * Not a `FixPreview`: there is no finding behind it. Format is not a repair
 * offered at a site, it is one transaction over the document, and giving it a
 * fabricated `Finding` so it could share a type would be a lie in the shape of
 * a convenience. What it DOES share is the vocabulary a caller needs — the
 * changes, and the stamp that says which text they are offsets into.
 */
export interface FormatPreview {
  readonly bookId: string;
  /** In before-text coordinates, ascending and non-overlapping, UTF-16. */
  readonly changes: readonly Change[];
  readonly stamp: SourceStamp;
  /** The document is already formatted. `changes` is empty; say so, do not apply. */
  readonly empty: boolean;
}

/**
 * Whole-book normalisation as one preview and one Undo unit.
 *
 * ONE call to the engine and no second opinion. `onion::format` merges two edit
 * sets — the lint rows flagged `formatter`, and the FORM channel that lint
 * never reaches — with a first-writer-wins collision rule, and a TypeScript
 * whitespace pass would reproduce the first half and silently diverge on the
 * second. "The two formatters disagree about scripture" is the worst bug
 * available here, so there is no TypeScript formatter and never will be.
 *
 * The edits come back as a transaction, which is the whole reason Sefer asks
 * for `formatEdits` rather than `format`: `apply` puts them through ONE
 * `book.apply(…, 'format')`, so a formatted book is one revision, one receipt
 * and one Undo step. A replaced document would undo correctly too and be
 * unreadable in a diff.
 *
 * `opts` is not offered to callers here: the engine's own defaults are what
 * "Format" means, and a dozen switches is a settings surface nobody has
 * designed. The refusal is kept for an artifact that is not the vendored build
 * — see `DIFF_DOOR`.
 */
export const formatBook = (
  galley: GalleyService,
  book: Book,
): Result.Result<FormatPreview, Unsupported> => {
  const source = book.source();
  const edits = galley.formatEdits(source.text);
  if (Result.isFailure(edits))
    return Result.fail(
      new Unsupported({ operation: "formatBook", description: edits.failure.description }),
    );
  return Result.succeed({
    bookId: book.id,
    changes: edits.success.edits.map((edit) => ({
      from: edit.from,
      to: edit.to,
      insert: edit.insert,
    })),
    stamp: source.stamp,
    empty: edits.success.empty,
  });
};

/**
 * MATCH FORMATTING: the source's paragraphing, carried onto the target.
 *
 * Same shape as `formatBook` and deliberately so — the engine's overlay door
 * answers the same `FormatEdit` transaction `formatEdits` does, so this is one
 * preview, one `book.apply`, one Undo step, and `applyOverlay` below is
 * `applyFormat` with a different origin. Sefer decides nothing about where a
 * paragraph goes; `galley/src/overlay.md` does.
 *
 * Both sides are registered under SCRATCH ids rather than the book's own. The
 * target is already resident under `book.id` for proofreading, and removing
 * that registration on the way out — which the `finally` below must do, or an
 * overlay leaks a whole book into the engine every time it is run — would take
 * the project's own analysis with it. The source needs `keepText`: a reference
 * registered without it kept verse lengths only, and an overlay reads blocks.
 *
 * The door THROWS rather than answering a `Result` (it is probed off the wasm
 * module by name), so the catch is the real failure path for an artifact that
 * predates the overlay doors — not defensive noise.
 */
const OVERLAY_TARGET = "sefer.overlay.target";
const OVERLAY_SOURCE = "sefer.overlay.source";

export const overlayBook = (
  galley: GalleyService,
  book: Book,
  sourceText: string,
  /**
   * How much of the book to overlay — `{ chapter }` or `{ sid }`, or the whole
   * book when absent. An overlay inserts inside-verse blocks EMPTY on purpose,
   * so the reader decides how many of those they want to fill in one sitting.
   */
  opts?: OverlayOptions,
): Result.Result<FormatPreview, Unsupported> => {
  const source = book.source();
  try {
    galley.update(OVERLAY_TARGET, source.text);
    galley.updateReference(OVERLAY_SOURCE, sourceText, true);
    const overlaid = galley.overlay(OVERLAY_TARGET, OVERLAY_SOURCE);
    return Result.succeed({
      bookId: book.id,
      changes: overlaid.edits.map((edit) => ({
        from: edit.from,
        to: edit.to,
        insert: edit.insert,
      })),
      stamp: source.stamp,
      empty: overlaid.edits.length === 0,
    });
  } catch (error) {
    return Result.fail(
      new Unsupported({
        operation: "overlayBook",
        description: error instanceof Error ? error.message : String(error),
      }),
    );
  } finally {
    galley.remove(OVERLAY_TARGET);
    galley.remove(OVERLAY_SOURCE);
  }
};

/**
 * Apply an overlay preview. `applyFormat`'s twin, and the difference is the
 * ORIGIN: a receipt that said "format" would make match formatting invisible
 * in the history, the save status and the trace, which are the three places
 * somebody looks when they want to know what changed their paragraphing.
 */
export const applyOverlay = (
  preview: FormatPreview,
  book: Book,
): Result.Result<Receipt, Refusal> => {
  const current = book.source().stamp;
  if (current.revision !== preview.stamp.revision)
    return Result.fail(staleRefusal(book, preview.stamp, current));
  return book.apply(preview.changes, "overlay", trustedBy("overlay"));
};

/**
 * Apply a format preview. Refuses when the Book moved since it was computed,
 * exactly as a fix preview does and for exactly the same reason: the offsets
 * would land in text nobody looked at.
 *
 * Trusted, like a fix — the edits are the engine's own and they rewrite markup
 * the keyboard guards would refuse — and still through the one write path, so
 * Undo, Save, Recovery and the findings panel all learn about it.
 */
export const applyFormat = (
  preview: FormatPreview,
  book: Book,
): Result.Result<Receipt, Refusal> => {
  const current = book.source().stamp;
  if (current.revision !== preview.stamp.revision)
    return Result.fail(staleRefusal(book, preview.stamp, current));
  return book.apply(preview.changes, "format", trustedBy("format"));
};
