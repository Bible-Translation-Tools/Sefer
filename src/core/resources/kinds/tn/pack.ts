/**
 * The derived store for Translation Notes: one JSON file per book, rebuilt
 * from upstream's files and stamped — the notes' counterpart of the engine's
 * table of contents for USFM.
 *
 * Three things stay apart (plan §5, "The 27k-file wrinkle"):
 *
 *  - the ON-DISK LAYOUT is upstream's — chapter directories of chunk files —
 *    and is never reshaped, so git, export and a pull keep working;
 *  - the PACK is an index of it at `<root>/.sefer/packs/tn/<BOOK>.json`
 *    (`.sefer/` is already in a clone's git exclude, `remote/clone.ts`);
 *  - a pull or an edit moves the book's files, the stamp no longer matches,
 *    and that book's pack is rebuilt the next time it is read.
 *
 * Two kinds of root. One holding the raw tree (desktop's clone, a picked
 * folder) checks each pack against a fingerprint of the book's directory
 * listing. One holding only packs — the Web, where writing 29,300 files to
 * OPFS took 22.6 s against 0.14 s for 73 packs (`storage.md`, "The OPFS
 * tax") — treats the packs as the resource: they were built in memory from
 * the tree at import (`packHelp`) and the tree was never written.
 */

import { Effect, FileSystem, Result, Schema } from "effect";

import { writeFileStringAtomic } from "../../../fileSystem/atomic";
import { joinPath, normalisePath } from "../../../fileSystem/path";
import { decode } from "../../../source/source";
import { readResourceContainerManifest } from "../../projectMetadata";
import { Unavailable } from "../handle";
import { filesBelow, treeInFolder, type PackProgress, type UpstreamTree } from "../tree";
import { readHelpBook, type BookFile } from "./rcHelpMarkdown";

/** Bumped when the pack's shape or the reader's output changes: an older pack is rebuilt. */
const PACK_VERSION = 1;

const PACK_DIR = ".sefer/packs/tn";

const SpanSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("book") }),
  Schema.Struct({ kind: Schema.Literal("chapter"), chapter: Schema.Number }),
  Schema.Struct({
    kind: Schema.Literal("chunk"),
    chapter: Schema.Number,
    first: Schema.Number,
    last: Schema.optionalKey(Schema.Number),
  }),
]);

const StampSchema = Schema.Union([
  /** Built from a raw tree that is still there: valid while its listing is unchanged. */
  Schema.Struct({ kind: Schema.Literal("tree"), fingerprint: Schema.String }),
  /** Built at import from a tree that was not kept: the pack IS the resource. */
  Schema.Struct({
    kind: Schema.Literal("import"),
    at: Schema.String,
    commit: Schema.optionalKey(Schema.String),
  }),
]);

const PackSchema = Schema.Struct({
  format: Schema.Literal("sefer.tn.pack"),
  version: Schema.Literal(PACK_VERSION),
  /** Upper-case book id: `GEN`. */
  book: Schema.String,
  stamp: StampSchema,
  notes: Schema.Array(
    Schema.Struct({
      span: SpanSchema,
      ordinal: Schema.Number,
      heading: Schema.optionalKey(Schema.String),
      quote: Schema.optionalKey(Schema.String),
      body: Schema.String,
    }),
  ),
  /** What the reader did not make notes of, and why. */
  skipped: Schema.Array(Schema.String),
});

export type Pack = typeof PackSchema.Type;
type Stamp = typeof StampSchema.Type;

const decodePack = Schema.decodeUnknownResult(PackSchema);

/** One book of the manifest: its id and where its directory is, relative to the root. */
export interface HelpBook {
  readonly book: string;
  readonly path: string;
}

const unavailable = (reason: Unavailable["reason"], description: string): Unavailable =>
  new Unavailable({ reason, description });

const packPath = (root: string, book: string): string =>
  joinPath(root, `${PACK_DIR}/${book.toUpperCase()}.json`);

/** The books a help's manifest declares. A path that leaves the root is refused, never followed. */
const booksIn = (text: string): Result.Result<readonly HelpBook[], Unavailable> => {
  const manifest = readResourceContainerManifest(text);
  if (Result.isFailure(manifest))
    return Result.fail(unavailable("Unreadable", manifest.failure.description));
  const books: HelpBook[] = [];
  for (const project of manifest.success.projects) {
    const path = normalisePath(project.path);
    if (path.startsWith("..") || path.startsWith("/"))
      return Result.fail(
        unavailable("Unreadable", `${project.identifier}: ${project.path} leaves the resource`),
      );
    books.push({ book: project.identifier.toUpperCase(), path });
  }
  return Result.succeed(books);
};

