import {
  find,
  read as readManifestBytes,
  type BurritoMetadata,
  type Read,
} from "@wycliffeassociates/scripture-kitchen/bento";
import { Effect, FileSystem, Option, PlatformError } from "effect";

import { joinPath, lastSegment, normalisePath } from "../fileSystem/path";
import { compareCodeUnits } from "../ordering";
import { fromManifest, unreadable, type ProjectMetadata } from "../resources/projectMetadata";

export const METADATA_FILE = "metadata.json";

/** A Resource Container's manifest, at the project root. */
export const RC_MANIFEST_FILE = "manifest.yaml";

const BOOK_EXTENSIONS: readonly string[] = [".usfm", ".sfm"];

const USFM_MIME_TYPES: ReadonlySet<string> = new Set(["text/x-usfm", "text/usfm"]);

const LEADING_NUMBER = /^(\d+)/;

const isBookFileName = (name: string): boolean => {
  const lower = name.toLowerCase();
  return BOOK_EXTENSIONS.some((extension) => lower.endsWith(extension));
};

const isUsfmIngredient = (name: string, mimeType: string): boolean =>
  USFM_MIME_TYPES.has(mimeType.toLowerCase()) || isBookFileName(name);

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
    return compareCodeUnits(left, right);
  });

export type MetadataRefusal = "absent" | "unreadable" | "unparsable" | "notAKnownFormat";

export interface MetadataRead {
  readonly metadata: Option.Option<ProjectMetadata>;
  /** The Burrito as written, when the manifest is one: its ingredients say where the books are. */
  readonly burrito: Option.Option<BurritoMetadata>;
  readonly declined?: MetadataRefusal;
}

const NOTHING = { metadata: Option.none(), burrito: Option.none() } as const;

/** A folder's manifest, found among its root names by bento, as file name, bytes and bento's read. */
export interface ManifestFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly read: Read;
}

/**
 * The manifest at `root` (`metadata.json`, else `manifest.yaml`, else a Writer
 * `manifest.json`), read by bento. None when there is none; fails when it is
 * there but cannot be read off the disk.
 */
export const readManifest = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<Option.Option<ManifestFile>, PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const names = yield* Effect.orElseSucceed(
      fileSystem.readDirectory(root),
      (): readonly string[] => [],
    );
    const found = find(names);
    if (found === undefined) return Option.none();
    const bytes = yield* fileSystem.readFile(joinPath(root, found.name));
    return Option.some({ name: found.name, bytes, read: readManifestBytes(found.name, bytes) });
  });

export const readProjectMetadata = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<MetadataRead> =>
  Effect.gen(function* () {
    const file = yield* Effect.result(readManifest(fileSystem, root));
    if (file._tag === "Failure") return { ...NOTHING, declined: "unreadable" };
    if (Option.isNone(file.success)) return { ...NOTHING, declined: "absent" };
    const { read } = file.success.value;
    if (unreadable(read)) return { ...NOTHING, declined: "unparsable" };
    const metadata = fromManifest(read);
    if (metadata === undefined) return { ...NOTHING, declined: "notAKnownFormat" };
    return {
      metadata: Option.some(metadata),
      burrito:
        read.detail?.format === "burrito" ? Option.some(read.detail.document) : Option.none(),
    };
  });

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
      for (const [name, ingredient] of Object.entries(read.burrito.value.ingredients ?? {}))
        if (isUsfmIngredient(name, ingredient.mimeType ?? "")) paths.add(joinPath(root, name));
    }

    return canonicalOrder([...paths].map(normalisePath));
  });
