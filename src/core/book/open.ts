import { makeBook, type Book } from "@wycliffeassociates/sefer-text/book";
import { decode, type SourceDecodeError } from "@wycliffeassociates/sefer-text/source";
import { Effect, FileSystem, Option, type PlatformError } from "effect";

import { fromResult } from "#core/result";

import { Observability } from "../observability";

export const openBook = (
  path: string,
): Effect.Effect<Book, PlatformError.PlatformError | SourceDecodeError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const observability = yield* Effect.serviceOption(Observability);
    const bytes = yield* fileSystem.readFile(path);
    const source = yield* fromResult(decode(bytes));
    return makeBook(path, source, Option.getOrUndefined(observability));
  });
