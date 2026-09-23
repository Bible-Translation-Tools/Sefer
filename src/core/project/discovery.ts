// discovery.ts
//
// Which files in a folder are books, and in what order. This is the whole of
// "Unloaded" in the four-state model (seams §3.3; editor-and-save §1.1): paths
// known, nothing read. Discovery is deliberately shallow — one `readDirectory`
// of the root — because a Sefer project is a folder of books, not a tree. The
// only way a nested path becomes a book is a Scripture Burrito's own
// `ingredients` table saying so, which is the burrito's declaration, not our
// guess.
//
// Nothing here reads book text or builds a `Book`; `openProject` does that.

import { Effect, FileSystem, Option, PlatformError, Result } from "effect";

import { joinPath, lastSegment, normalisePath } from "../fileSystem/path";
import { decodeBurritoMetadata, type BurritoMetadata } from "../resources/burrito";
import {
  fromBurrito,
  readResourceContainer,
  type ProjectMetadata,
} from "../resources/projectMetadata";

/** The burrito metadata file, read from directly under the project root. */
export const METADATA_FILE = "metadata.json";

/** The Resource Container manifest, the other way a project declares itself. */
export const MANIFEST_FILE = "manifest.yaml";

/**
 * The extensions a bare file in the root must carry to be a book. Matched
 * case-insensitively, so `.usfm`, `.USFM` and `.Usfm` are all books; `.sfm`
 * is the older Paratext spelling of the same thing.
 */
const BOOK_EXTENSIONS: readonly string[] = [".usfm", ".sfm"];

/**
 * The mime types a burrito ingredient may declare for USFM. `text/x-usfm` is
 * the registered spelling the Scripture Burrito examples use; `text/usfm`
 * appears in the wild (including `fixtures/resources/metadata.json`), so both
 * are honoured rather than averaged.
 */
const USFM_MIME_TYPES: ReadonlySet<string> = new Set(["text/x-usfm", "text/usfm"]);

const LEADING_NUMBER = /^(\d+)/;

const isBookFileName = (name: string): boolean => {
  const lower = name.toLowerCase();
  return BOOK_EXTENSIONS.some((extension) => lower.endsWith(extension));
};

const isUsfmIngredient = (name: string, mimeType: string): boolean =>
  USFM_MIME_TYPES.has(mimeType.toLowerCase()) || isBookFileName(name);

/**
 * Canonical order: the leading number in the file name when it has one
 * (`19-PSA.usfm` before `58-PHM.usfm`), then the name. Translators name book
 * files by their canon number, so the number is the intent and the name is
 * only the tiebreaker. Files with no leading number sort after every numbered
 * one, by name, so an unnumbered `extra.usfm` never lands in the middle of the
 * canon. Comparison is codepoint order, not locale order, so the same folder
 * lists the same way on every host.
 */
const canonicalOrder = (paths: readonly string[]): readonly string[] =>
  [...paths].sort((left, right) => {
    const leftName = lastSegment(left);
    const rightName = lastSegment(right);
    const leftNumber = LEADING_NUMBER.exec(leftName)?.[1];
    const rightNumber = LEADING_NUMBER.exec(rightName)?.[1];
    if (leftNumber !== undefined && rightNumber !== undefined) {
      const difference = Number(leftNumber) - Number(rightNumber);
      if (difference !== 0) return difference;
    } else if (leftNumber !== undefined) return -1;
    else if (rightNumber !== undefined) return 1;
    if (leftName !== rightName) return leftName < rightName ? -1 : 1;
    return left < right ? -1 : left > right ? 1 : 0;
  });

/** Why a project has no metadata Sefer could read, in a note's vocabulary. */
export type MetadataRefusal = "absent" | "unreadable" | "unparsable" | "notAKnownFormat";

export interface MetadataRead {
  /** What the application reads, whichever container it came from. */
  readonly metadata: Option.Option<ProjectMetadata>;
  /**
   * The BURRITO, when that is what this was.
   *
   * Narrower than `metadata` on purpose, and not a duplicate of it: the
   * ingredients table is a Burrito concept that a Resource Container has no
   * answer for, and it is what `discoverBooks` below reads to find a book that
   * is not directly under the root. Everything that does not need ingredients
   * should take `metadata` and stay indifferent to the format.
   */
  readonly burrito: Option.Option<BurritoMetadata>;
  /** Absent when the metadata decoded; otherwise why it did not. */
  readonly declined?: MetadataRefusal;
}

