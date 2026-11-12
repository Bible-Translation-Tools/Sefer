import type { Book, BookId } from "@wycliffeassociates/sefer-text/book";
import * as TextResult from "@wycliffeassociates/sefer-text/result";
import { decode, type SourceStamp } from "@wycliffeassociates/sefer-text/source";
import { Effect, Option, Result } from "effect";

import { repositoryPath, type Author, type CommitId, type Repo } from "#core/git/git";
import type { Project } from "#core/project/project";
import { headerOf, namesOf, sameNames, type Names } from "#core/rules/bookNames";

import type { Services } from "./services";

export type RecordOutcome =
  | { readonly kind: "nothing" }
  | { readonly kind: "not-written"; readonly error: unknown }
  | { readonly kind: "not-recorded"; readonly error: unknown; readonly books: readonly BookId[] }
  | {
      readonly kind: "recorded";
      readonly commit: CommitId;
      readonly receipts: number;
      readonly books: readonly BookId[];
    };

/**
 * Books whose names the project list should take at the next recorded version
 * though their text may not have changed: chosen through a names finding's fix
 * or the Book names shortcut. Per project root, for this session. Module-level
 * because recording is reached from Save, Review and Sync alike, none of which
 * holds the shell.
 */
const queued = new Map<string, Set<BookId>>();

export const queueBookNames = (root: string, books: readonly BookId[]): void => {
  const held = queued.get(root) ?? new Set<BookId>();
  for (const book of books) held.add(book);
  queued.set(root, held);
};

export const queuedBookNames = (root: string): readonly BookId[] => [...(queued.get(root) ?? [])];

/** A book's three names now: from its held parse when that is current, else a fresh one. */
const namesNow = (services: Services, book: Book): Names => {
  const held = services.projectAnalysis.analysis(book.id);
  const analysis =
    Option.isSome(held) && services.projectAnalysis.fresh(book.id, book.source().stamp)
      ? held.value.analysis
      : services.galley.analyzeText(book.source().text, "bookNames.record");
  return namesOf(headerOf(analysis));
};

/** A book's three names in the last recorded version; none when it has no recorded version. */
const namesRecorded = (services: Services, project: Project, repo: Repo, book: Book) =>
  Effect.gen(function* () {
    const inside = repositoryPath(project.root, book.path);
    if (Option.isNone(inside)) return undefined;
    const bytes = yield* Effect.result(services.git.show(repo, "HEAD", inside.value));
    if (Result.isFailure(bytes)) return undefined;
    const source = decode(bytes.success);
    if (TextResult.isFailure(source)) return undefined;
    return namesOf(
      headerOf(services.galley.analyzeText(source.success.text, "bookNames.recorded")),
    );
  });

/**
 * The project list's names to write with this version (RFC "Book names"):
 * each recorded book whose names differ from its last recorded version, and
 * each book queued by hand. Written through bento's handle (`renameBooks`);
 * the paths it wrote are recorded with the books.
 */
const renameForRecord = (services: Services, project: Project, books: readonly Book[]) =>
  Effect.gen(function* () {
    const repo = yield* services.git.init(project.root);
    const chosen = new Set(queuedBookNames(project.root));
    const renames: { book: string; short?: string; long?: string; abbr?: string }[] = [];
    const seen = new Set<BookId>();
    for (const book of [...books, ...project.books.filter((each) => chosen.has(each.id))]) {
      if (seen.has(book.id)) continue;
      seen.add(book.id);
      const now = namesNow(services, book);
      if (!chosen.has(book.id)) {
        const before = yield* namesRecorded(services, project, repo, book);
        if (before !== undefined && sameNames(before, now)) continue;
      }
      if (now.short === undefined && now.long === undefined && now.abbr === undefined) continue;
      renames.push({ book: book.id.toUpperCase(), ...now });
    }
    if (renames.length === 0) return [];
    const renamed = yield* services.admin.renameBooks(project.root, renames);
    return renamed.written;
  });

export const recordVersion = async (
  services: Services,
  project: Project,
  books: readonly Book[],
  message: string,
  author: Author,
  also: readonly string[] = [],
): Promise<RecordOutcome> => {
  const named = queuedBookNames(project.root).length > 0;
  if (books.length === 0 && also.length === 0 && !named) return { kind: "nothing" };
  const saved = await services.run(Effect.result(services.save.saveAll(project.books)));
  if (Result.isFailure(saved)) return { kind: "not-written", error: saved.failure };

  const receipts: { readonly path: string; readonly stamp: SourceStamp }[] = [];
  for (const book of books) {
    const baseline = services.save.baseline(book);
    if (Option.isNone(baseline)) continue;
    receipts.push({ path: baseline.value.path, stamp: baseline.value.stamp });
  }
  for (const path of also) receipts.push({ path, stamp: { revision: 0, length: 0 } });
  // The project list follows the books' names; a manifest that can't be written leaves the version without it.
  const manifests = await services.run(
    Effect.catch(renameForRecord(services, project, books), (error) =>
      Effect.sync((): readonly string[] => {
        services.composition.observability.note("bookNames.record", "failed", String(error));
        return [];
      }),
    ),
  );
  for (const path of manifests)
    if (!receipts.some((receipt) => receipt.path === path))
      receipts.push({ path, stamp: { revision: 0, length: 0 } });
  if (receipts.length === 0) return { kind: "nothing" };
  const staged = new Set(receipts.map((receipt) => receipt.path));
  for (const receipt of saved.success)
    for (const path of receipt.also)
      if (!staged.has(path)) {
        staged.add(path);
        receipts.push({ path, stamp: receipt.stamp });
      }

  const ids = books.map((book) => book.id);
  const recorded = await services.run(
    Effect.result(
      Effect.gen(function* () {
        const repo = yield* services.git.init(project.root);
        return yield* services.git.commit(repo, receipts, message, author);
      }),
    ),
  );
  if (Result.isFailure(recorded))
    return { kind: "not-recorded", error: recorded.failure, books: ids };
  if (manifests.length > 0) {
    queued.delete(project.root);
    await services.run(project.refreshMetadata());
    services.projectAnalysis.metadataChanged();
  }
  return { kind: "recorded", commit: recorded.success, receipts: receipts.length, books: ids };
};
