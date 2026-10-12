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
import { escapesRoot, joinPath } from "../../../fileSystem/path";
import { decode } from "../../../source/source";
import { readResourceContainerManifest } from "../../projectMetadata";
import { Unavailable } from "../handle";
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

/**
 * The books a help declares, from its `manifest.yaml`'s `projects[]`. A path
 * that leaves the root is refused, never followed.
 */
export const helpBooks = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<readonly HelpBook[], Unavailable> =>
  Effect.gen(function* () {
    const text = yield* Effect.mapError(
      fileSystem.readFileString(joinPath(root, "manifest.yaml")),
      (error) => unavailable("Unreadable", `manifest.yaml: ${error.message}`),
    );
    const manifest = readResourceContainerManifest(text);
    if (Result.isFailure(manifest))
      return yield* Effect.fail(unavailable("Unreadable", manifest.failure.description));
    const books: HelpBook[] = [];
    for (const project of manifest.success.projects) {
      const resolved = joinPath(root, project.path);
      if (escapesRoot(root, resolved))
        return yield* Effect.fail(
          unavailable("Unreadable", `${project.identifier}: ${project.path} leaves the resource`),
        );
      books.push({ book: project.identifier.toUpperCase(), path: project.path });
    }
    return books;
  });

/** Every file below `directory`, relative to it, sorted. */
const filesBelow = (
  fileSystem: FileSystem.FileSystem,
  directory: string,
): Effect.Effect<
  readonly { readonly path: string; readonly size: number; readonly mtime: number }[]
> =>
  Effect.gen(function* () {
    const entries = yield* Effect.orElseSucceed(
      fileSystem.readDirectory(directory, { recursive: true }),
      (): readonly string[] => [],
    );
    const files: { path: string; size: number; mtime: number }[] = [];
    for (const entry of [...entries].sort()) {
      const info = yield* Effect.option(fileSystem.stat(joinPath(directory, entry)));
      if (info._tag === "None" || info.value.type !== "File") continue;
      const mtime = info.value.mtime._tag === "Some" ? info.value.mtime.value.getTime() : 0;
      files.push({ path: entry.replaceAll("\\", "/"), size: Number(info.value.size), mtime });
    }
    return files;
  });

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

/** Reads one book's raw tree and runs the reader over it. */
const buildPack = (
  fileSystem: FileSystem.FileSystem,
  root: string,
  help: HelpBook,
  stamp: Stamp,
  listed?: readonly { readonly path: string }[],
): Effect.Effect<Pack, Unavailable> =>
  Effect.gen(function* () {
    const directory = joinPath(root, help.path);
    const files = listed ?? (yield* filesBelow(fileSystem, directory));
    const read: BookFile[] = [];
    for (const file of files) {
      const bytes = yield* Effect.mapError(
        fileSystem.readFile(joinPath(directory, file.path)),
        (error) => unavailable("Unreadable", `${help.book} ${file.path}: ${error.message}`),
      );
      const source = decode(bytes);
      if (Result.isFailure(source))
        return yield* Effect.fail(
          unavailable("Unreadable", `${help.book} ${file.path}: ${source.failure.description}`),
        );
      read.push({ path: file.path, text: source.success.text });
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

const readPack = (
  fileSystem: FileSystem.FileSystem,
  root: string,
  book: string,
): Effect.Effect<Pack | undefined> =>
  Effect.map(Effect.option(fileSystem.readFileString(packPath(root, book))), (text) => {
    if (text._tag === "None") return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.value);
    } catch {
      return undefined;
    }
    const decoded = decodePack(parsed);
    return Result.isSuccess(decoded) ? decoded.success : undefined;
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
    const held = yield* readPack(fileSystem, root, help.book);
    if (!raw) {
      if (held !== undefined) return held;
      return yield* Effect.fail(unavailable("Missing", `no notes for ${help.book}`));
    }
    const listed = yield* filesBelow(fileSystem, directory);
    const stamp: Stamp = { kind: "tree", fingerprint: fingerprint(listed) };
    if (held?.stamp.kind === "tree" && held.stamp.fingerprint === stamp.fingerprint) return held;
    const built = yield* buildPack(fileSystem, root, help, stamp, listed);
    yield* Effect.ignore(writePack(fileSystem, root, built));
    return built;
  });

/** The small files a packed root keeps beside its packs: what it is, and its licence. */
const KEPT = ["manifest.yaml", "LICENSE.md", "README.md", "media.yaml"] as const;

/**
 * A raw help tree, packed into a root that will hold ONLY packs: the Web's
 * import, from a clone staged in the in-memory FileSystem (`from`) to OPFS
 * (`to`). Every book is built from `from` and written to `to`, each written
 * pack is read back and must decode, and the manifest and licence are copied
 * — 29,300 files in, about seventy out. On any failure `toRoot` is removed:
 * nothing half-packed is ever left to be registered.
 */
export const packHelp = (
  from: { readonly fileSystem: FileSystem.FileSystem; readonly root: string },
  to: { readonly fileSystem: FileSystem.FileSystem; readonly root: string },
  provenance: { readonly at: string; readonly commit?: string },
): Effect.Effect<{ readonly books: number; readonly notes: number }, Unavailable> =>
  Effect.onError(
    Effect.gen(function* () {
      const books = yield* helpBooks(from.fileSystem, from.root);
      yield* Effect.mapError(to.fileSystem.makeDirectory(to.root, { recursive: true }), (error) =>
        unavailable("Unreadable", `${to.root}: ${error.message}`),
      );
      for (const name of KEPT) {
        const bytes = yield* Effect.option(from.fileSystem.readFile(joinPath(from.root, name)));
        if (bytes._tag === "None") continue;
        yield* Effect.mapError(
          to.fileSystem.writeFile(joinPath(to.root, name), bytes.value),
          (error) => unavailable("Unreadable", `${name}: ${error.message}`),
        );
      }
      const stamp: Stamp = {
        kind: "import",
        at: provenance.at,
        ...(provenance.commit === undefined ? {} : { commit: provenance.commit }),
      };
      let notes = 0;
      for (const help of books) {
        const exists = yield* Effect.orElseSucceed(
          from.fileSystem.exists(joinPath(from.root, help.path)),
          () => false,
        );
        // A manifest may list a book its tree does not hold; the pack simply
        // is not there, and that book answers `Missing`.
        if (!exists) continue;
        const pack = yield* buildPack(from.fileSystem, from.root, help, stamp);
        yield* writePack(to.fileSystem, to.root, pack);
        const back = yield* readPack(to.fileSystem, to.root, help.book);
        if (back === undefined)
          return yield* Effect.fail(
            unavailable("Unreadable", `${help.book}: the pack did not read back`),
          );
        notes += pack.notes.length;
      }
      return { books: books.length, notes };
    }),
    () => Effect.ignore(to.fileSystem.remove(to.root, { recursive: true })),
  );
