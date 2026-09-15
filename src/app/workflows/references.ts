/**
 * Binding a project's reference texts to the corpus, so they can be searched
 * and overlaid.
 *
 * The Library records that a resource holds the `source` or `reference` role in
 * a project (`src/core/resources/library.ts`). That is a fact about the
 * project's setup and nothing more: until something registers those books with
 * the engine, Find's "Reference" scope has nothing to read and Match formatting
 * has no source skeleton to overlay.
 *
 * This is the join, and it lives in a workflow for the same reason `stet.ts`
 * does — it is the only place that knows about BOTH the Library and the
 * corpus. `ProjectAnalysis.attachReferences` does the registering and owns the
 * lifetime; this module does the reading.
 *
 * ## Why it reads files directly
 *
 * `Library.lookup` answers one reference at a time by slicing USFM with a regex
 * scan, which is the right shape for "show me this verse" and the wrong one
 * here: the engine wants whole books, exactly as they are on disk, because it
 * is going to parse them. So this reads the resource root through the
 * `FileSystem` port — the same port everything else in Sefer reads through —
 * and hands the bytes over undecorated.
 *
 * ## Which role
 *
 * BOTH `source` and `reference`, and they are not distinguished. To the engine
 * a reference is a reference; the roles differ in what the project MEANS by
 * them (a source is what the translation was made from, a reference is
 * something to consult), which matters to the screens and not to a search.
 */

import { Effect, FileSystem, Result } from "effect";

import { ProjectAnalysis, type ReferenceText } from "../../core/analysis/projectAnalysis";
import { joinPath } from "../../core/fileSystem/path";
import { Library, ROLES, type Resource } from "../../core/resources/library";
import { decode } from "../../core/source/source";

/** What a screen needs to know: which resources answer, and how many books. */
export interface BoundReferences {
  /** The resources bound under `source` or `reference`, in binding order. */
  readonly resources: readonly Resource[];
  /** Ids registered with the corpus — the `references` scope's population. */
  readonly ids: readonly string[];
}

export const EMPTY: BoundReferences = { resources: [], ids: [] };

const isUsfm = (path: string): boolean => path.toLowerCase().endsWith(".usfm");

/**
 * Every `.usfm` file under one resource root, as canonical text.
 *
 * A file that will not decode is SKIPPED rather than failing the whole
 * resource: a reference set with one broken file is still a useful reference
 * set, and the alternative is a project whose Reference scope silently does not
 * exist because of a single stray byte.
 */
const booksOf = (
  fileSystem: FileSystem.FileSystem,
  resource: Resource,
): Effect.Effect<readonly ReferenceText[]> =>
  Effect.gen(function* () {
    const entries = yield* Effect.orElseSucceed(
      fileSystem.readDirectory(resource.root, { recursive: true }),
      (): readonly string[] => [],
    );
    const out: ReferenceText[] = [];
    for (const entry of entries.filter(isUsfm).sort()) {
      const path = joinPath(resource.root, entry);
      const read = yield* Effect.result(fileSystem.readFile(path));
      if (Result.isFailure(read)) continue;
      const source = decode(read.success);
      if (Result.isFailure(source)) continue;
      out.push({ id: path, text: source.success.text });
    }
    return out;
  });

/**
 * One registered reference's text, read back off disk.
 *
 * The id IS the path — that is what `booksOf` registered it as — so this is a
 * read and not a lookup. `undefined` when the file is gone or will not decode,
 * which a caller shows as "no source for this book" rather than as an error:
 * the binding is still valid, this one file is not readable right now.
 *
 * Read rather than kept: the corpus holds the text for its own purposes, and a
 * second copy in a Solid signal per screen is a copy that can go stale against
 * the file without anything noticing.
 */
export const textOfReference = (
  id: string,
): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const read = yield* Effect.result(fileSystem.readFile(id));
    if (Result.isFailure(read)) return undefined;
    const source = decode(read.success);
    return Result.isFailure(source) ? undefined : source.success.text;
  });

/**
 * Resolve the project's `source` and `reference` bindings and register every
 * book of them with the corpus, keeping their text.
 *
 * Safe to call whenever a screen that needs references opens: registration is
 * idempotent per id and unchanged text costs a checksum. `attachReferences`
 * replaces the whole set, so a binding the user removed stops answering.
 *
 * `projectId` is the project ROOT, which is what `Library.bind` keys on.
 */
export const bindReferences = (
  projectId: string,
): Effect.Effect<BoundReferences, never, Library | ProjectAnalysis | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const library = yield* Library;
    const analysis = yield* ProjectAnalysis;
    const fileSystem = yield* FileSystem.FileSystem;

    const sources = yield* library.resolve(projectId, ROLES.source);
    const references = yield* library.resolve(projectId, ROLES.reference);
    // One resource may hold both roles; it is one reference either way.
    const seen = new Set<string>();
    const resources: Resource[] = [];
    for (const resource of [...sources, ...references]) {
      if (seen.has(resource.id)) continue;
      seen.add(resource.id);
      resources.push(resource);
    }
    if (resources.length === 0) {
      yield* analysis.attachReferences([]);
      return EMPTY;
    }

    const books: ReferenceText[] = [];
    for (const resource of resources) books.push(...(yield* booksOf(fileSystem, resource)));
    const ids = yield* analysis.attachReferences(books);
    return { resources, ids };
  });
