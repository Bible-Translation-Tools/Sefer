import { Data, Result } from "effect";

import type { EngineRange } from "./galley";
import { exportsFunctions, isRecord } from "./wire";

export type UnitKind = "shared" | "added" | "deleted" | "coalesced";

export type UnitStatus = "unchanged" | "modified" | "added" | "deleted";

export type MergeSide = "baseline" | "current";

export type BlockKind = "frontMatter" | "chapterOpen" | "verse";

export interface Addr {
  readonly book: string;
  readonly chapter: number;
  readonly first: number;
  readonly last: number;
  readonly cdup: number;
  readonly vdup: number;
  readonly kind: BlockKind;
  readonly sid: string;
}

export interface CoveredBy {
  readonly sid: string;
  readonly side: MergeSide;
}

export type RunKind = "unchanged" | "added" | "removed";

export type RunWhat = "markup" | "text" | "whitespace";

export interface TextRun {
  /** UTF-16, into this side's own document, like the unit's own span. */
  readonly from: number;
  readonly to: number;
  readonly kind: RunKind;
  readonly what: RunWhat;
  readonly note: boolean;
  readonly text: string;
}

export interface UnitTextDiff {
  readonly baseline: readonly TextRun[];
  readonly current: readonly TextRun[];
}

export interface DecisionUnit {
  readonly id: string;
  readonly kind: UnitKind;
  readonly status: UnitStatus;
  readonly baselineAddr: Addr | undefined;
  readonly currentAddr: Addr | undefined;
  readonly baseline: EngineRange | undefined;
  readonly current: EngineRange | undefined;
  readonly place: { readonly baseline: number; readonly current: number };
  readonly relabeled: boolean;
  readonly baselineCount: number;
  readonly currentCount: number;
  readonly isDup: boolean;
  readonly coveredBy: CoveredBy | undefined;
  readonly isWhitespaceChange: boolean;
  readonly isUsfmStructureChange: boolean;
  readonly text: UnitTextDiff | undefined;
}

export interface DiffSkeleton {
  readonly units: readonly DecisionUnit[];
  readonly unchangedCount: number;
  readonly baselineLen: number;
  readonly currentLen: number;
  readonly engine: boolean;
}

export type TextMode = "none" | "words" | "chars";

export interface DiffOptions {
  readonly text: TextMode;
  readonly unchanged?: boolean;
}

export type DecisionMap = ReadonlyMap<string, MergeSide>;

export class EngineDoorMissing extends Data.TaggedError("EngineDoorMissing")<{
  readonly operation: string;
  readonly reason: string;
  readonly description: string;
}> {}

const DIFF_DOOR =
  "the module-level diff(baseline, current, { text, unchanged }), " +
  "merge(baseline, current, decisions, default) and formatEdits(text, opts) " +
  "exports of the galley wasm — present since scripture-kitchen v0.1.0, so an " +
  "artifact without them is not the pinned build";

export const doorMissing = (operation: string): EngineDoorMissing =>
  new EngineDoorMissing({
    operation,
    reason: "NoEngineDoor",
    description: `${operation} needs an engine door: ${DIFF_DOOR}`,
  });

const SID = /^(\S+) (\d+):(\d+)(?:-(\d+))?(?:_cdup_(\d+))?(?:_dup_(\d+))?$/;

const blockKind = (chapter: number, first: number): BlockKind => {
  if (first > 0) return "verse";
  return chapter === 0 ? "frontMatter" : "chapterOpen";
};

const parseAddr = (sid: string): Addr => {
  const parts = SID.exec(sid);
  if (parts === null)
    return {
      book: "",
      chapter: 0,
      first: 0,
      last: 0,
      cdup: 0,
      vdup: 0,
      kind: "frontMatter",
      sid,
    };
  const chapter = Number(parts[2]);
  const first = Number(parts[3]);
  const last = parts[4] === undefined ? first : Number(parts[4]);
  return {
    book: parts[1] === "###" ? "" : (parts[1] ?? ""),
    chapter,
    first,
    last,
    cdup: parts[5] === undefined ? 0 : Number(parts[5]),
    vdup: parts[6] === undefined ? 0 : Number(parts[6]),
    kind: blockKind(chapter, first),
    sid,
  };
};