const manifestOf = (tree: UpstreamTree): Effect.Effect<readonly HelpBook[], Unavailable> =>
  Effect.gen(function* () {
    const bytes = yield* tree.file("manifest.yaml");
    if (bytes === undefined)
      return yield* Effect.fail(unavailable("Unreadable", "no manifest.yaml"));
    const text = decode(bytes);
    if (Result.isFailure(text))
      return yield* Effect.fail(unavailable("Unreadable", text.failure.description));
    const books = booksIn(text.success.text);
    return Result.isSuccess(books) ? books.success : yield* Effect.fail(books.failure);
  });

/** The books a help on a `FileSystem` declares, from its `manifest.yaml`'s `projects[]`. */
export const helpBooks = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<readonly HelpBook[], Unavailable> => manifestOf(treeInFolder(fileSystem, root));

/**
 * A book directory's LISTING, folded to one string: each file's path, size
 * and modification time. Not a content hash — Sefer keeps none in core — but
 * enough to see that a pull or an edit moved the book.
 */
const fingerprint = (
  files: readonly { readonly path: string; readonly size: number; readonly mtime: number }[],
): string => {
  // FNV-1a, 32 bits: a change detector over a few kilobytes of listing.
  let hash = 0x811c9dc5;
  for (const file of files) {
    const line = `${file.path}\u0000${file.size}\u0000${file.mtime}\n`;
    for (let at = 0; at < line.length; at += 1) {
      hash ^= line.charCodeAt(at);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return `${files.length}:${hash.toString(16)}`;
};

/** Reads one book's files and runs the reader over them. */
const buildPack = (
  tree: UpstreamTree,
  help: HelpBook,
  stamp: Stamp,
  listed?: readonly string[],
): Effect.Effect<Pack, Unavailable> =>
  Effect.gen(function* () {
    const files = listed ?? (yield* tree.below(help.path));
    const bytes = yield* tree.read(help.path, files);
    const read: BookFile[] = [];
    for (const path of files) {
      const held = bytes.get(path);
      if (held === undefined)
        return yield* Effect.fail(unavailable("Unreadable", `${help.book} ${path}: not read`));
      const source = decode(held);
      if (Result.isFailure(source))
        return yield* Effect.fail(
          unavailable("Unreadable", `${help.book} ${path}: ${source.failure.description}`),
        );
      read.push({ path, text: source.success.text });
    }
    const book = readHelpBook(read);
    if (book.kind === "refused")
      return yield* Effect.fail(unavailable("Unreadable", `${help.book}: ${book.description}`));
    const pack: Pack = {
      format: "sefer.tn.pack",
      version: PACK_VERSION,
      book: help.book,
      stamp,
      notes: book.notes,
      skipped: book.skipped,
    };
    return pack;
  });

/**
 * One book's pack, `absent` when there is none, or `undecodable` when the
 * file is there and is not a pack this build reads: corrupt, or written by a
 * build with another `PACK_VERSION`.
 */
const readPack = (
  fileSystem: FileSystem.FileSystem,
  root: string,
  book: string,
): Effect.Effect<Pack | "absent" | "undecodable"> =>
  Effect.map(Effect.option(fileSystem.readFileString(packPath(root, book))), (text) => {
    if (text._tag === "None") return "absent";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.value);
    } catch {
      return "undecodable";
    }
    const decoded = decodePack(parsed);
    return Result.isSuccess(decoded) ? decoded.success : "undecodable";
  });

/**
 * That a pack just written is on disk whole: its bytes read back, parse, and
 * name the same book and the same number of notes. Not the full schema
 * decode every later read makes — that was most of a pack step's time
 * (2.4 s of en_tn's, 2026-10-12) for data this module had just encoded from
 * typed values.
 */
const readsBack = (
  fileSystem: FileSystem.FileSystem,
  root: string,
  pack: Pack,
): Effect.Effect<void, Unavailable> =>
  Effect.gen(function* () {
    const fail = unavailable("Unreadable", `${pack.book}: the pack did not read back`);
    const text = yield* Effect.mapError(
      fileSystem.readFileString(packPath(root, pack.book)),
      () => fail,
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return yield* Effect.fail(fail);
    }
    const same =
      typeof parsed === "object" &&
      parsed !== null &&
      "book" in parsed &&
      parsed.book === pack.book &&
      "notes" in parsed &&
      Array.isArray(parsed.notes) &&
      parsed.notes.length === pack.notes.length;
    if (!same) return yield* Effect.fail(fail);
  });

const writePack = (
  fileSystem: FileSystem.FileSystem,
  root: string,
  pack: Pack,
): Effect.Effect<void, Unavailable> =>
  Effect.mapError(
    Effect.gen(function* () {
      yield* fileSystem.makeDirectory(joinPath(root, PACK_DIR), { recursive: true });
      yield* writeFileStringAtomic(fileSystem, packPath(root, pack.book), JSON.stringify(pack));
    }),
    (error) => unavailable("Unreadable", `${pack.book} pack: ${error.message}`),
  );

