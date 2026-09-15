// What the save model now promises, in the two places it is easy to break:
// nothing writes a project file except an explicit `save`/`saveAll`, and what
// is written is the file's own form rather than Sefer's canonical one.
//
// The coordinator is exercised over the in-memory FileSystem, which is the
// same port the Web and the desktop hosts implement, so these are behaviour
// tests and not a mock's echo.

import { Effect, FileSystem, Layer, Option, Result } from "effect";
import { describe, expect, it } from "vitest";

import { openBook, UNTRUSTED, type Book } from "../book/book";
import { MemoryFileSystemLive } from "../fileSystem/memory";
import { SaveCoordinator, SaveCoordinatorLive } from "./saveCoordinator";

const PATH = "/project/57-PHM.usfm";

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

const textOf = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/**
 * One project of one book over an in-memory disk, with Save on top of it. The
 * seed is BYTES, so a test can seed CRLF or a byte order mark and read back
 * exactly what landed.
 */
const withProject = <A, E>(
  seed: string | Uint8Array,
  use: (context: {
    readonly book: Book;
    readonly save: (typeof SaveCoordinator)["Service"];
    readonly read: () => Effect.Effect<Uint8Array>;
  }) => Effect.Effect<A, E>,
): Promise<A> =>
  Effect.runPromise(
    Effect.provide(
      // A refusal anywhere in a test is a defect, not an outcome to assert on:
      // every failure here dies rather than being folded into the result.
      Effect.orDie(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const book = yield* openBook(PATH);
          const save = yield* SaveCoordinator;
          yield* save.adopt(book);
          return yield* use({
            book,
            save,
            read: () => Effect.orDie(fileSystem.readFile(PATH)),
          });
        }),
      ),
      Layer.provideMerge(SaveCoordinatorLive(), MemoryFileSystemLive({ [PATH]: seed })),
    ),
  );

const edit = (book: Book, insert: string): void => {
  const applied = book.apply([{ from: 0, to: 0, insert }], "keyboard", UNTRUSTED);
  if (Result.isFailure(applied)) throw new Error(`apply refused: ${applied.failure.reason}`);
};

describe("nothing writes but an explicit save", () => {
  it("has no automatic write path at all", async () => {
    // The guard on the whole decision: if a timer-driven write ever comes
    // back, the product has two writers again and every status word stops
    // meaning anything. Asserted on the built service rather than waited for,
    // because there is no timer left to wait on — that is the point.
    const members = await withProject("\\id PHM\n", ({ save }) =>
      Effect.succeed(Object.keys(save).sort()),
    );

    expect(members).not.toContain("autosave");
    expect(members).toEqual([
      "adopt",
      "baseline",
      "dirty",
      "externalChanges",
      "resolve",
      "save",
      "saveAll",
      "serialize",
    ]);
  });

  it("leaves the file untouched while the book is dirty, and writes it on save", async () => {
    const written = await withProject("\\id PHM\nPaul\n", ({ book, save, read }) =>
      Effect.gen(function* () {
        edit(book, "\\rem draft\n");
        expect(save.dirty(book)).toBe(true);
        // The edit is in the editor and (in the running app) in the journal.
        // It is not in the file, and no amount of waiting puts it there.
        expect(textOf(yield* read())).toBe("\\id PHM\nPaul\n");

        yield* save.save(book);
        expect(save.dirty(book)).toBe(false);
        return textOf(yield* read());
      }),
    );

    expect(written).toBe("\\rem draft\n\\id PHM\nPaul\n");
  });

  it("saveAll writes every dirty book and nothing else", async () => {
    const receipts = await withProject("\\id PHM\nPaul\n", ({ book, save }) =>
      Effect.gen(function* () {
        // Clean: adopt seeded the baseline from the bytes we opened.
        expect((yield* save.saveAll([book])).length).toBe(0);
        edit(book, "\\rem draft\n");
        return (yield* save.saveAll([book])).length;
      }),
    );

    expect(receipts).toBe(1);
  });
});

describe("the file is written back in its own form", () => {
  it("keeps CRLF through an edit and a save", async () => {
    const written = await withProject("\\id PHM\r\nPaul\r\n", ({ book, save, read }) =>
      Effect.gen(function* () {
        edit(book, "\\rem draft\n");
        yield* save.save(book);
        return textOf(yield* read());
      }),
    );

    expect(written).toBe("\\rem draft\r\n\\id PHM\r\nPaul\r\n");
  });

  it("keeps a byte order mark, and does not count it as text", async () => {
    const seed = new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf("\\id PHM\r\nPaul\r\n")]);
    const answer = await withProject(seed, ({ book, save, read }) =>
      Effect.gen(function* () {
        edit(book, "\\rem draft\n");
        const receipt = yield* save.save(book);
        const bytes = yield* read();
        return {
          leading: Array.from(bytes.slice(0, 3)),
          text: textOf(bytes.slice(3)),
          // The receipt counts the bytes that landed, mark and all; the stamp
          // counts the canonical characters that did not.
          bytes: receipt.bytes,
          length: receipt.stamp.length,
        };
      }),
    );

    expect(answer.leading).toEqual([0xef, 0xbb, 0xbf]);
    expect(answer.text).toBe("\\rem draft\r\n\\id PHM\r\nPaul\r\n");
    expect(answer.bytes).toBe(3 + answer.text.length);
    expect(answer.length).toBe("\\rem draft\n\\id PHM\nPaul\n".length);
  });

  it("makes a mixed file uniform in its majority on the first save", async () => {
    const written = await withProject("a\r\nb\r\nc\nd\r\n", ({ book, save, read }) =>
      Effect.gen(function* () {
        edit(book, "x\n");
        yield* save.save(book);
        return textOf(yield* read());
      }),
    );

    expect(written).toBe("x\r\na\r\nb\r\nc\r\nd\r\n");
  });

  it("baselines the canonical text, never the bytes", async () => {
    // The whole reason the form is kept off the identity: a CRLF book and an
    // LF book with the same content are the same text, and every comparison —
    // dirty, diff, external change — has to agree about that.
    const baseline = await withProject("\\id PHM\r\nPaul\r\n", ({ book, save }) =>
      Effect.gen(function* () {
        edit(book, "\\rem draft\n");
        yield* save.save(book);
        const held = save.baseline(book);
        return Option.isNone(held) ? undefined : held.value.text;
      }),
    );

    expect(baseline).toBe("\\rem draft\n\\id PHM\nPaul\n");
    expect(baseline?.includes("\r")).toBe(false);
  });
});