const referenceOf = (addr: Addr | undefined): string => {
  if (addr === undefined) return "";
  if (addr.kind === "frontMatter") return "front";
  if (addr.kind === "chapterOpen") return `${addr.chapter}`;
  const range = addr.last > addr.first ? `-${addr.last}` : "";
  return `${addr.chapter}:${addr.first}${range}`;
};

export const unitReference = (unit: DecisionUnit): string =>
  referenceOf(unit.currentAddr ?? unit.baselineAddr);

interface WireUnit {
  readonly unitId?: unknown;
  readonly kind?: unknown;
  readonly status?: unknown;
  readonly baselineSid?: unknown;
  readonly currentSid?: unknown;
  readonly baseline?: unknown;
  readonly current?: unknown;
  readonly relabeled?: unknown;
  readonly baselineCount?: unknown;
  readonly currentCount?: unknown;
  readonly isDup?: unknown;
  readonly coveredBy?: unknown;
  readonly isWhitespaceChange?: unknown;
  readonly isUsfmStructureChange?: unknown;
  readonly text?: unknown;
}

const KINDS: readonly UnitKind[] = ["shared", "added", "deleted", "coalesced"];
const STATUSES: readonly UnitStatus[] = ["unchanged", "modified", "added", "deleted"];

const num = (value: unknown): number => (typeof value === "number" ? value : 0);
const flag = (value: unknown): boolean => value === true;
const str = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const oneOf = <T extends string>(all: readonly T[], value: unknown, fallback: T): T =>
  all.find((entry) => entry === value) ?? fallback;

const span = (value: unknown, present: boolean): EngineRange | undefined => {
  if (!present || !Array.isArray(value)) return undefined;
  const from = num(value[0]);
  const to = num(value[1]);
  return { from, to };
};

const startOf = (value: unknown): number => (Array.isArray(value) ? num(value[0]) : 0);

const readCoveredBy = (value: unknown): CoveredBy | undefined => {
  if (!isRecord(value)) return undefined;
  const sid = str(value.sid);
  if (sid === undefined) return undefined;
  return { sid, side: value.side === "baseline" ? "baseline" : "current" };
};

const readRuns = (value: unknown, source: string): readonly TextRun[] => {
  if (!Array.isArray(value)) return [];
  const out: TextRun[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const from = num(entry.from);
    const to = num(entry.to);
    if (to <= from) continue;
    out.push({
      from,
      to,
      kind: oneOf<RunKind>(["unchanged", "added", "removed"], entry.kind, "unchanged"),
      what: oneOf<RunWhat>(["markup", "text", "whitespace"], entry.what, "text"),
      note: flag(entry.note),
      text: source.slice(from, to),
    });
  }
  return out;
};

const readText = (
  value: unknown,
  baselineText: string,
  currentText: string,
): UnitTextDiff | undefined => {
  if (!isRecord(value)) return undefined;
  const baseline = readRuns(value.baseline, baselineText);
  const current = readRuns(value.current, currentText);
  return baseline.length === 0 && current.length === 0 ? undefined : { baseline, current };
};

export const readingRuns = (runs: readonly TextRun[]): readonly TextRun[] =>
  runs.filter((run) => run.what !== "markup");

const readUnit = (
  value: unknown,
  baselineText: string,
  currentText: string,
): DecisionUnit | undefined => {
  if (!isRecord(value)) return undefined;
  // SAFETY: `WireUnit` declares every field as optional `unknown`, so this is a naming of the record's keys and not a claim about any of their types — each is still read through `str`, `num`, `flag` or `oneOf` below.
  const held = value as WireUnit;
  const id = str(held.unitId);
  if (id === undefined) return undefined;
  const baselineSid = str(held.baselineSid);
  const currentSid = str(held.currentSid);
  return {
    id,
    kind: oneOf(KINDS, held.kind, "shared"),
    status: oneOf(STATUSES, held.status, "modified"),
    baselineAddr: baselineSid === undefined ? undefined : parseAddr(baselineSid),
    currentAddr: currentSid === undefined ? undefined : parseAddr(currentSid),
    baseline: span(held.baseline, baselineSid !== undefined),
    current: span(held.current, currentSid !== undefined),
    place: { baseline: startOf(held.baseline), current: startOf(held.current) },
    relabeled: flag(held.relabeled),
    baselineCount: num(held.baselineCount),
    currentCount: num(held.currentCount),
    isDup: flag(held.isDup),
    coveredBy: readCoveredBy(held.coveredBy),
    isWhitespaceChange: flag(held.isWhitespaceChange),
    isUsfmStructureChange: flag(held.isUsfmStructureChange),
    text: readText(held.text, baselineText, currentText),
  };
};

