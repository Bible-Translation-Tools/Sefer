import { Refusal, trustedBy, type Book, type Receipt } from "@sefer/text/book";
import type { Change, SourceStamp } from "@sefer/text/source";
import { Data, Result } from "effect";

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

export interface FixPreview {
  readonly finding: Finding;
  /** In before-text coordinates, as `book.apply` expects. Never overlapping. */
  readonly changes: readonly Change[];
  readonly label: string;
  readonly stamp: SourceStamp;
  readonly engine: EngineStamp;
}

class NoFix extends Data.TaggedError("NoFix")<{
  readonly reason: "NoFixOffered" | "NotEngineFix" | "Stale";
  readonly description: string;
}> {}

class Unsupported extends Data.TaggedError("Unsupported")<{
  readonly operation: string;
  readonly description: string;
}> {}

const noFix = (reason: NoFix["reason"], description: string): NoFix =>
  new NoFix({ reason, description });

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

const staleRefusal = (book: Book, previewed: SourceStamp, current: SourceStamp): Refusal =>
  new Refusal({
    rule: "fixes.apply",
    reason: "Stale",
    description: `${book.id} moved from r${previewed.revision} to r${current.revision} since the preview`,
  });

export const applyFix = (fix: FixPreview, book: Book): Result.Result<Receipt, Refusal> => {
  const current = book.source().stamp;
  if (current.revision !== fix.stamp.revision)
    return Result.fail(staleRefusal(book, fix.stamp, current));
  return book.apply(fix.changes, "fix", trustedBy("fix"));
};

export interface FormatPreview {
  readonly bookId: string;
  /** In before-text coordinates, ascending and non-overlapping, UTF-16. */
  readonly changes: readonly Change[];
  readonly stamp: SourceStamp;
  readonly empty: boolean;
}

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

const OVERLAY_TARGET = "sefer.overlay.target";
const OVERLAY_SOURCE = "sefer.overlay.source";

export const overlayBook = (
  galley: GalleyService,
  book: Book,
  sourceText: string,
  opts?: OverlayOptions,
): Result.Result<FormatPreview, Unsupported> => {
  const source = book.source();
  try {
    galley.update(OVERLAY_TARGET, source.text);
    galley.updateReference(OVERLAY_SOURCE, sourceText, true);
    const overlaid = galley.overlay(OVERLAY_TARGET, OVERLAY_SOURCE, opts);
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

const applyPreview = (
  preview: FormatPreview,
  book: Book,
  origin: "overlay" | "format",
): Result.Result<Receipt, Refusal> => {
  const current = book.source().stamp;
  if (current.revision !== preview.stamp.revision)
    return Result.fail(staleRefusal(book, preview.stamp, current));
  return book.apply(preview.changes, origin, trustedBy(origin));
};

export const applyOverlay = (preview: FormatPreview, book: Book): Result.Result<Receipt, Refusal> =>
  applyPreview(preview, book, "overlay");

export const applyFormat = (preview: FormatPreview, book: Book): Result.Result<Receipt, Refusal> =>
  applyPreview(preview, book, "format");
