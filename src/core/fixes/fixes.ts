// fixes.ts
//
// Slice 15: applying the engine's OWN repairs, and nothing else.
//
// Sefer writes no USFM transformations. Onion attaches the edits to the
// diagnostic that found the problem; this module's whole job is to carry them
// from the parse to `book.apply` without letting a stale one through. There is
// deliberately no second JS formatter here and no generic command language —
// when the pinned engine cannot do something (whole-book formatting today),
// this module fails with a typed error naming what the engine would need,
// rather than reimplementing it.
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
 * The pinned engine does not expose the operation. Loud on purpose: a silent
 * no-op would read to the user as "the document was already formatted".
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
 * Whole-book normalisation as one preview and one Undo unit (slice 15
 * increment 2).
 *
 * NOT AVAILABLE. The pinned artifact exposes no stateless Onion doors: there
 * is no `format` and no `formatEdits` on the handle, so there is nothing to
 * turn into a `FixPreview` — see `documentation/architecture/galley.md`, "What
 * the handle cannot do yet". Reimplementing the formatter in TypeScript is
 * explicitly out of scope (slice 15: "avoid implementing a second JS
 * formatter"), so this fails loudly instead.
 *
 * TODO(seam): needs `formatEdits(text) -> FixEdit[]` (or a `format(text)`
 * whose result Sefer diffs) on the wasm surface. The ask is recorded at
 * /Users/willkelly/Documents/Work/Code/usfm_onion_2/galley/src/wasm.md; when it
 * lands, this becomes a `Galley.formatEdits` call plus the same stamp checks
 * `preview` makes, and `apply` already handles the rest (origin `'format'`).
 */
export const formatBook = (book: Book): Result.Result<FixPreview, Unsupported> =>
  Result.fail(
    new Unsupported({
      operation: "formatBook",
      description: `the pinned engine exposes no formatEdits, so ${book.id} cannot be formatted`,
    }),
  );
