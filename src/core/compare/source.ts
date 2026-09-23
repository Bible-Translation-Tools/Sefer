// source.ts
//
// `CompareSource`: one SIDE of a comparison, as a port.
//
// The rule this module exists to enforce is the one Will named: neither side
// of a compare is a hardcoded closure over the current project. Both sides
// implement the same four questions — what is your name, which books do you
// hold, what is this book's text, and may I write to you — so the compare
// policy below never learns whether it is looking at the open project, a
// folder somebody unzipped, a git checkpoint or a remote.
//
// Adding a third kind is therefore a NEW FILE beside `projectSource.ts` and
// `folderSource.ts`, and no change to `compare.ts`, `decisions.ts` or the
// screen. What a new source must supply is listed in
// documentation/architecture/review.md.
//
// Effects here carry `R = never` on purpose: a source captures whatever it
// needs (a Project, a FileSystem and a root) when it is CONSTRUCTED. The
// comparison itself then needs no context, which is what lets it run from a
// component, a command or a test with one `run`.

import { Data, Effect } from "effect";

import type { BookId, Receipt } from "../book/book";
import type { SourceStamp } from "../source/source";

/**
 * Well-known source kinds. It is a plain string union rather than an enum
 * because the set grows: `checkpoint`, `project`, `remote` are all coming, and
 * a kind is only ever used for an icon and a label.
 */
export type CompareSourceKind = "project" | "folder" | (string & {});

/**
 * One book's text from one side, with the stamp when the side has one.
 *
 * A folder has no stamp — its text is bytes on disk, not a revision of a live
 * Book — so freshness for a stampless side is judged by the text itself. The
 * project side always has one, and that is the side Apply writes to.
 */
export interface SourceText {
  readonly text: string;
  readonly stamp?: SourceStamp;
}

/**
 * Everything a comparison can refuse, in vocabulary a screen can print.
 *
 * `Absent` — the side does not hold that book. `Unreadable` — it does, and the
 * bytes did not decode. `Stale` — the target moved after the comparison was
 * taken, so its offsets and its text describe something else. `ReadOnly` — the
 * target cannot be written at all. `Unsupported` — the write is one the port
 * has no path for today (adding or removing a whole book). `Incomplete` — the
 * plan still has undecided hunks. `Refused` — the Book's own write path said
 * no, and the description carries its rule.
 */
export class CompareError extends Data.TaggedError("CompareError")<{
  readonly reason:
    | "Absent"
    | "Unreadable"
    | "Stale"
    | "ReadOnly"
    | "Unsupported"
    | "Incomplete"
    | "Refused";
  readonly description: string;
}> {}

/**
 * A side of a comparison.
 *
 * `books()` and `read()` are Effects because reading a folder is IO; the open
 * project answers both synchronously and wraps them, which costs nothing and
 * keeps one signature.
 *
 * `canApply` is the honest answer to "may this side be written", and it is
 * what the screen reads to decide whether Apply exists at all. A source that
 * says `true` must supply `apply`.
 */
export interface CompareSource {
  /** Stable within a session; used as the identity of a picked side. */
  readonly id: string;
  /** What the reader sees: "This project (small-nt)", "shared.zip". */
  readonly label: string;
  readonly kind: CompareSourceKind;
  /** Only a writable side may be the target of `applyPlan`. */
  readonly canApply: boolean;
  /** Every book this side holds, in the side's own canonical order. */
  books(): Effect.Effect<readonly BookId[], CompareError>;
  /** One book's text. Fails `Absent` for a book this side does not hold. */
  read(bookId: BookId): Effect.Effect<SourceText, CompareError>;
  /**
   * Replaces one book's text, as ONE edit — one Undo step for the reader.
   * Present only when `canApply`; `applyPlan` checks both.
   */
  apply?(bookId: BookId, text: string): Effect.Effect<Receipt, CompareError>;
}

/** The part of a source worth remembering in a result: no closures, no IO. */
export interface SourceRef {
  readonly id: string;
  readonly label: string;
  readonly kind: CompareSourceKind;
  readonly canApply: boolean;
}

export const sourceRef = (source: CompareSource): SourceRef => ({
  id: source.id,
  label: source.label,
  kind: source.kind,
  canApply: source.canApply,
});

const compareError = (reason: CompareError["reason"], description: string): CompareError =>
  new CompareError({ reason, description });

export const failCompare = (
  reason: CompareError["reason"],
  description: string,
): Effect.Effect<never, CompareError> => Effect.fail(compareError(reason, description));
