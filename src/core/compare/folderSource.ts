// folderSource.ts
//
// Any directory the `FileSystem` port can read, as a READ-ONLY compare source.
// A zip is not a source kind of its own: the host unpacks it into a scratch
// directory first (`src/platform/web/intake.ts`) and the result is a folder,
// which is why there is one file here and not two.
//
// It reuses the project's own two rules rather than inventing a second reading
// of a folder: `discoverBooks` decides which files are books (the extension
// scan plus a burrito's `ingredients` table), and `identifyBook` decides what
// each one is called (`\id`, else the file stem). A folder therefore lists
// exactly the books the same folder would list if it were opened as a project.
//
// It does NOT build Books. A Book owns a write path, listeners and a place in
// a project's lifetime, and none of that means anything for a side nobody can
// write to. Decoded text and an id is the whole of what a read-only side is.

import { Effect, FileSystem, Result } from "effect";

import { identifyBook, type BookId } from "../book/book";
import { discoverBooks } from "../project/discovery";
import { nameOfRoot } from "../project/slug";
import { decode } from "../source/source";
import { failCompare, type CompareSource } from "./source";

interface Scan {
  readonly order: readonly BookId[];
  readonly texts: ReadonlyMap<BookId, string>;
}

/**
 * A folder of books on the other side of the comparison.
 *
 * The scan happens ONCE, on the first `books()` or `read()`, and the texts are
 * held for the life of the source. That is deliberate: a comparison is a
 * frozen snapshot of two sides, and re-reading the folder halfway through
 * would let the right-hand column change under a decision the reader has
 * already made. Discard the source to discard the snapshot.
 *
 * A file that will not decode is left out rather than fatal, for the reason
 * `openProject` records a `failed` book rather than refusing the project: one
 * unreadable file must not cost the reader the other sixty-five.
 */
export const folderSource = (
  fileSystem: FileSystem.FileSystem,
  root: string,
  label?: string,
): CompareSource => {
  let held: Scan | undefined;

  const scan = Effect.gen(function* () {
    // A root that cannot be listed is an empty side, not a failed comparison:
    // the screen then shows every book as "only on the other side", which is
    // the truth about a folder Sefer could not read.
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
      // The first file wins a repeated id, exactly as `openProject` does.
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
