import { identifyBook, trustedBy, type Book, type Origin } from "@sefer/text/book";
import type { SourceStamp } from "@sefer/text/source";
import { Effect, FileSystem, Option, Result } from "effect";

import { Galley, toLf } from "../galley";
import { Git, repositoryPath, type ChangedPath, type CommitId, type Repo } from "../git/git";
import type { Project } from "../project/project";
import { bookFacts, type BookFacts, type Diff } from "./facts";

const USFM = /\.usfm$/iu;

export const isScripture = (path: string): boolean => USFM.test(path);

export const booksByPath = (repo: Repo, project: Project): ReadonlyMap<string, Book> => {
  const books = new Map<string, Book>();
  for (const book of project.books) {
    const relative = repositoryPath(repo.root, book.path);
    if (Option.isSome(relative)) books.set(relative.value, book);
  }
  return books;
};

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
  readonly stamps: ReadonlyMap<string, SourceStamp>;
  readonly theirs: ReadonlyMap<string, string>;
}

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
    const theirsTexts = new Map<string, string>();
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
      const theirs = yield* textAt(repo, tip, entry.path);
      if (theirs !== undefined) theirsTexts.set(entry.path, theirs);
      facts.push(
        bookFacts(
          {
            path: entry.path,
            bookId: book?.id ?? identifyBook(mine ?? "", entry.path),
            base: yield* textAt(repo, base, entry.path),
            mine,
            theirs,
          },
          diff,
        ),
      );
    }
    return { facts, stamps, theirs: theirsTexts };
  });

export const unmoved = (classified: Classified, books: ReadonlyMap<string, Book>): boolean =>
  [...classified.stamps].every(([path, stamp]) => {
    const book = books.get(path);
    return book !== undefined && sameStamp(book.source().stamp, stamp);
  });

export type HandOver =
  | { readonly ok: true; readonly applied: readonly Applied[] }
  | { readonly ok: false; readonly moved: readonly string[] }
  | { readonly ok: false; readonly refused: string; readonly rule: string };

export interface Applied {
  readonly path: string;
  readonly book: Book;
  readonly before: string;
  readonly stamp: SourceStamp;
}

export const handOver = (
  repo: Repo,
  project: Project,
  classified: Classified,
  paths: readonly string[],
  origin: Origin,
): Effect.Effect<HandOver> =>
  Effect.sync((): HandOver => {
    const books = booksByPath(repo, project);
    const moved = paths.filter((path) => {
      const book = books.get(path);
      const stamp = classified.stamps.get(path);
      return book !== undefined && (stamp === undefined || !sameStamp(book.source().stamp, stamp));
    });
    if (moved.length > 0) return { ok: false, moved };
    const applied: Applied[] = [];
    for (const path of paths) {
      const book = books.get(path);
      const text = classified.theirs.get(path);
      if (book === undefined || text === undefined) continue;
      const before = book.source().text;
      if (before === text) continue;
      const done = book.apply(
        [{ from: 0, to: before.length, insert: text }],
        origin,
        trustedBy("sync.handOver"),
      );
      if (Result.isFailure(done)) {
        giveBackNow(applied);
        return { ok: false, refused: path, rule: done.failure.rule };
      }
      applied.push({ path, book, before, stamp: book.source().stamp });
    }
    return { ok: true, applied };
  });

const giveBackNow = (applied: readonly Applied[]): readonly string[] => {
  const kept: string[] = [];
  for (const entry of [...applied].reverse()) {
    if (!sameStamp(entry.book.source().stamp, entry.stamp)) {
      kept.push(entry.path);
      continue;
    }
    entry.book.apply(
      [{ from: 0, to: entry.book.source().text.length, insert: entry.before }],
      "revert",
      trustedBy("sync.handOver"),
    );
  }
  return kept;
};

export const giveBack = (applied: readonly Applied[]): Effect.Effect<readonly string[]> =>
  Effect.sync(() => giveBackNow(applied));
