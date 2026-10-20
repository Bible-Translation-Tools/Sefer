import type { BookId } from "@sefer/text/book";
import type { SourceStamp } from "@sefer/text/source";

export interface Baseline {
  readonly bookId: BookId;
  readonly path: string;
  readonly stamp: SourceStamp;
  readonly hash?: bigint;
  readonly text: string;
  readonly savedAt: number;
}