/**
 * One book's notes, from its pack — rebuilt first when the book's raw tree is
 * there and has moved since the pack was made. With no raw tree the pack is
 * the resource; with neither, the book is `Missing`.
 *
 * A pack that cannot be written back (a read-only folder) is still answered
 * from memory: the index is a convenience, never a reason to fail a read.
 */
export const bookPack = (
  fileSystem: FileSystem.FileSystem,
  root: string,
  help: HelpBook,
): Effect.Effect<Pack, Unavailable> =>
  Effect.gen(function* () {
    const directory = joinPath(root, help.path);
    const raw = yield* Effect.orElseSucceed(fileSystem.exists(directory), () => false);
    const read = yield* readPack(fileSystem, root, help.book);
    if (!raw) {
      if (typeof read === "object") return read;
      // The packs are the resource here, so one this build cannot read is
      // not "no notes": it is a copy to download again (every pack, after a
      // `PACK_VERSION` change).
      if (read === "undecodable")
        return yield* Effect.fail(
          unavailable(
            "Unreadable",
            `The notes for ${help.book} were packed by another version of Sefer. Remove them on the projects page and download them again.`,
          ),
        );
      return yield* Effect.fail(unavailable("Missing", `no notes for ${help.book}`));
    }
    const held = typeof read === "object" ? read : undefined;
    const listed = yield* filesBelow(fileSystem, directory);
    const stamp: Stamp = { kind: "tree", fingerprint: fingerprint(listed) };
    if (held?.stamp.kind === "tree" && held.stamp.fingerprint === stamp.fingerprint) return held;
    const built = yield* buildPack(
      treeInFolder(fileSystem, root),
      help,
      stamp,
      listed.map((file) => file.path),
    );
    yield* Effect.ignore(writePack(fileSystem, root, built));
    return built;
  });

/** The small files a packed root keeps beside its packs: what it is, and its licence. */
const KEPT = ["manifest.yaml", "LICENSE.md", "README.md", "media.yaml"] as const;

/**
 * A raw help tree, packed into a root that will hold ONLY packs: the Web's
 * import, from a clone's objects (`treeOfCommit`) or a staged folder
 * (`treeInFolder`) to OPFS. Every book is built from `from` and written to
 * `to`, each written pack is read back and must decode, and the manifest and
 * licence are copied — 29,300 files in, about seventy out. On any failure
 * `to.root` is removed: nothing half-packed is ever left to be registered.
 */
export const packHelp = (
  from: UpstreamTree,
  to: { readonly fileSystem: FileSystem.FileSystem; readonly root: string },
  provenance: { readonly at: string; readonly commit?: string },
  onBook?: (progress: PackProgress) => void,
): Effect.Effect<{ readonly books: number; readonly notes: number }, Unavailable> =>
  Effect.onError(
    Effect.gen(function* () {
      const books = yield* manifestOf(from);
      yield* Effect.mapError(to.fileSystem.makeDirectory(to.root, { recursive: true }), (error) =>
        unavailable("Unreadable", `${to.root}: ${error.message}`),
      );
      for (const name of KEPT) {
        const bytes = yield* from.file(name);
        if (bytes === undefined) continue;
        yield* Effect.mapError(to.fileSystem.writeFile(joinPath(to.root, name), bytes), (error) =>
          unavailable("Unreadable", `${name}: ${error.message}`),
        );
      }
      const stamp: Stamp = {
        kind: "import",
        at: provenance.at,
        ...(provenance.commit === undefined ? {} : { commit: provenance.commit }),
      };
      // One book at a time: four at once measured slower (pack 5.9 s against
      // 3.8 s for en_tn on OPFS, 2026-10-12); the work is CPU-bound in one
      // thread, and there are only 66 writes.
      let done = 0;
      const counts = yield* Effect.forEach(
        books,
        (help) =>
          Effect.gen(function* () {
            onBook?.({ done, of: books.length, book: help.book });
            const files = yield* from.below(help.path);
            // A manifest may list a book its tree does not hold; the pack
            // simply is not there, and that book answers `Missing`.
            if (files.length === 0) return 0;
            const pack = yield* buildPack(from, help, stamp, files);
            yield* writePack(to.fileSystem, to.root, pack);
            yield* readsBack(to.fileSystem, to.root, pack);
            done += 1;
            return pack.notes.length;
          }),
        { concurrency: 1 },
      );
      const notes = counts.reduce((sum, count) => sum + count, 0);
      onBook?.({ done: books.length, of: books.length, book: "" });
      return { books: books.length, notes };
    }),
    () => Effect.ignore(to.fileSystem.remove(to.root, { recursive: true })),
  );
