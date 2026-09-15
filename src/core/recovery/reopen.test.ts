// The one question a project open asks, now that the file is written only
// when a version is recorded.
//
// Under the old model the journal usually matched disk, so the banner was the
// exception. Under this one it usually does not, so the SILENT half of the
// rule — a journal the file already holds is deleted without asking — is what
// keeps the banner worth reading. Both halves are checked here, over the real
// Recovery service and the in-memory FileSystem.

import { Effect, FileSystem, Layer, Option, Result } from "effect";
import { describe, expect, it } from "vitest";

import { makeBook, UNTRUSTED, type Book } from "../book/book";
import { MemoryFileSystemLive } from "../fileSystem/memory";
import { decode } from "../source/source";
import { Recovery, RecoveryLive, type RecoveryService } from "./recovery";
import { pendingOnOpen, reachedDisk } from "./reopen";

const ROOT = "/appData/journals";
const PROJECT = "/project";
const PATH = "/project/57-PHM.usfm";
/**
 * The journal's handle. `listIds` builds it from `readDirectory(root,
 * {recursive:true})`, which reports paths RELATIVE to the root, so the
 * project's leading slash is not part of it. The id is only a handle — the
 * journal's identity is the header line it carries.
 */
const JOURNAL_ID = "project/PHM";
const OPENED = "\\id PHM\nPaul\n";

const bookFrom = (text: string): Book => {
  const decoded = decode(new TextEncoder().encode(text));
  if (Result.isFailure(decoded)) throw new Error("the fixture is not decodable");
  return makeBook(PATH, decoded.success);
};

const edit = (book: Book, insert: string): void => {
  const applied = book.apply([{ from: 0, to: 0, insert }], "keyboard", UNTRUSTED);
  if (Result.isFailure(applied)) throw new Error(`apply refused: ${applied.failure.reason}`);
};

/**
 * A session that typed and then ended: the book is edited with Recovery
 * attached, the journal is flushed, and then the caller says what the FILE
 * holds by the time the next session opens.
 */
const afterACrash = (
  onDisk: string,
  type: (book: Book) => void,
): Promise<{ readonly offered: readonly string[]; readonly journals: readonly string[] }> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const recovery = yield* Recovery;
          const book = bookFrom(OPENED);
          yield* recovery.attach(book, PROJECT);
          type(book);
          // The journal is debounced; nothing here is allowed to depend on the
          // timer, so the entries are flushed by asking for them directly.
          yield* flush(recovery, book);

          yield* Effect.orDie(fileSystem.writeFileString(PATH, onDisk));
          const offered = yield* pendingOnOpen(recovery, PROJECT);
          const all = yield* recovery.pending(() => Option.none());
          return {
            offered: offered.map((journal) => journal.id),
            journals: all.map((journal) => journal.id),
          };
        }),
        Layer.provideMerge(
          RecoveryLive({ journalRoot: ROOT, policy: { idleMs: 1, maxIntervalMs: 1 } }),
          MemoryFileSystemLive({ [PATH]: OPENED }),
        ),
      ),
    ),
  );

/** Waits for the debounced flush to have put the journal on disk. */
const flush = (recovery: RecoveryService, book: Book): Effect.Effect<void> =>
  Effect.flatMap(Effect.sleep("30 millis"), () =>
    // `compact` at revision -1 keeps every entry but forces the service to
    // read and rewrite the journal, which is how a test knows the file is
    // there without reaching into the module's private state.
    Effect.ignore(recovery.compact(book.id, { revision: -1, length: 0 })),
  );

describe("pendingOnOpen", () => {
  it("offers the journal when the file never got the work — the ordinary case now", async () => {
    // Explicit-only saving: the session typed, nobody recorded a version, so
    // the file is exactly what was opened.
    const answer = await afterACrash(OPENED, (book) => edit(book, "\\rem draft\n"));

    expect(answer.offered).toEqual([JOURNAL_ID]);
  });

  it("deletes the journal without asking when the file already holds the work", async () => {
    const answer = await afterACrash(`\\rem draft\n${OPENED}`, (book) =>
      edit(book, "\\rem draft\n"),
    );

    expect(answer.offered).toEqual([]);
    // Deleted, not merely hidden: a banner that keeps re-offering recorded
    // work is a banner people learn to dismiss.
    expect(answer.journals).toEqual([]);
  });

  it("offers the journal when the book file has gone missing", async () => {
    const answer = await Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          Effect.gen(function* () {
            const fileSystem = yield* FileSystem.FileSystem;
            const recovery = yield* Recovery;
            const book = bookFrom(OPENED);
            yield* recovery.attach(book, PROJECT);
            edit(book, "\\rem draft\n");
            yield* flush(recovery, book);
            yield* Effect.orDie(fileSystem.remove(PATH, { force: true }));
            return yield* pendingOnOpen(recovery, PROJECT);
          }),
          Layer.provideMerge(
            RecoveryLive({ journalRoot: ROOT, policy: { idleMs: 1, maxIntervalMs: 1 } }),
            MemoryFileSystemLive({ [PATH]: OPENED }),
          ),
        ),
      ),
    );

    // A file that cannot be read is the strongest reason to keep the only
    // other copy of the work, not a reason to drop it.
    expect(answer.map((journal) => journal.id)).toEqual([JOURNAL_ID]);
  });
});

describe("reachedDisk", () => {
  it("compares canonical text, so a CRLF file still matches an LF journal", () => {
    // The file on disk may hold CRLF and a byte order mark; `pendingOnOpen`
    // decodes before comparing, which is what makes the form invisible here.
    const journal = {
      id: JOURNAL_ID,
      projectId: PROJECT,
      bookId: "PHM",
      path: PATH,
      lastStamp: { revision: 1, length: "\\rem draft\n\\id PHM\nPaul\n".length },
      entries: [
        {
          before: { revision: 0, length: OPENED.length },
          after: { revision: 1, length: "\\rem draft\n\\id PHM\nPaul\n".length },
          changes: [{ from: 0, to: 0, insert: "\\rem draft\n" }],
          origin: "keyboard" as const,
          at: 0,
        },
      ],
    };
    const fromCrlfFile = decode(new TextEncoder().encode("\\rem draft\r\n\\id PHM\r\nPaul\r\n"));
    if (Result.isFailure(fromCrlfFile)) throw new Error("the fixture is not decodable");

    expect(reachedDisk(fromCrlfFile.success.text, journal)).toBe(true);
    expect(reachedDisk(OPENED, journal)).toBe(false);
  });
});
