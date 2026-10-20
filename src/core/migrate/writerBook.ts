import { CANON } from "@sefer/text/location/canon";
import { decode } from "@sefer/text/source";
import { Effect, FileSystem, Result, Schema } from "effect";

import { joinPath, lastSegment } from "../fileSystem/path";
import { fromWriterSourceTranslations, type RelatedResource } from "../resources/relationships";

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

export interface WriterProject {
  readonly root: string;
  readonly book: string;
  readonly language: {
    readonly id: string;
    readonly name: string | undefined;
    readonly direction: "ltr" | "rtl";
  };
  readonly resource: string;
  readonly sources: readonly RelatedResource[];
  readonly translators: readonly string[];
}

export interface WriterTree {
  readonly title: readonly string[];
  readonly chapters: readonly {
    readonly number: number;
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

const numbered = (name: string): number | undefined =>
  /^\d{2,3}$/.test(name) && Number(name) > 0 ? Number(name) : undefined;

export const isWriterTextPath = (path: string): boolean =>
  path === "front/title.txt" || /^\d{2,3}\/(?:title|\d{2,3})\.txt$/i.test(path);

export const treeFromFiles = (files: ReadonlyMap<string, string>): WriterTree => {
  const title = (files.get("front/title.txt") ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const byChapter = new Map<number, { label: string | undefined; chunks: [number, string][] }>();
  for (const [path, text] of files) {
    const match = /^(\d{2,3})\/(title|\d{2,3})\.txt$/i.exec(path);
    const chapter = match === null ? undefined : numbered(match[1] ?? "");
    if (match === null || chapter === undefined) continue;
    const held = byChapter.get(chapter) ?? { label: undefined, chunks: [] };
    if (match[2]?.toLowerCase() === "title") held.label = text.trim();
    else {
      const chunk = numbered(match[2] ?? "");
      if (chunk !== undefined) held.chunks.push([chunk, text]);
    }
    byChapter.set(chapter, held);
  }
  const chapters = [...byChapter.entries()]
    .filter(([, held]) => held.chunks.length > 0)
    .sort(([a], [b]) => a - b)
    .map(([number, held]) => ({
      number,
      label:
        held.label === undefined || held.label === "" || held.label === String(number)
          ? undefined
          : held.label,
      chunks: held.chunks.sort(([a], [b]) => a - b).map(([, text]) => text),
    }));
  return { title, chapters };
};

const READ_AT_ONCE = 32;

export const readWriterTree = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<WriterTree> =>
  Effect.gen(function* () {
    const files = new Map<string, string>();
    const take = (path: string) =>
      Effect.map(readText(fileSystem, joinPath(root, path)), (text) => {
        if (text !== undefined) files.set(path, text);
      });
    yield* take("front/title.txt");
    const names = yield* Effect.orElseSucceed(
      fileSystem.readDirectory(root),
      (): readonly string[] => [],
    );
    const listed = yield* Effect.forEach(
      names.filter((name) => numbered(name) !== undefined),
      (chapter) =>
        Effect.map(
          Effect.orElseSucceed(
            fileSystem.readDirectory(joinPath(root, chapter)),
            (): readonly string[] => [],
          ),
          (inside) => inside.map((file) => `${chapter}/${file}`).filter(isWriterTextPath),
        ),
      { concurrency: READ_AT_ONCE },
    );
    yield* Effect.forEach(listed.flat(), take, { concurrency: READ_AT_ONCE, discard: true });
    return treeFromFiles(files);
  });

const withoutChapterMarker = (chunk: string): string => chunk.replace(/^(?:\s*\\c\s+\d+\s*)+/, "");

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

export const usfmFileName = (book: string): string => {
  const index = CANON.findIndex((entry) => entry.id === book);
  const number = index < 39 ? index + 1 : index + 2;
  return `${String(number).padStart(2, "0")}-${book}.usfm`;
};
