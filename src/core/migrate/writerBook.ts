import {
  writerProject,
  type WriterProject as Bento,
} from "@wycliffeassociates/scripture-kitchen/bento";
import * as TextResult from "@wycliffeassociates/sefer-text/result";
import { decode } from "@wycliffeassociates/sefer-text/source";
import { Effect, FileSystem } from "effect";

import { joinPath, lastSegment } from "../fileSystem/path";

/** A Writer book project as bento reads it, and the folder it was read from. */
export type WriterProject = Bento & { readonly root: string };

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
 * The Writer book project at `root`: bento's `writerProject` over its
 * `manifest.json` (a book of canon's table, a language, and a resource, the
 * folder name's last part when the manifest names none, as Writer names its
 * folders), with the root it was read from.
 */
export const recognizeWriter = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<WriterProject | undefined> =>
  Effect.map(
    Effect.orElseSucceed(fileSystem.readFile(joinPath(root, "manifest.json")), () => undefined),
    (bytes) => {
      const project = bytes === undefined ? undefined : writerProject(bytes, lastSegment(root));
      return project === undefined ? undefined : { root, ...project };
    },
  );

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
