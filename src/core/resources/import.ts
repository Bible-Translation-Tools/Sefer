import { decode } from "@sefer/text/source";
import { Data, Effect, FileSystem, Result, type PlatformError } from "effect";

import { joinPath, lastSegment, parentPath } from "../fileSystem/path";
import { appendArrival } from "../project/provenance";
import { decodeBurritoMetadata } from "./burrito";
import { readResourceContainerManifest } from "./projectMetadata";
import { decodeResourceContainerManifest } from "./resourceContainer";

export type Classification = "burrito" | "resourceContainer" | "looseUsfm" | "unknown";

export interface Staged {
  readonly stageId: string;
  readonly root: string;
  readonly sources: readonly string[];
  readonly files: readonly string[];
}

type ImportRefusal = "Unreadable" | "Unclassified" | "InvalidBook" | "Io";

class ImportError extends Data.TaggedError("ImportError")<{
  readonly reason: ImportRefusal;
  readonly description: string;
}> {}

const refuse = (reason: ImportRefusal, description: string): ImportError =>
  new ImportError({ reason, description });

const io =
  (path: string) =>
  (error: PlatformError.PlatformError): ImportError =>
    refuse("Io", `${path}: ${error.message}`);

const unreadable =
  (path: string) =>
  (error: PlatformError.PlatformError): ImportError =>
    refuse("Unreadable", `${path}: ${error.message}`);

const isUsfm = (path: string): boolean => path.toLowerCase().endsWith(".usfm");

const filesUnder = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<readonly string[], PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const entries = yield* fileSystem.readDirectory(root, { recursive: true });
    const files: string[] = [];
    for (const entry of entries) {
      const info = yield* fileSystem.stat(joinPath(root, entry));
      if (info.type === "File") files.push(entry);
    }
    return files.sort();
  });

export const stage = (
  fileSystem: FileSystem.FileSystem,
  paths: readonly string[],
  stagingRoot: string,
): Effect.Effect<Staged, ImportError> =>
  Effect.gen(function* () {
    if (paths.length === 0) return yield* Effect.fail(refuse("Unclassified", "no paths to import"));

    yield* Effect.mapError(
      fileSystem.makeDirectory(stagingRoot, { recursive: true }),
      io(stagingRoot),
    );
    const root = yield* Effect.mapError(
      fileSystem.makeTempDirectory({ directory: stagingRoot, prefix: "stage-" }),
      io(stagingRoot),
    );

    for (const path of paths) {
      const info = yield* Effect.mapError(fileSystem.stat(path), unreadable(path));
      if (info.type === "Directory") {
        const entries = yield* Effect.mapError(fileSystem.readDirectory(path), unreadable(path));
        for (const entry of entries)
          yield* Effect.mapError(
            fileSystem.copy(joinPath(path, entry), joinPath(root, entry)),
            io(entry),
          );
        continue;
      }
      yield* Effect.mapError(
        fileSystem.copy(path, joinPath(root, lastSegment(path))),
        io(lastSegment(path)),
      );
    }

    const files = yield* Effect.mapError(filesUnder(fileSystem, root), io(root));
    return { stageId: lastSegment(root), root, sources: paths, files };
  });

const parseJson = (text: string): unknown => JSON.parse(text);

export const readJson = (
  fileSystem: FileSystem.FileSystem,
  path: string,
): Effect.Effect<unknown | undefined> =>
  Effect.map(Effect.result(Effect.map(fileSystem.readFileString(path), parseJson)), (result) =>
    Result.isSuccess(result) ? result.success : undefined,
  );

const readTextOrEmpty = (fileSystem: FileSystem.FileSystem, path: string): Effect.Effect<string> =>
  Effect.orElseSucceed(fileSystem.readFileString(path), () => "");

export const classify = (
  fileSystem: FileSystem.FileSystem,
  staged: { readonly root: string },
): Effect.Effect<Classification> =>
  Effect.gen(function* () {
    const { root } = staged;

    const metadata = yield* readJson(fileSystem, joinPath(root, "metadata.json"));
    if (metadata !== undefined && Result.isSuccess(decodeBurritoMetadata(metadata)))
      return "burrito";

    const manifest = yield* readJson(fileSystem, joinPath(root, "manifest.json"));
    if (manifest !== undefined && Result.isSuccess(decodeResourceContainerManifest(manifest)))
      return "resourceContainer";

    const yaml = yield* readTextOrEmpty(fileSystem, joinPath(root, "manifest.yaml"));
    if (yaml !== "" && Result.isSuccess(readResourceContainerManifest(yaml)))
      return "resourceContainer";

    const files = yield* Effect.orElseSucceed(
      filesUnder(fileSystem, root),
      (): readonly string[] => [],
    );
    return files.some(isUsfm) ? "looseUsfm" : "unknown";
  });

export const commit = (
  fileSystem: FileSystem.FileSystem,
  staged: Staged,
  into: { readonly root: string },
  via: "zip" | "folder",
): Effect.Effect<readonly string[], ImportError> =>
  Effect.gen(function* () {
    const classification = yield* classify(fileSystem, staged);
    if (classification === "unknown")
      return yield* Effect.fail(
        refuse(
          "Unclassified",
          `${staged.stageId} is neither a Burrito, a Resource Container nor USFM`,
        ),
      );

    const books = staged.files.filter(isUsfm);
    if (books.length === 0)
      return yield* Effect.fail(refuse("Unclassified", `${staged.stageId} holds no .usfm file`));

    for (const book of books) {
      const bytes = yield* Effect.mapError(
        fileSystem.readFile(joinPath(staged.root, book)),
        unreadable(book),
      );
      const source = decode(bytes);
      if (Result.isFailure(source))
        return yield* Effect.fail(refuse("InvalidBook", `${book}: ${source.failure.description}`));
    }

    yield* Effect.mapError(
      appendArrival(fileSystem, into.root, {
        via,
        stageId: staged.stageId,
        sources: staged.sources,
        classification,
        books,
      }),
      io(`${into.root}/.sefer/provenance.json`),
    );

    for (const file of staged.files) {
      const destination = joinPath(into.root, file);
      yield* Effect.mapError(
        fileSystem.makeDirectory(parentPath(destination), { recursive: true }),
        io(destination),
      );
      yield* Effect.mapError(
        fileSystem.copy(joinPath(staged.root, file), destination, { overwrite: true }),
        io(destination),
      );
    }

    yield* Effect.mapError(
      fileSystem.remove(staged.root, { recursive: true, force: true }),
      io(staged.root),
    );

    return books;
  });
