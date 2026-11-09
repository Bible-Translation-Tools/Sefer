import { read as readManifest } from "@wycliffeassociates/scripture-kitchen/bento";
import * as TextResult from "@wycliffeassociates/sefer-text/result";
import { decode } from "@wycliffeassociates/sefer-text/source";
import { Effect, FileSystem } from "effect";

import { joinPath, lastSegment } from "../fileSystem/path";
import { unreadable } from "../resources/projectMetadata";
import type { RelatedResource } from "../resources/relationships";

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

const readText = (
  fileSystem: FileSystem.FileSystem,
  path: string,
): Effect.Effect<string | undefined> =>
  Effect.orElseSucceed(
    Effect.map(fileSystem.readFile(path), (bytes) => {
      const text = decode(bytes);
      return TextResult.isSuccess(text) ? text.success.text : undefined;
    }),
    () => undefined,
  );

/**
 * The Writer book project at `root`, from its `manifest.json` as bento reads
 * it: a book of canon's table, a language and a resource (the folder name's
 * last part when the manifest names none, as Writer names its folders).
 */
export const recognizeWriter = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<WriterProject | undefined> =>
  Effect.gen(function* () {
    const bytes = yield* Effect.orElseSucceed(
      fileSystem.readFile(joinPath(root, "manifest.json")),
      () => undefined,
    );
    if (bytes === undefined) return undefined;
    const read = readManifest("manifest.json", bytes);
    if (unreadable(read) || read.manifest === undefined || read.detail?.format !== "bttwriter")
      return undefined;
    const { manifest } = read;
    const written = read.detail.document;
    const book = manifest.books[0]?.book;
    const language = manifest.language.tag.trim();
    const resource =
      manifest.kind.declared.identifier?.trim() ||
      (lastSegment(root).split("_").at(-1) ?? "").trim();
    if (book === undefined || language === "" || resource === "") return undefined;
    return {
      root,
      book,
      language: {
        id: language,
        name: written.target_language?.name,
        direction: manifest.language.direction,
      },
      resource: resource.toLowerCase(),
      sources: manifest.sources,
      translators: written.translators ?? [],
    };
  });

const numbered = (name: string): number | undefined =>
  /^\d{2,3}$/.test(name) && Number(name) > 0 ? Number(name) : undefined;

/*
 * The template below renders Writer files that are not a history bttwriter
 * replays: a folder or zip copied without `.git`, and the upstream work
 * `writerWork.ts` compares after a migration (the files at the migrated
 * commit and at the upstream's head, on the project screen, where bttwriter
 * is not loaded). A migrated book's history is rendered by bttwriter
 * (`WriterHistory.usfm()`). The kitchen's wasm has no entry that stitches
 * files without a history, so this copy stays until it has one.
 */
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
