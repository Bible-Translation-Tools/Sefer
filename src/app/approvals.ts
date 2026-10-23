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
  readonly held: Accessor<Approvals>;
  state(term: string, verse: string, now: string): ApprovalState;
  approve(term: string, verse: string, opened: string, now: string): void;
  unapprove(term: string, verse: string): void;
}

const decodeApprovalsFile = (text: string | undefined) => {
  if (text === "") return NO_APPROVALS;
  if (text === undefined) return undefined;
  return decodeApprovals(text);
};

const hex = (value: bigint): string => value.toString(16).padStart(16, "0");

export const createApprovals = (services: Services, root: string): ApprovalsHandle => {
  const [held, setHeld] = createSignal<Approvals>(NO_APPROVALS, { name: "keyTermApprovals" });
  let writable = false;
  const hash = (text: string): string => hex(services.galley.hash(text));

  const loaded = services
    .run(readDeviceFile(services.fileSystem, root, APPROVALS_FILE))
    .then((text) => {
      const decoded = decodeApprovalsFile(text);
      writable = decoded !== undefined;
      if (decoded !== undefined) setHeld(decoded);
    });

  let writing: Promise<void> = loaded;
  const save = (change: (from: Approvals) => Approvals): void => {
    writing = writing.then(() => {
      if (!writable) return;
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
