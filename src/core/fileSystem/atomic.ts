import type { Effect as EffectType, FileSystem, PlatformError } from "effect";
import { Effect } from "effect";

const TEMPORARY_SUFFIX = ".sefer-tmp";

export const temporaryPathFor = (path: string): string => `${path}${TEMPORARY_SUFFIX}`;

export const writeFileAtomic = (
  fileSystem: FileSystem.FileSystem,
  path: string,
  data: Uint8Array,
): EffectType.Effect<void, PlatformError.PlatformError> => {
  const temporary = temporaryPathFor(path);
  return Effect.onError(
    Effect.flatMap(fileSystem.writeFile(temporary, data), () => fileSystem.rename(temporary, path)),
    () => Effect.ignore(fileSystem.remove(temporary, { force: true })),
  );
};

export const writeFileStringAtomic = (
  fileSystem: FileSystem.FileSystem,
  path: string,
  data: string,
): EffectType.Effect<void, PlatformError.PlatformError> =>
  writeFileAtomic(fileSystem, path, new TextEncoder().encode(data));
