import { makeBook, type Book } from "@sefer/text/book";
import { decode, type SourceDecodeError } from "@sefer/text/source";
import { Effect, FileSystem, Option, type PlatformError } from "effect";

import { Observability } from "../observability";

export const openBook = (
  path: string,
): Effect.Effect<Book, PlatformError.PlatformError | SourceDecodeError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const observability = yield* Effect.serviceOption(Observability);
    const bytes = yield* fileSystem.readFile(path);
    const source = yield* Effect.fromResult(decode(bytes));
    return makeBook(path, source, Option.getOrUndefined(observability));
  });
