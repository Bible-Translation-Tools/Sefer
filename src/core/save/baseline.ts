import type { BookId } from "@wycliffeassociates/sefer-text/book";
import type { SourceStamp } from "@wycliffeassociates/sefer-text/source";

export interface Baseline {
  readonly bookId: BookId;
  readonly path: string;
  readonly stamp: SourceStamp;
  readonly hash?: bigint;
  readonly text: string;
  readonly savedAt: number;
}
