import { Effect, FileSystem, Option, PlatformError, Result } from "effect";

import { joinPath, lastSegment, normalisePath } from "../fileSystem/path";
import { decodeBurritoMetadata, type BurritoMetadata } from "../resources/burrito";
import {
  fromBurrito,
  readResourceContainer,
  type ProjectMetadata,
} from "../resources/projectMetadata";

export const METADATA_FILE = "metadata.json";

export const MANIFEST_FILE = "manifest.yaml";

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
    return left < right ? -1 : left > right ? 1 : 0;
  });

export type MetadataRefusal = "absent" | "unreadable" | "unparsable" | "notAKnownFormat";

export interface MetadataRead {
  readonly metadata: Option.Option<ProjectMetadata>;
  readonly burrito: Option.Option<BurritoMetadata>;
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
