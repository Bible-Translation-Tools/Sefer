import type { BookId, Receipt } from "@sefer/text/book";
import type { SourceStamp } from "@sefer/text/source";
import { Data, Effect } from "effect";

export type CompareSourceKind = "project" | "folder" | (string & {});

export interface SourceText {
  readonly text: string;
  readonly stamp?: SourceStamp;
}

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

export interface CompareSource {
  readonly id: string;
  readonly label: string;
  readonly kind: CompareSourceKind;
  readonly canApply: boolean;
  books(): Effect.Effect<readonly BookId[], CompareError>;
  read(bookId: BookId): Effect.Effect<SourceText, CompareError>;
  apply?(bookId: BookId, text: string): Effect.Effect<Receipt, CompareError>;
}

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
