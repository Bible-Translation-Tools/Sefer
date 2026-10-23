import { decode } from "@sefer/text/source";
import { Effect, FileSystem, Result, Schema } from "effect";

import { writeFileStringAtomic } from "../../../fileSystem/atomic";
import { joinPath, normalisePath } from "../../../fileSystem/path";
import { readResourceContainerManifest } from "../../projectMetadata";
import { Unavailable } from "../handle";
import { filesBelow, treeInFolder, type PackProgress, type UpstreamTree } from "../tree";
import { readHelpBook, type BookFile } from "./rcHelpMarkdown";

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
  Schema.Struct({ kind: Schema.Literal("tree"), fingerprint: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("import"),
    at: Schema.String,
    commit: Schema.optionalKey(Schema.String),
  }),
]);

const PackSchema = Schema.Struct({
  format: Schema.Literal("sefer.tn.pack"),
  version: Schema.Literal(PACK_VERSION),
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
  skipped: Schema.Array(Schema.String),
});

export type Pack = typeof PackSchema.Type;
type Stamp = typeof StampSchema.Type;

const decodePack = Schema.decodeUnknownResult(PackSchema);

export interface HelpBook {
  readonly book: string;
  readonly path: string;
}

const unavailable = (reason: Unavailable["reason"], description: string): Unavailable =>
  new Unavailable({ reason, description });

const packPath = (root: string, book: string): string =>
  joinPath(root, `${PACK_DIR}/${book.toUpperCase()}.json`);

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

export const helpBooks = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<readonly HelpBook[], Unavailable> => manifestOf(treeInFolder(fileSystem, root));

const fingerprint = (
  files: readonly { readonly path: string; readonly size: number; readonly mtime: number }[],
): string => {
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

export const indexHelp = (
  fileSystem: FileSystem.FileSystem,
  root: string,
  onBook?: (progress: PackProgress) => void,
): Effect.Effect<{ readonly books: number; readonly notes: number }, Unavailable> =>
  Effect.gen(function* () {
    const books = yield* helpBooks(fileSystem, root);
    let notes = 0;
    for (const [done, help] of books.entries()) {
      onBook?.({ done, of: books.length, book: help.book });
      const pack = yield* Effect.option(bookPack(fileSystem, root, help));
      if (pack._tag === "Some") notes += pack.value.notes.length;
    }
    onBook?.({ done: books.length, of: books.length, book: "" });
    return { books: books.length, notes };
  });

const KEPT = ["manifest.yaml", "LICENSE.md", "README.md", "media.yaml"] as const;

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