const decodeSkeleton = (json: string, baselineText: string, currentText: string): DiffSkeleton => {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed))
    return { units: [], unchangedCount: 0, baselineLen: 0, currentLen: 0, engine: true };
  const units: DecisionUnit[] = [];
  if (Array.isArray(parsed.units))
    for (const entry of parsed.units) {
      const unit = readUnit(entry, baselineText, currentText);
      if (unit !== undefined) units.push(unit);
    }
  return {
    units,
    unchangedCount: num(parsed.unchangedCount),
    baselineLen: num(parsed.baselineLen),
    currentLen: num(parsed.currentLen),
    engine: true,
  };
};

const encodeDecisions = (decisions: DecisionMap): string => {
  const out: Record<string, MergeSide> = {};
  for (const [id, side] of decisions) out[id] = side;
  return JSON.stringify(out);
};

interface WasmSplices {
  readonly spans: Uint32Array;
  readonly inserts: Uint32Array;
  free?(): void;
}

interface DiffCapableModule {
  readonly diff?: (baseline: string, current: string, opts: DiffOptions) => string;
  readonly mergeSplices?: (
    baseline: string,
    current: string,
    decisions: string,
    fallback: string,
  ) => WasmSplices;
  readonly merge?: (
    baseline: string,
    current: string,
    decisions: string,
    fallback: string,
  ) => string;
}

const hasDiff = (module: unknown): module is Required<Pick<DiffCapableModule, "diff">> =>
  exportsFunctions(module, "diff");

const hasSplices = (module: unknown): module is Required<Pick<DiffCapableModule, "mergeSplices">> =>
  exportsFunctions(module, "mergeSplices");

export interface MergeSplice {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export const engineMergeSplices = (
  module: unknown,
  baseline: string,
  current: string,
  decisions: DecisionMap,
  fallback: MergeSide,
): Result.Result<readonly MergeSplice[], EngineDoorMissing> => {
  if (!hasSplices(module)) return Result.fail(doorMissing("mergeSplices"));
  const splices = module.mergeSplices(baseline, current, encodeDecisions(decisions), fallback);
  try {
    const out: MergeSplice[] = [];
    for (let at = 0; at + 1 < splices.spans.length; at += 2)
      out.push({
        from: splices.spans[at] ?? 0,
        to: splices.spans[at + 1] ?? 0,
        insert: current.slice(splices.inserts[at] ?? 0, splices.inserts[at + 1] ?? 0),
      });
    return Result.succeed(out);
  } finally {
    splices.free?.();
  }
};

const hasMerge = (module: unknown): module is Required<Pick<DiffCapableModule, "merge">> =>
  exportsFunctions(module, "merge");

export const engineDiff = (
  module: unknown,
  baseline: string,
  current: string,
  opts: Partial<DiffOptions> = {},
): Result.Result<DiffSkeleton, EngineDoorMissing> => {
  if (!hasDiff(module)) return Result.fail(doorMissing("diff"));
  const wire: DiffOptions = {
    text: opts.text ?? "words",
    ...(opts.unchanged === true ? { unchanged: true } : {}),
  };
  return Result.succeed(decodeSkeleton(module.diff(baseline, current, wire), baseline, current));
};

export const engineMerge = (
  module: unknown,
  baseline: string,
  current: string,
  decisions: DecisionMap,
  fallback: MergeSide,
): Result.Result<string, EngineDoorMissing> => {
  if (!hasMerge(module)) return Result.fail(doorMissing("merge"));
  return Result.succeed(module.merge(baseline, current, encodeDecisions(decisions), fallback));
};
