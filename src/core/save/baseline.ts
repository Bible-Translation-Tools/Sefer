// baseline.ts
//
// The Baseline: what Save last wrote to disk for one book, kept so that later
// questions can be answered without touching the filesystem — is this book
// dirty, did the file change under us, what did the user's last saved text look
// like. It is the data contract between Save, which produces exactly one
// Baseline per successful write, and Diff, which compares a Book against it. A
// value with no operations: whoever holds one reads its fields.
//
// `hash` is optional because core computes no content hash. When the text went
// through Galley the engine's xxh3 hash is attached here and it decides
// identity ACROSS sessions; within one session the stamp's revision decides.
// Length alone never identifies text.

import type { BookId } from "../book/book";
import type { SourceStamp } from "../source/source";

export interface Baseline {
  readonly bookId: BookId;
  /** The file the bytes went to; the same path a later save writes. */
  readonly path: string;
  /** The stamp of the text that was written, captured before the write. */
  readonly stamp: SourceStamp;
  /** The engine hash of that text, when a hasher was available. */
  readonly hash?: bigint;
  /** The exact canonical LF text that was written, for diffing and revert.
   * Canonical, not the bytes: the file may hold CRLF and a byte order mark
   * (`Source.form`), and none of that is part of the text's identity. */
  readonly text: string;
  /** Wall clock of the successful write, `Date.now()` milliseconds. */
  readonly savedAt: number;
}
