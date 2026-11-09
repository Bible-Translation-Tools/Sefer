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

/**
 * Every text file of one Writer book project (`front/title.txt`, `05/03.txt`),
 * as bttwriter's `stitch` reads them: for a folder without `.git`, and for the
 * upstream work `writerWork.ts` compares after a migration.
 */
export const isWriterTextPath = (path: string): boolean =>
  path === "front/title.txt" || /^\d{2,3}\/(?:title|\d{2,3})\.txt$/i.test(path);

export const readWriterFiles = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<ReadonlyMap<string, string>> =>
  Effect.gen(function* () {
    const out = new Map<string, string>();
    const entries = yield* Effect.orElseSucceed(
      fileSystem.readDirectory(root, { recursive: true }),
      (): readonly string[] => [],
    );
    for (const path of entries.filter(isWriterTextPath)) {
      const read = yield* readText(fileSystem, joinPath(root, path));
      if (read !== undefined) out.set(path, read);
    }
    return out;
  });
