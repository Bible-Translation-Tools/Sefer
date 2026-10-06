/**
 * A BTT Writer book project, read and turned into one USFM book.
 *
 * Writer kept one project per book, in its own shape:
 *
 *   manifest.json        target_language, project (the book), resource,
 *                        source_translations, translators
 *   front/title.txt      the book's title, one line per \mt
 *   NN/title.txt         a chapter's label, when it has one
 *   NN/NN.txt            the chunks, as inline USFM fragments; the first
 *                        chunk of a chapter carries its \c
 *
 * Sefer does not keep this shape. It is read once, on the way in, and what
 * arrives is a spec USFM file. The app is not built around the old tool.
 *
 * ONE TEMPLATE, and it copies structure only: the header usfm-tools'
 * `txt2USFM.py` writes (`writeHeader`), then the chapters and chunks in
 * numeric order. It does not repair the translator's text — no verse-marker
 * fixes, no `\p` added or removed, no title-casing, no guessed headings —
 * even where txt2USFM does. People must not learn to expect normalising on
 * the way in; a repair is a fix they see and choose later (Will, 2026-10-06).
 *
 * The manifest is read LENIENTLY: only the book, the language and a resource
 * are required. `package_version`, `generator` and anything else are carried
 * or ignored, never a reason to refuse.
 */

import { Effect, FileSystem, Result, Schema } from "effect";

import { joinPath, lastSegment } from "../fileSystem/path";
import { CANON } from "../location/canon";
import { fromWriterSourceTranslations, type RelatedResource } from "../resources/relationships";
import { decode } from "../source/source";

const Manifest = Schema.Struct({
  target_language: Schema.Struct({
    id: Schema.String,
    name: Schema.optionalKey(Schema.String),
    direction: Schema.optionalKey(Schema.String),
  }),
  project: Schema.Struct({ id: Schema.String, name: Schema.optionalKey(Schema.String) }),
  resource: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.String) })),
  source_translations: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        language_id: Schema.String,
        resource_id: Schema.String,
        version: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
  translators: Schema.optionalKey(Schema.Array(Schema.String)),
});

const decodeManifest = Schema.decodeUnknownResult(Manifest);

/** What a Writer project says about itself, once its manifest decodes. */
export interface WriterProject {
  readonly root: string;
  /** The claimed book, upper case: `1JN`. */
  readonly book: string;
  readonly language: {
    readonly id: string;
    readonly name: string | undefined;
    readonly direction: "ltr" | "rtl";
  };
  /** `resource.id`, else the folder name's last part (`…_text_reg` → `reg`). */
  readonly resource: string;
  readonly sources: readonly RelatedResource[];
  readonly translators: readonly string[];
}

/** The book's parts, read off disk in numeric order. Pure data for the template. */
export interface WriterTree {
  /** `front/title.txt`, one entry per non-empty line. */
  readonly title: readonly string[];
  readonly chapters: readonly {
    readonly number: number;
    /** `NN/title.txt`, when it says something other than the number. */
    readonly label: string | undefined;
    readonly chunks: readonly string[];
  }[];
}

const isKnownBook = (id: string): boolean => CANON.some((book) => book.id === id);

const readText = (
  fileSystem: FileSystem.FileSystem,
  path: string,
): Effect.Effect<string | undefined> =>
  Effect.orElseSucceed(
    Effect.map(fileSystem.readFile(path), (bytes) => {
      const text = decode(bytes);
      return Result.isSuccess(text) ? text.success.text : undefined;
    }),
    () => undefined,
  );

/**
 * A Writer project at `root`, or `undefined` when it is not one: no
 * `manifest.json`, a manifest without a book, language or resource, or a book
 * id that is not in the canon.
 */
export const recognizeWriter = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<WriterProject | undefined> =>
  Effect.gen(function* () {
    const text = yield* readText(fileSystem, joinPath(root, "manifest.json"));
    if (text === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return undefined;
    }
    const decoded = decodeManifest(parsed);
    if (Result.isFailure(decoded)) return undefined;
    const manifest = decoded.success;
    const book = manifest.project.id.trim().toUpperCase();
    const resource =
      manifest.resource?.id?.trim() || (lastSegment(root).split("_").at(-1) ?? "").trim();
    if (!isKnownBook(book) || manifest.target_language.id.trim() === "" || resource === "")
      return undefined;
    return {
      root,
      book,
      language: {
        id: manifest.target_language.id.trim(),
        name: manifest.target_language.name,
        direction: manifest.target_language.direction === "rtl" ? "rtl" : "ltr",
      },
      resource: resource.toLowerCase(),
      sources: fromWriterSourceTranslations(manifest.source_translations ?? []),
      translators: manifest.translators ?? [],
    };
  });

