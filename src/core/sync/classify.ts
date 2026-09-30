/**
 * The change facts for a receive or a combine, taken from the Books.
 *
 * "Mine" is each Book's CURRENT Source — unsaved edits included — when the
 * project holds the book, and the work tree's copy otherwise; the base and
 * "theirs" are blobs. Every Book's stamp is kept, so the caller can tell
 * whether typing landed between the classification and the write it allows.
 */
import { Effect, FileSystem, Option, Result } from "effect";

import { identifyBook, type Book } from "../book/book";
import { Galley, toLf } from "../galley";
import { Git, repositoryPath, type ChangedPath, type CommitId, type Repo } from "../git/git";
import type { Project } from "../project/project";
import type { SourceStamp } from "../source/source";
import { bookFacts, type BookFacts, type Diff } from "./facts";

const USFM = /\.usfm$/iu;

/** Only scripture files get facts; a manifest change is not a chapter. */
export const isScripture = (path: string): boolean => USFM.test(path);

/** The project's Books by repository-relative path. */
export const booksByPath = (repo: Repo, project: Project): ReadonlyMap<string, Book> => {
  const books = new Map<string, Book>();
  for (const book of project.books) {
    const relative = repositoryPath(repo.root, book.path);
    if (Option.isSome(relative)) books.set(relative.value, book);
  }
  return books;
};

/** A blob as LF text, or `undefined` when the path is not in that commit. */
const textAt = (
  repo: Repo,
  rev: string,
  path: string,
): Effect.Effect<string | undefined, never, Git> =>
  Effect.flatMap(Git, (git) =>
    Effect.orElseSucceed(
      Effect.map(
        git.show(repo, rev, path),
        (bytes): string | undefined => toLf(new TextDecoder().decode(bytes)).text,
      ),
      () => undefined,
    ),
  );

const sameStamp = (a: SourceStamp, b: SourceStamp): boolean =>
  a.revision === b.revision && a.length === b.length;

export interface Classified {
  readonly facts: readonly BookFacts[];
  /** The stamp each Book's Source had when it was classified. */
  readonly stamps: ReadonlyMap<string, SourceStamp>;
}

/**
 * The facts for every scripture file in `changed`, measured from `base`
 * (a commit id) to the Book or work tree on one side and `tip` on the other.
 */
export const classify = (
  repo: Repo,
  books: ReadonlyMap<string, Book>,
  base: CommitId,
  tip: CommitId,
  changed: readonly ChangedPath[],
): Effect.Effect<Classified, never, Git | Galley | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const galley = yield* Galley;
    const diff: Diff = (before, after) => {
      const skeleton = galley.diff(before, after);
      return Result.isSuccess(skeleton) ? skeleton.success : undefined;
    };
    const facts: BookFacts[] = [];
    const stamps = new Map<string, SourceStamp>();
    for (const entry of changed) {
      if (!isScripture(entry.path)) continue;
      const book = books.get(entry.path);
      let mine: string | undefined;
      if (book === undefined) {
        mine = yield* Effect.orElseSucceed(
          Effect.map(
            fileSystem.readFileString(`${repo.root}/${entry.path}`),
            (text): string | undefined => toLf(text).text,
          ),
          () => undefined,
        );
      } else {
        const source = book.source();
        mine = source.text;
        stamps.set(entry.path, source.stamp);
      }
      facts.push(
        bookFacts(
          {
            path: entry.path,
            bookId: book?.id ?? identifyBook(mine ?? "", entry.path),
            base: yield* textAt(repo, base, entry.path),
            mine,
            theirs: yield* textAt(repo, tip, entry.path),
          },
          diff,
        ),
      );
    }
    return { facts, stamps };
  });

/** True when every classified Book still holds the Source it was classified at. */
export const unmoved = (classified: Classified, books: ReadonlyMap<string, Book>): boolean =>
  [...classified.stamps].every(([path, stamp]) => {
    const book = books.get(path);
    return book !== undefined && sameStamp(book.source().stamp, stamp);
  });