const NOTHING = { metadata: Option.none(), burrito: Option.none() } as const;

const readTextIfPresent = (
  fileSystem: FileSystem.FileSystem,
  path: string,
): Effect.Effect<Option.Option<string>, "unreadable"> =>
  Effect.gen(function* () {
    const present = yield* Effect.result(fileSystem.exists(path));
    if (Result.isFailure(present) || !present.success) return Option.none();
    const bytes = yield* Effect.result(fileSystem.readFile(path));
    if (Result.isFailure(bytes)) return yield* Effect.fail("unreadable" as const);
    return Option.some(new TextDecoder().decode(bytes.success));
  });

/**
 * A project's own declaration, from whichever of the two containers it uses.
 *
 *   metadata.json    Scripture Burrito
 *   manifest.yaml    Resource Container
 *
 * Burrito FIRST, and the order is a rule rather than a preference: it is the
 * format Sefer writes, so a project that carries both has been through Sefer
 * and its burrito is the newer statement. A Resource Container is only
 * consulted when there is no burrito to consult.
 *
 * Only the second half is new. Sefer read `metadata.json` and nothing else,
 * which is why `en_ulb` — a Resource Container, like most of what comes out of
 * the catalogue — showed a folder name for its title and an em dash for its
 * language. Both formats were already Effect schemas; what was missing was a
 * shape to decode them into (`resources/projectMetadata.ts`).
 *
 * Never fails: a folder of loose USFM files is a legitimate project, and
 * metadata that does not decode is treated exactly like metadata that is not
 * there — discovery falls back to the extension scan and `project.metadata()`
 * is `None`. The refusal is returned rather than logged here so the caller can
 * note it once, at the `project.open` boundary.
 */
export const readProjectMetadata = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<MetadataRead> =>
  Effect.gen(function* () {
    const burritoText = yield* Effect.orElseSucceed(
      readTextIfPresent(fileSystem, joinPath(root, METADATA_FILE)),
      () => Option.none<string>(),
    );
    if (Option.isSome(burritoText)) {
      // Decoded ONCE, here, and narrowed after: this is the one caller that
      // needs the burrito itself as well as the application's view of it, so
      // it takes the raw decoder and applies the adapter rather than reading
      // the file's shape twice.
      let parsed: unknown;
      try {
        parsed = JSON.parse(burritoText.value);
      } catch {
        return { ...NOTHING, declined: "unparsable" };
      }
      const decoded = decodeBurritoMetadata(parsed);
      return Result.isFailure(decoded)
        ? { ...NOTHING, declined: "notAKnownFormat" }
        : {
            metadata: Option.some(fromBurrito(decoded.success)),
            burrito: Option.some(decoded.success),
          };
    }

    const manifestText = yield* Effect.orElseSucceed(
      readTextIfPresent(fileSystem, joinPath(root, MANIFEST_FILE)),
      () => Option.none<string>(),
    );
    if (Option.isNone(manifestText)) return { ...NOTHING, declined: "absent" };

    const read = readResourceContainer(manifestText.value);
    return Result.isFailure(read)
      ? {
          ...NOTHING,
          declined: read.failure.reason === "Syntax" ? "unparsable" : "notAKnownFormat",
        }
      : { metadata: Option.some(read.success), burrito: Option.none() };
  });

/**
 * The book paths of a project, canonically ordered and absolute (resolved
 * against `root`).
 *
 * Two sources, unioned: every `*.usfm` / `*.USFM` / `*.sfm` directly under
 * `root`, and — when `<root>/metadata.json` decodes as a Scripture Burrito —
 * every ingredient whose mime type is a USFM one or whose path ends in a book
 * extension. Burrito ingredients are the only reason a path below the root
 * appears; there is no recursive walk.
 *
 * Fails only when the root cannot be listed. Metadata problems degrade to the
 * extension scan (see `readProjectMetadata`).
 */
export const discoverBooks = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<readonly string[], PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const names = yield* fileSystem.readDirectory(root);
    const paths = new Set<string>();
    for (const name of names) if (isBookFileName(name)) paths.add(joinPath(root, name));

    const read = yield* readProjectMetadata(fileSystem, root);
    if (Option.isSome(read.burrito)) {
      for (const [name, ingredient] of Object.entries(read.burrito.value.ingredients))
        if (isUsfmIngredient(name, ingredient.mimeType)) paths.add(joinPath(root, name));
    }

    return canonicalOrder([...paths].map(normalisePath));
  });
