import { Effect, FileSystem, Option, type PlatformError } from "effect";

import { Observability, type ObservabilityService } from "../observability";
import {
  apply as applyToSource,
  decode,
  type Change,
  type Source,
  type SourceDecodeError,
  type SourceStamp,
} from "../source/source";

export type BookId = string;

export interface Receipt {
  readonly before: SourceStamp;
  readonly after: SourceStamp;
  readonly origin: string;
}

export interface Book {
  readonly id: BookId;
  readonly path: string;
  source(): Source;
  apply(change: Change, origin: string): Receipt;
  changes(fn: (receipt: Receipt) => void): () => void;
}

const ID_MARKER = /^\\id[ \t]+(\S+)/;

const fileStem = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

const identify = (text: string, path: string): BookId =>
  ID_MARKER.exec(text)?.[1] ?? fileStem(path);

export const makeBook = (
  path: string,
  initial: Source,
  observability?: ObservabilityService,
): Book => {
  const id = identify(initial.text, path);
  const subscribers = new Set<(receipt: Receipt) => void>();
  let current = initial;

  return {
    id,
    path,
    source: () => current,
    apply: (change, origin) => {
      const before = current.stamp;
      current = applyToSource(current, change);
      const receipt: Receipt = { before, after: current.stamp, origin };
      observability?.note(
        "book.apply",
        "rewrote",
        `${id} r${before.revision} -> r${receipt.after.revision} (${origin})`,
        id,
      );
      for (const subscriber of Array.from(subscribers)) subscriber(receipt);
      return receipt;
    },
    changes: (fn) => {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };
};

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
