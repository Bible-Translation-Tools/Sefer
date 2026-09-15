// reopen.ts
//
// The one check a project open owes the person who crashed: is there work in
// the journal that never reached disk?
//
// `recovery.ts` answers "what is pending" against SAVE's baselines, which is
// the right question during a session and the wrong one at open: a project
// opened in a fresh process has no baselines at all, so every journal would
// read as pending — including the ones whose work a previous session saved
// perfectly well a moment before it was closed. Offering those back is worse
// than useless; it invites the reader to "recover" text that is already in
// the file, twice.
//
// So at open the comparison is against DISK, not against a baseline, and it is
// one pass: list the project's journals, read each journal's book file once,
// and either drop the journal silently or offer it. Nothing here writes a
// project file and nothing here replays: `Recovery.restore` still owns that,
// through the Book's funnel, so an undo history exists for what comes back.

import { Effect, FileSystem, Option, Result } from "effect";

import { Observability } from "../observability";
import { decode } from "../source/source";
import type { RecoveryService, Restorable } from "./recovery";

/**
 * Did the journal's work reach this text?
 *
 * Two facts are compared, and both are cheap:
 *
 *   * the LENGTH the journal's last entry stamped, against the length of the
 *     text on disk — `SourceStamp` carries no content hash, so length is the
 *     whole of what the stamp can say;
 *   * the last entry's lowest-offset insertion, at the offset it claims.
 *     `applyAll` splices back to front, so the change with the smallest `from`
 *     is the one whose offsets survive into the finished text unchanged —
 *     which makes this an exact spot check rather than a guess.
 *
 * Together they catch what length alone misses: the same-length edit. They can
 * still be fooled by a same-length edit that happens to put the same
 * characters at the same offset, and that is the right way to be wrong — the
 * outcome is a journal kept and offered, never one deleted in error.
 */
export const reachedDisk = (text: string, journal: Restorable): boolean => {
  if (text.length !== journal.lastStamp.length) return false;
  const last = journal.entries.at(-1);
  if (last === undefined) return false;
  let lowest: { readonly from: number; readonly insert: string } | undefined;
  for (const change of last.changes)
    if (lowest === undefined || change.from < lowest.from) lowest = change;
  if (lowest === undefined || lowest.insert === "") return true;
  return text.startsWith(lowest.insert, lowest.from);
};

/**
 * The journals for one project that still hold work the files do not, with
 * every journal the files DO hold deleted on the way past.
 *
 * Never fails. A journal whose book file cannot be read or decoded is OFFERED,
 * not dropped: a file that has gone missing or become unreadable is the
 * strongest possible reason to keep the only other copy of the work.
 *
 * Callers still decide what to show. A journal for a book this session already
 * has open is the live backup of what is on screen, and the banner filters
 * those out — see `src/app/ui/recovery/RecoveryBanner.tsx`.
 */
export const pendingOnOpen = (
  recovery: RecoveryService,
  projectId: string,
): Effect.Effect<readonly Restorable[], never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const observability = Option.getOrUndefined(yield* Effect.serviceOption(Observability));

    // No baselines exist yet, and that is the point: ask for every journal
    // with entries and let the disk comparison below be the only filter.
    const all = yield* recovery.pending(() => Option.none());
    const mine = all.filter((journal) => journal.projectId === projectId);

    const offered: Restorable[] = [];
    for (const journal of mine) {
      const bytes = yield* Effect.result(fileSystem.readFile(journal.path));
      const decoded = Result.isFailure(bytes) ? undefined : decode(bytes.success);
      if (decoded === undefined || Result.isFailure(decoded)) {
        offered.push(journal);
        continue;
      }
      if (!reachedDisk(decoded.success.text, journal)) {
        offered.push(journal);
        continue;
      }
      // The work is in the file. The journal is now a duplicate of the
      // project's own bytes, so it goes without asking: a banner offering to
      // restore what is already saved teaches people to ignore the banner.
      const cleared = yield* Effect.result(recovery.discard(journal.id));
      observability?.note(
        "recovery.reopen",
        Result.isFailure(cleared) ? "declined" : "consumed",
        `${journal.id} matched disk`,
        journal.bookId,
      );
    }
    observability?.note(
      "recovery.reopen",
      "ready",
      `n=${offered.length} of ${mine.length}`,
      projectId,
    );
    return offered;
  });
