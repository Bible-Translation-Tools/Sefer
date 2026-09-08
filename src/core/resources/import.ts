// import.ts
//
// Resource import: the three-step seam that gets foreign bytes into a project
// without ever letting an unvalidated file land there. `stage` copies what the
// user picked into a staging directory, `classify` decides what it is from the
// files themselves, and `commit` validates every book, records provenance and
// only then copies into the project root. Nothing between `stage` and `commit`
// touches the project, so an abandoned or refused import leaves no trace but a
// staging directory the host may sweep.
//
// The module reads and writes only through the `effect/FileSystem` port, so the
// same code imports from a Node folder, an OPFS handle or the in-memory
// fixture. It records no content hash: identity of text belongs to the engine's
// xxh3 at the Galley boundary, never to core (see documentation/architecture/source.md).

import { Data, Effect, FileSystem, Result, type PlatformError } from "effect";

import { writeFileStringAtomic } from "../fileSystem/atomic";
import { joinPath, parentPath } from "../fileSystem/path";
import { decode } from "../source/source";
import { decodeBurritoMetadata } from "./burrito";
import { decodeResourceContainerManifest } from "./resourceContainer";

/**
 * What a staged directory looks like once it has been read.
 *
 * `burrito` and `resourceContainer` are decided by a metadata file that decodes
 * against the schemas in this folder; `looseUsfm` is the fallback for a bare
 * folder or selection of `.usfm` files. `unknown` is the refusal: a caller must
 * not guess, and `commit` fails on it.
 */
export type Classification = "burrito" | "resourceContainer" | "looseUsfm" | "unknown";

/** A staging directory holding a copy of what the user picked. */
export interface Staged {
  /** The last segment of `root`; also the provenance key for this import. */
  readonly stageId: string;
  /** `<stagingRoot>/<stageId>` — absolute in whatever the port's root is. */
  readonly root: string;
  /** The paths the user picked, kept for provenance. */
  readonly sources: readonly string[];
  /** Every staged file, relative to `root`, sorted. Directories excluded. */
  readonly files: readonly string[];
}

export type ImportRefusal = "Unreadable" | "Unclassified" | "InvalidBook" | "Io";

export class ImportError extends Data.TaggedError("ImportError")<{
  readonly reason: ImportRefusal;
  readonly description: string;
}> {}

const PROVENANCE_PATH = ".sefer/provenance.json";

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

const lastSegment = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const isUsfm = (path: string): boolean => path.toLowerCase().endsWith(".usfm");

/** Files, relative to `root` and sorted; a directory entry is not a file. */
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

/**
 * Copies each picked path into a fresh staging directory under `stagingRoot`.
 * A directory contributes its *contents* (so importing a Resource Container
 * folder puts `manifest.yaml` at the staging root, not one level down); a file
 * contributes itself under its own name. The staging directory is created
 * through the port's `makeTempDirectory`, which is how core gets a fresh name
 * without owning a source of randomness.
 */
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

/** JSON.parse narrowed to `unknown`: what comes off disk is untyped until decoded. */
const parseJson = (text: string): unknown => JSON.parse(text);

/** Reads and JSON-parses a file, or `undefined` when it is absent or not JSON. */
const readJson = (
  fileSystem: FileSystem.FileSystem,
  path: string,
): Effect.Effect<unknown | undefined> =>
  Effect.map(Effect.result(Effect.map(fileSystem.readFileString(path), parseJson)), (result) =>
    Result.isSuccess(result) ? result.success : undefined,
  );

const readTextOrEmpty = (fileSystem: FileSystem.FileSystem, path: string): Effect.Effect<string> =>
  Effect.orElseSucceed(fileSystem.readFileString(path), () => "");

// There is no YAML parser dependency in Sefer, and adding one to decide a
// classification would be a large dependency for a small question. So a
// `manifest.yaml` counts as a Resource Container on textual evidence only: its
// first lines declare `dublin_core:` at column zero, which every RC manifest
// does. (A `manifest.json` sibling is the stronger signal and is checked first,
// because that value can actually be decoded against the schema.) When the
// manifest is really parsed — at commit-to-project time, by whoever needs its
// projects list — that reader supplies the YAML.
const YAML_DUBLIN_CORE = /^dublin_core\s*:/m;

const looksLikeResourceContainerYaml = (text: string): boolean =>
  YAML_DUBLIN_CORE.test(text.split("\n").slice(0, 20).join("\n"));

/**
 * Decides what a staged (or already-on-disk) resource root holds. Never fails:
 * an unreadable or undecodable candidate simply is not that kind, and the
 * answer degrades to `looseUsfm` or `unknown`. Takes anything with a `root` so
 * the Library can classify a folder it did not stage.
 */
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
    if (looksLikeResourceContainerYaml(yaml)) return "resourceContainer";

    const files = yield* Effect.orElseSucceed(
      filesUnder(fileSystem, root),
      (): readonly string[] => [],
    );
    return files.some(isUsfm) ? "looseUsfm" : "unknown";
  });

interface ProvenanceRecord {
  readonly stageId: string;
  readonly sources: readonly string[];
  readonly classification: Classification;
  /** ISO-8601, from the host clock; provenance is a fact about the import. */
  readonly at: string;
  /** Book paths relative to the project root, as committed. */
  readonly books: readonly string[];
}

/**
 * Reads the existing provenance list. A missing or unparseable file is an empty
 * list rather than a failure: provenance is a record, and losing the record
 * must not block an import. Entries stay `unknown` because this module only
 * ever appends to the list and writes it back — nothing reads a past record's
 * fields, so nothing needs to trust their shape.
 */
const readProvenance = (
  fileSystem: FileSystem.FileSystem,
  path: string,
): Effect.Effect<readonly unknown[]> =>
  Effect.map(readJson(fileSystem, path), (value) => (Array.isArray(value) ? value : []));

/**
 * Validates every staged book, records provenance and copies the staged files
 * into the project. Returns the committed book paths (relative to
 * `into.root`), in the order they will be read.
 *
 * Refuses before writing anything: `Unclassified` when `classify` cannot say
 * what the staging directory is or it holds no book, `InvalidBook` when a
 * `.usfm` file is not canonical UTF-8 text. Provenance is written first (so a
 * half-copied project still says where its files came from) and the staging
 * directory is removed last, which makes the whole thing a move.
 */
export const commit = (
  fileSystem: FileSystem.FileSystem,
  staged: Staged,
  into: { readonly root: string },
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

    const provenancePath = joinPath(into.root, PROVENANCE_PATH);
    const existing = yield* readProvenance(fileSystem, provenancePath);
    const record: ProvenanceRecord = {
      stageId: staged.stageId,
      sources: staged.sources,
      classification,
      at: new Date(Date.now()).toISOString(),
      books,
    };
    yield* Effect.mapError(
      fileSystem.makeDirectory(parentPath(provenancePath), { recursive: true }),
      io(provenancePath),
    );
    yield* Effect.mapError(
      writeFileStringAtomic(
        fileSystem,
        provenancePath,
        `${JSON.stringify([...existing, record], undefined, 2)}\n`,
      ),
      io(provenancePath),
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
