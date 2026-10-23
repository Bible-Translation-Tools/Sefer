import { decode } from "@sefer/text/source";
import { Effect, FileSystem, Option, Result } from "effect";

import { Observability } from "../observability";
import type { RecoveryService, Restorable } from "./recovery";

const reachedDisk = (text: string, journal: Restorable): boolean => {
  if (text.length !== journal.lastStamp.length) return false;
  const last = journal.entries.at(-1);
  if (last === undefined) return false;
  let lowest: { readonly from: number; readonly insert: string } | undefined;
  for (const change of last.changes)
    if (lowest === undefined || change.from < lowest.from) lowest = change;
  if (lowest === undefined || lowest.insert === "") return true;
  return text.startsWith(lowest.insert, lowest.from);
};

const setAside = (recovery: RecoveryService, journal: Restorable): Effect.Effect<Restorable> =>
  Effect.map(
    Effect.orElseSucceed(recovery.setAside(journal.id), () => journal.id),
    (id) => (id === journal.id ? journal : { ...journal, id }),
  );

export const pendingOnOpen = (
  recovery: RecoveryService,
  projectId: string,
  hasher?: (text: string) => bigint,
): Effect.Effect<readonly Restorable[], never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const observability = Option.getOrUndefined(yield* Effect.serviceOption(Observability));
    const operation = observability?.operation("journal.offer");

    const all = yield* recovery.pending(() => Option.none());
    const mine = all.filter((journal) => journal.projectId === projectId && !journal.thisSession);
    let refused = 0;
    let stale = 0;

    const offered: Restorable[] = [];
    for (const journal of mine) {
      const bytes = yield* Effect.result(fileSystem.readFile(journal.path));
      const decoded = Result.isFailure(bytes) ? undefined : decode(bytes.success);
      if (decoded === undefined || Result.isFailure(decoded)) {
        offered.push(yield* setAside(recovery, journal));
        continue;
      }
      const disk =
        hasher !== undefined && journal.base !== undefined
          ? String(hasher(decoded.success.text))
          : undefined;
      if (disk !== undefined && disk === journal.base) {
        offered.push(yield* setAside(recovery, journal));
        continue;
      }
      if (disk !== undefined && disk !== journal.end) {
        stale += 1;
        offered.push({ ...(yield* setAside(recovery, journal)), stale: true });
        continue;
      }
      if (disk === undefined && !reachedDisk(decoded.success.text, journal)) {
        offered.push(yield* setAside(recovery, journal));
        continue;
      }
      const cleared = yield* Effect.result(recovery.discard(journal.id));
      if (Result.isFailure(cleared)) refused += 1;
      operation?.note(
        "journal.offer",
        Result.isFailure(cleared) ? "declined" : "consumed",
        "matched disk",
        { "book.id": journal.bookId },
      );
    }
    operation?.end("ready", {
      "journal.candidates": mine.length,
      "journal.offered": offered.length,
      "journal.stale": stale,
      "journal.refused": refused,
    });
    const at = (journal: Restorable): number => journal.entries.at(-1)?.at ?? 0;
    return offered.toSorted((a, b) => at(b) - at(a));
  });
