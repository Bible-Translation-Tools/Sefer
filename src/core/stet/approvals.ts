/**
 * Key-term approvals: "this verse renders this term as it should", kept per
 * device in `.sefer/key-term-approvals.json`.
 *
 * Keyed by term id and verse (`love`, `JUD 1:21`), never by guide: a term's id
 * is its English label slugged (`idsFor` in `./stet.ts`), the same in every
 * gateway language's guide, and nothing in the guide's prose is in the key.
 *
 * Only two hashes are stored per approval: the verse's raw USFM when its card
 * was opened, and at approval. Every state but "unapproved" is DERIVED from
 * those and the verse's current hash, when it is read, so nothing has to
 * notice an edit (`planning/items/2026-10-06-project-state-and-suppressions.mdx`,
 * the state machine "One term at one verse").
 *
 *   unapproved              no entry
 *   approved                open = approval = now
 *   approvedWithEdits       open ≠ approval = now
 *   changedSinceApproved    approval ≠ now
 *   needsRecheck            the file's hash header is not this build's
 *
 * An approval whose term the guide no longer serves is not shown anywhere and
 * not deleted: it comes back if the term does.
 */

import { Result, Schema } from "effect";

export const APPROVALS_FILE = ".sefer/key-term-approvals.json";

/** What the stored hashes are: Galley's `hash`, over the verse's raw USFM. */
export const APPROVAL_HASH = "xxh3-64-seed0";
export const APPROVAL_OVER = "verse-usfm";

const EntrySchema = Schema.Struct({
  term: Schema.String,
  /** The verse, as the guide's sid names it: `JUD 1:21`. */
  verse: Schema.String,
  /** Hex: the verse when its card was opened. */
  open: Schema.String,
  /** Hex: the verse when it was approved. */
  approved: Schema.String,
  /** When, ISO. */
  at: Schema.String,
});

export type Approval = typeof EntrySchema.Type;

const FileSchema = Schema.Struct({
  v: Schema.Literal(1),
  hash: Schema.String,
  over: Schema.String,
  approvals: Schema.Array(EntrySchema),
});

const decodeFile = Schema.decodeUnknownResult(FileSchema);

export interface Approvals {
  /** By `keyOf(term, verse)`. */
  readonly byKey: ReadonlyMap<string, Approval>;
  /** The file was hashed some other way: every entry needs re-checking. */
  readonly recheck: boolean;
}

export const NO_APPROVALS: Approvals = { byKey: new Map(), recheck: false };

export const keyOf = (term: string, verse: string): string => `${term}\u0000${verse}`;

/** The file's text, or `undefined` for one this build cannot read (never saved over). */
export const decodeApprovals = (text: string): Approvals | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const decoded = decodeFile(parsed);
  if (Result.isFailure(decoded)) return undefined;
  const file = decoded.success;
  return {
    byKey: new Map(file.approvals.map((entry) => [keyOf(entry.term, entry.verse), entry])),
    recheck: file.hash !== APPROVAL_HASH || file.over !== APPROVAL_OVER,
  };
};

export const encodeApprovals = (approvals: Approvals): string =>
  `${JSON.stringify(
    {
      v: 1,
      hash: APPROVAL_HASH,
      over: APPROVAL_OVER,
      approvals: [...approvals.byKey.values()],
    },
    null,
    2,
  )}\n`;

export const withApproval = (approvals: Approvals, entry: Approval): Approvals => {
  const next = new Map(approvals.byKey);
  next.set(keyOf(entry.term, entry.verse), entry);
  return { ...approvals, byKey: next };
};

export const withoutApproval = (approvals: Approvals, term: string, verse: string): Approvals => {
  const key = keyOf(term, verse);
  if (!approvals.byKey.has(key)) return approvals;
  const next = new Map(approvals.byKey);
  next.delete(key);
  return { ...approvals, byKey: next };
};

export type ApprovalState =
  | "unapproved"
  | "approved"
  | "approvedWithEdits"
  | "changedSinceApproved"
  | "needsRecheck";

/** One term at one verse, read now: `now` is the verse's current hash, hex. */
export const stateOf = (
  approvals: Approvals,
  term: string,
  verse: string,
  now: string,
): ApprovalState => {
  const entry = approvals.byKey.get(keyOf(term, verse));
  if (entry === undefined) return "unapproved";
  if (approvals.recheck) return "needsRecheck";
  if (entry.approved !== now) return "changedSinceApproved";
  return entry.open === entry.approved ? "approved" : "approvedWithEdits";
};

/** Approved, with or without edits, and still standing. */
export const isStanding = (state: ApprovalState): boolean =>
  state === "approved" || state === "approvedWithEdits";
