/**
 * The open project's key-term approvals, for the Key terms page: read when
 * the page opens (never at app load; nothing else reads them), written on
 * every change. The file, the keys and the states are core's
 * (`#core/stet/approvals`).
 *
 * A verse's state is read from its text, so the caller hands the verse's raw
 * USFM as it is now, and the hash the card opened with.
 */

import { Effect } from "effect";
import { createSignal, untrack, type Accessor } from "solid-js";

import { readDeviceFile, writeDeviceFile } from "#core/project/deviceFile";
import {
  APPROVALS_FILE,
  decodeApprovals,
  encodeApprovals,
  NO_APPROVALS,
  stateOf,
  withApproval,
  withoutApproval,
  type ApprovalState,
  type Approvals,
} from "#core/stet/approvals";

import type { Services } from "./services";

export interface ApprovalsHandle {
  /** Every approval held; a reader of a count tracks this. */
  readonly held: Accessor<Approvals>;
  /** `verse` is the guide's sid (`JUD 1:21`); `now` the verse's raw USFM. */
  state(term: string, verse: string, now: string): ApprovalState;
  /** `opened` is the verse's raw USFM when its card was first shown. */
  approve(term: string, verse: string, opened: string, now: string): void;
  unapprove(term: string, verse: string): void;
}

const hex = (value: bigint): string => value.toString(16).padStart(16, "0");

export const createApprovals = (services: Services, root: string): ApprovalsHandle => {
  const [held, setHeld] = createSignal<Approvals>(NO_APPROVALS, { name: "keyTermApprovals" });
  // A file this build could not read is left alone: saving over it would erase it.
  let writable = false;
  const hash = (text: string): string => hex(services.galley.hash(text));

  const loaded = services
    .run(readDeviceFile(services.fileSystem, root, APPROVALS_FILE))
    .then((text) => {
      const decoded =
        text === "" ? NO_APPROVALS : text === undefined ? undefined : decodeApprovals(text);
      writable = decoded !== undefined;
      if (decoded !== undefined) setHeld(decoded);
    });

  // A press before the file is read waits for it, rather than being lost;
  // writes go one at a time, in order (they share one temporary name).
  let writing: Promise<void> = loaded;
  const save = (change: (from: Approvals) => Approvals): void => {
    writing = writing.then(() => {
      if (!writable) return;
      // The latest held, at write time: not a tracked read.
      const next = change(untrack(held));
      setHeld(next);
      return services.run(
        Effect.ignore(
          writeDeviceFile(services.fileSystem, root, APPROVALS_FILE, encodeApprovals(next)),
        ),
      );
    });
  };

  return {
    held,
    state: (term, verse, now) => stateOf(held(), term, verse, hash(now)),
    approve: (term, verse, opened, now) => {
      const entry = {
        term,
        verse,
        open: hash(opened),
        approved: hash(now),
        at: new Date().toISOString(),
      };
      save((from) => withApproval(from, entry));
    },
    unapprove: (term, verse) => save((from) => withoutApproval(from, term, verse)),
  };
};
