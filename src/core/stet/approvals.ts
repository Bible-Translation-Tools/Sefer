import { Result, Schema } from "effect";

export const APPROVALS_FILE = ".sefer/key-term-approvals.json";

const APPROVAL_HASH = "xxh3-64-seed0";
const APPROVAL_OVER = "verse-usfm";

const EntrySchema = Schema.Struct({
  term: Schema.String,
  verse: Schema.String,
  open: Schema.String,
  approved: Schema.String,
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
  readonly byKey: ReadonlyMap<string, Approval>;
  readonly recheck: boolean;
}

export const NO_APPROVALS: Approvals = { byKey: new Map(), recheck: false };

const keyOf = (term: string, verse: string): string => `${term}\u0000${verse}`;

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

export const isStanding = (state: ApprovalState): boolean =>
  state === "approved" || state === "approvedWithEdits";
