import { Effect, Layer } from "effect";
import { expect, test } from "vitest";

import { FixtureFileSystemLive, SMALL_NT_ROOT } from "../fixture/smallNt";
import { Observability, ObservabilityLive } from "../observability";
import type { Book, Receipt } from "./book";
import { openBook } from "./book";

const PHILEMON = `${SMALL_NT_ROOT}/58-PHM.usfm`;

const append = (book: Book, insert: string, origin: string): Receipt => {
  const end = book.source().text.length;
  return book.apply({ from: end, to: end, insert }, origin);
};

test("a book opened over the fixture filesystem carries its id, receipts, and subscribers", async () => {
  const program = Effect.gen(function* () {
    const book = yield* openBook(PHILEMON);
    const original = book.source().text;

    const heard: string[] = [];
    book.changes((receipt) => heard.push(`first r${receipt.after.revision}`));
    const second = book.changes((receipt) => heard.push(`second r${receipt.after.revision}`));
    const dropped = book.changes(() => heard.push("dropped"));
    dropped();

    const first = append(book, "\\rem checked\n", "test");
    second();
    const later = append(book, "\\rem again\n", "test");

    return { book, original, first, later, heard };
  });

  const { book, original, first, later, heard } = await Effect.runPromise(
    Effect.provide(program, FixtureFileSystemLive),
  );

  expect(book.id).toBe("PHM");
  expect(book.path).toBe(PHILEMON);
  expect(original.startsWith("\\id PHM")).toBe(true);

  expect(first.origin).toBe("test");
  expect(first.before.length).toBe(original.length);
  expect(first.after.revision).toBe(first.before.revision + 1);
  expect(first.after.length).toBe(`${original}\\rem checked\n`.length);

  expect(later.before).toEqual(first.after);
  expect(later.after.length).toBe(book.source().text.length);
  expect(later.after.revision).toBe(2);

  expect(heard).toEqual(["first r1", "second r1", "first r2"]);
});

test("apply emits one book.apply note when Observability is in context", async () => {
  const program = Effect.gen(function* () {
    const observability = yield* Observability;
    const book = yield* openBook(PHILEMON);
    append(book, "\\rem checked\n", "test");
    return observability.recent();
  });

  const events = await Effect.runPromise(
    Effect.provide(program, Layer.merge(FixtureFileSystemLive, ObservabilityLive())),
  );
  const applied = events.filter((event) => event.name === "book.apply");

  expect(applied).toHaveLength(1);
  expect(applied[0]?.verdict).toBe("rewrote");
  expect(applied[0]?.correlation).toBe("PHM");
  expect(applied[0]?.detail).toBe("PHM r0 -> r1 (test)");
});
