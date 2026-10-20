import { identifyBook, type BookId } from "@sefer/text/book";
import { decode } from "@sefer/text/source";
import { Effect, FileSystem, Result } from "effect";

import { discoverBooks } from "../project/discovery";
import { nameOfRoot } from "../project/slug";
import { failCompare, type CompareSource } from "./source";

interface Scan {
  readonly order: readonly BookId[];
  readonly texts: ReadonlyMap<BookId, string>;
}

export const folderSource = (
  fileSystem: FileSystem.FileSystem,
  root: string,
  label?: string,
): CompareSource => {
  let held: Scan | undefined;

  const scan = Effect.gen(function* () {
    const paths: readonly string[] = yield* Effect.orElseSucceed(
      discoverBooks(fileSystem, root),
      () => [],
    );
    const order: BookId[] = [];
    const texts = new Map<BookId, string>();
    for (const path of paths) {
      const bytes = yield* Effect.result(fileSystem.readFile(path));
      if (Result.isFailure(bytes)) continue;
      const source = decode(bytes.success);
      if (Result.isFailure(source)) continue;
      const id = identifyBook(source.success.text, path);
      if (texts.has(id)) continue;
      texts.set(id, source.success.text);
      order.push(id);
    }
    return { order, texts } satisfies Scan;
  });

  const scanned: Effect.Effect<Scan> = Effect.suspend(() =>
    held === undefined
      ? Effect.map(scan, (found) => {
          held = found;
          return found;
        })
      : Effect.succeed(held),
  );

  return {
    id: `folder:${root}`,
    label: label ?? nameOfRoot(root),
    kind: "folder",
    canApply: false,

    books: () => Effect.map(scanned, (found) => found.order),

    read: (bookId) =>
      Effect.flatMap(scanned, (found) => {
        const text = found.texts.get(bookId);
        return text === undefined
          ? failCompare("Absent", `${bookId} is not in ${root}`)
          : Effect.succeed({ text });
      }),
  };
};