/** `01`, `150`; not `00`, which Writer uses for front matter. */
const numbered = (name: string): number | undefined =>
  /^\d{2,3}$/.test(name) && Number(name) > 0 ? Number(name) : undefined;

/** Reads the parts the template needs, in numeric order. */
export const readWriterTree = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<WriterTree> =>
  Effect.gen(function* () {
    const title = ((yield* readText(fileSystem, joinPath(root, "front/title.txt"))) ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "");
    const names = yield* Effect.orElseSucceed(
      fileSystem.readDirectory(root),
      (): readonly string[] => [],
    );
    const chapterNumbers = names
      .map((name) => ({ name, number: numbered(name) }))
      .filter((entry): entry is { name: string; number: number } => entry.number !== undefined)
      .sort((a, b) => a.number - b.number);
    const chapters: WriterTree["chapters"][number][] = [];
    for (const chapter of chapterNumbers) {
      const directory = joinPath(root, chapter.name);
      const files = yield* Effect.orElseSucceed(
        fileSystem.readDirectory(directory),
        (): readonly string[] => [],
      );
      const chunkFiles = files
        .map((file) => ({ file, number: numbered(file.replace(/\.txt$/i, "")) }))
        .filter(
          (entry): entry is { file: string; number: number } =>
            /\.txt$/i.test(entry.file) && entry.number !== undefined,
        )
        .sort((a, b) => a.number - b.number);
      const chunks: string[] = [];
      for (const chunk of chunkFiles) {
        const text = yield* readText(fileSystem, joinPath(directory, chunk.file));
        if (text !== undefined) chunks.push(text);
      }
      const label = ((yield* readText(fileSystem, joinPath(directory, "title.txt"))) ?? "").trim();
      chapters.push({
        number: chapter.number,
        label: label === "" || label === String(chapter.number) ? undefined : label,
        chunks,
      });
    }
    return { title, chapters };
  });

/**
 * A chunk's own leading `\c N`, every one of them: the template writes the
 * chapter marker once. Writer sometimes saved it twice (`\c 3 \c 3 \v 1`,
 * Moffat_chola's bwc REV), and the second made the book unreadable to the
 * engine. That marker is Writer's chunk framing, not the translator's text.
 */
const withoutChapterMarker = (chunk: string): string => chunk.replace(/^(?:\s*\\c\s+\d+\s*)+/, "");

/**
 * The template. Header as txt2USFM's `writeHeader` writes it (`\toc3` is the
 * book id in lower case; one `\mt` per title line), then each chapter: `\c`,
 * `\cl` when the chapter has its own label, then its chunks as written.
 * `book` is the claimed id; Writer's chunks carry no `\id`.
 */
export const writerBookToUsfm = (tree: WriterTree, book: string, fallbackTitle: string): string => {
  const title = tree.title.length > 0 ? tree.title : [fallbackTitle];
  const head = title[0] ?? fallbackTitle;
  const lines = [
    `\\id ${book}`,
    "\\ide UTF-8",
    `\\h ${head}`,
    `\\toc1 ${head}`,
    `\\toc2 ${head}`,
    `\\toc3 ${book.toLowerCase()}`,
    ...title.map((line, index) => `\\mt${String(index + 1)} ${line}`),
  ];
  for (const chapter of tree.chapters) {
    lines.push(`\\c ${String(chapter.number)}`);
    if (chapter.label !== undefined) lines.push(`\\cl ${chapter.label}`);
    chapter.chunks.forEach((chunk, index) => {
      const text = (index === 0 ? withoutChapterMarker(chunk) : chunk).trim();
      if (text !== "") lines.push(text);
    });
  }
  return `${lines.join("\n")}\n`;
};

/** `44-JHN.usfm`: the RC file name, numbered as the catalogue numbers books (MAT is 41). */
export const usfmFileName = (book: string): string => {
  const index = CANON.findIndex((entry) => entry.id === book);
  const number = index < 39 ? index + 1 : index + 2;
  return `${String(number).padStart(2, "0")}-${book}.usfm`;
};
