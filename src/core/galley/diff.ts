// diff.ts
//
// The DIFF DOOR: Onion's decision-unit diff, as Sefer's types.
//
// It is OPEN. scripture-kitchen v0.1.0 re-exports `diff`, `merge` and
// `mergeSplices` as free functions on the galley wasm module, and this is the
// only diff `/review` has: the interim verse-key skeleton that stood in for it
// is deleted (Will, 2026-09-15 — "the engine is the only diff"). `DIFF_DOOR`
// stays as the refusal an artifact that somehow lost the export produces,
// because the alternative is a screen that silently shows a second opinion
// about scripture structure.
//
// `onion/src/diff.rs` is a whole engine: it cuts each side into BLOCKS at its
// own table-of-contents anchors (front matter, chapter open, verse), pairs them
// by a deliberately loose key (book + chapter + verse START, so a rebridged or
// moved verse still pairs and a renumbered one reads as a delete plus an add),
// and hands back a `DiffSkeleton` — an interleave of slots plus a list of
// `DecisionUnit`s, each addressed by a re-derivable sid rather than a minted
// id. The wire carries UTF-16 spans into each side's own document, and takes
// `{"unitId": "baseline"|"current"}` back to `merge`.
//
// ## The doors are on the MODULE, not on the handle
//
// Onion's stateless doors arrive as FREE FUNCTIONS on the wasm module, under
// onion-wasm's own names — `diff`, `merge`, `mergeSplices`, `format`,
// `formatEdits`, `formatEditsIn`, `toByte`, `toUtf16`, `locate`, plus the
// `FormatOpts`, `Edits` and `Splices` classes. They are stateless, so a handle
// method would be a claim about ownership that is not true; the `Galley` handle
// keeps the things that DO hold state — the corpus, the chunk cache, the
// settings. So the probes below are on the MODULE NAMESPACE.
//
// ## The third argument is a TEXT MODE, not a utf16 flag
//
// `diff(baseline, current, textMode)` where `textMode` is `"none" | "words" |
// "chars"`: the intra-verse grain a `modified` unit's marks come back at, at
// UAX-29 word or grapheme level. The engine REJECTS a typo rather than falling
// back, and `"none"` computes nothing — no CST, no mask. Sefer asks for
// `"words"`, which is what the review screen draws.
//
// The diff's own spans are UTF-16 into each side's own document, always; there
// is no unit to choose. (The overlay doors are the ones with a `utf16` flag.)
// Sefer speaks UTF-16 everywhere — `Analysis.docLen` is `text.length`, every
// `Change` and every `Book.apply` range is a JavaScript string index — and a
// byte offset that reached a `book.apply` would splice inside a character,
// which is the worst bug available here and one no type would catch.

import { Data, Result } from "effect";

import type { EngineRange } from "./galley";

// ---------------------------------------------------------------------------
// The wire, verbatim
// ---------------------------------------------------------------------------

/**
 * How one unit was formed. `shared` — one block on each side. `added` /
 * `deleted` — a block only one side has. `coalesced` — a pair the aligner
 * folded into ONE decision (a bridge against its members, most often).
 */
export type UnitKind = "shared" | "added" | "deleted" | "coalesced";

/** What happened to it. `moved` is a pure reorder and marks no characters. */
export type UnitStatus = "unchanged" | "modified" | "added" | "deleted" | "moved";

/** The two sides of a decision, spelled exactly as the merge wire spells them. */
export type MergeSide = "baseline" | "current";

/** What one slot of the interleave emits. Merge reads these; a screen need not. */
export type SlotRole = "shared" | "baselineOnly" | "currentOnly" | "pairBaseline" | "pairCurrent";

/** What cut a block open — derived from the address, not carried on the wire. */
export type BlockKind = "frontMatter" | "chapterOpen" | "verse";

/**
 * A unit's address, parsed back out of the sid the engine rendered.
 *
 * The SID is the identity and the id is opaque — nothing may parse the unit id,
 * which carries an `@N` uniquifier the engine owns. This is the sid, which is
 * a different string and is documented as renderable: `GEN 1:1-3_cdup_1_dup_1`.
 * Parsing it is a DISPLAY convenience so a card can say "Philemon 1:4" and a
 * list can sort; every decision still travels as the opaque id.
 */
export interface Addr {
  /** The three-letter book code, or `""` when the engine rendered `###`. */
  readonly book: string;
  readonly chapter: number;
  /** The first verse the designator names; 0 for a non-verse block. */
  readonly first: number;
  /** The last — a bridge `\v 5-7` reports 7. Equal to `first` when not a bridge. */
  readonly last: number;
  /** Which occurrence of this chapter number this block sits in. */
  readonly cdup: number;
  /** Which occurrence of this verse range within that chapter occurrence. */
  readonly vdup: number;
  readonly kind: BlockKind;
  /** The sid as the engine wrote it, for a title attribute or a log line. */
  readonly sid: string;
}

/**
 * Narration for a one-sided verse whose number a true bridge covers on the
 * other side of a coalesced pair. UI only — merge never reads it.
 */
export interface CoveredBy {
  readonly unit: number;
  readonly sid: string;
  readonly side: MergeSide;
}

/** One side's runs, when the engine was asked for the intra-unit text diff. */
export type RunKind = "unchanged" | "added" | "removed";

export interface TextRun {
  readonly text: string;
  readonly kind: RunKind;
}

/**
 * Word or grapheme runs inside one unit, over the READER-VISIBLE text of each
 * side (`onion::diff::unit_text_diff`, `ReaderText`/`Filter::reader_text`).
 *
 * Present whenever the diff was asked for a text mode other than `"none"`,
 * which is every call Sefer makes. Optional on the type because `"none"` is a
 * legal ask and a unit the engine judged `unchanged` carries no runs.
 */
export interface UnitTextDiff {
  /** Kinds: `unchanged` | `removed`. */
  readonly baseline: readonly TextRun[];
  /** Kinds: `unchanged` | `added`. */
  readonly current: readonly TextRun[];
}

/**
 * One decision: what a reviewer accepts or rejects as a single act.
 *
 * `baseline` and `current` are UTF-16 half-open spans into each side's OWN
 * document, never into a shared coordinate space — the wire is explicit about
 * that and it is the only way two independently lexed documents can both be
 * addressed. `null` is the absent side of a one-sided unit; presence is the
 * address, never the range, because a zero-width span is also what an empty
 * block looks like.
 */
export interface DecisionUnit {
  /** Opaque. Decisions travel as `{id: side}` and nothing may parse it. */
  readonly id: string;
  readonly kind: UnitKind;
  readonly status: UnitStatus;
  /** The rendered address of each side; `undefined` when the unit is one-sided. */
  readonly baselineAddr: Addr | undefined;
  readonly currentAddr: Addr | undefined;
  readonly baseline: EngineRange | undefined;
  readonly current: EngineRange | undefined;
  /** A coalesced pair whose two slots are out of relational order. */
  readonly displaced: boolean;
  /** Byte-equal but differently addressed: the verse did not change, its NUMBER did. */
  readonly relabeled: boolean;
  /** How many blocks on each side share this unit's pairing key. */
  readonly baselineCount: number;
  readonly currentCount: number;
  readonly isDup: boolean;
  readonly coveredBy: CoveredBy | undefined;
  /** The two sides differ only in whitespace. */
  readonly isWhitespaceChange: boolean;
  /**
   * Not whitespace-only, but the reader-visible text is the same: MARKUP
   * changed and nothing else. This is the "markup only" badge.
   */
  readonly isUsfmStructureChange: boolean;
  /** The intra-unit word marks, when they were computed. */
  readonly text: UnitTextDiff | undefined;
}

/** One slot of the interleave. Every byte of both inputs bears exactly one. */
export interface Slot {
  readonly unit: number;
  readonly role: SlotRole;
  readonly afterUnit: number | undefined;
  readonly afterSide: MergeSide | undefined;
}

/**
 * The whole diff of two documents.
 *
 * `engine` is always true and is kept as a field rather than removed: it is
 * what the review screen's badge reads, and while there is only one producer
 * today, a screen that states which alignment it is showing is a screen a
 * reviewer can check. It was false for the interim verse-key skeleton, which
 * is gone.
 */
export interface DiffSkeleton {
  readonly units: readonly DecisionUnit[];
  readonly slots: readonly Slot[];
  readonly baselineLen: number;
  readonly currentLen: number;
  readonly engine: boolean;
}

/**
 * The intra-unit grain a `modified` unit's marks come back at.
 *
 * `"words"` is UAX-29 word segmentation and is what Sefer asks for; `"chars"`
 * is grapheme clusters; `"none"` computes nothing and is byte-identical to the
 * output the door had before runs existed. The engine rejects anything else
 * rather than guessing.
 */
export type TextMode = "none" | "words" | "chars";

/** `{unitId: side}` — the consumer contract, verbatim. Absent reads as the default. */
export type DecisionMap = ReadonlyMap<string, MergeSide>;

// ---------------------------------------------------------------------------
// The refusal
// ---------------------------------------------------------------------------

/**
 * The artifact in hand does not expose the operation. Loud on purpose: there
 * is no second implementation to fall back to, and a screen that quietly
 * showed one would be claiming "the engine aligned this", which is the one
 * thing a reviewer cannot check for themselves.
 *
 * This is the shape `Fixes.Unsupported` had for format before v0.1.0. It is
 * kept because the doors are probed by name off the wasm module: a
 * mis-vendored artifact is a real failure mode and it should say so.
 */
export class EngineDoorMissing extends Data.TaggedError("EngineDoorMissing")<{
  readonly operation: string;
  readonly reason: string;
  readonly description: string;
}> {}

/**
 * The one sentence naming the doors, so the code, the error and the
 * documentation all say the same thing.
 *
 * They are present from scripture-kitchen v0.1.0; the tag this build resolved
 * is pinned in `package.json`.
 * Seeing this string means the vendored artifact is not that build.
 */
export const DIFF_DOOR =
  "the module-level diff(baseline, current, textMode), " +
  "merge(baseline, current, decisions, default) and formatEdits(text, opts) " +
  "exports of the galley wasm — present since scripture-kitchen v0.1.0, so an " +
  "artifact without them is not the vendored build";

/**
 * The refusal, named. Exported because `format.ts` and `overlay.ts` refuse
 * about the same artifact for the same reason and there is one sentence for it.
 */
export const doorMissing = (operation: string): EngineDoorMissing =>
  new EngineDoorMissing({
    operation,
    reason: "NoEngineDoor",
    description: `${operation} needs an engine door: ${DIFF_DOOR}`,
  });

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

const SID = /^(\S+) (\d+):(\d+)(?:-(\d+))?(?:_cdup_(\d+))?(?:_dup_(\d+))?$/;

const blockKind = (chapter: number, first: number): BlockKind =>
  first > 0 ? "verse" : chapter === 0 ? "frontMatter" : "chapterOpen";

/**
 * A sid back into its parts.
 *
 * Tolerant on purpose: a sid Sefer cannot parse still names a place, so the
 * fallback keeps the string and reports chapter 0 rather than throwing away
 * the only label the unit has. The engine's own `Display` is the grammar
 * (`onion/src/diff.rs`, `impl Display for Addr`) and `###` is its "unknown
 * book" rendering, which is kept as the empty code.
 */
export const parseAddr = (sid: string): Addr => {
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

/**
 * The address a reviewer reads: `1:4`, `1:4-6` for a bridge, `1` for a
 * chapter's opening matter, `front` for the matter before the first `\c`.
 *
 * The BOOK is deliberately not in it — the screen is already about one book
 * and its name is in the header, and "PHM PHM 1:4" is what happens when two
 * layers each believe they are the one saying it.
 */
export const referenceOf = (addr: Addr | undefined): string => {
  if (addr === undefined) return "";
  if (addr.kind === "frontMatter") return "front";
  if (addr.kind === "chapterOpen") return `${addr.chapter}`;
  const range = addr.last > addr.first ? `-${addr.last}` : "";
  return `${addr.chapter}:${addr.first}${range}`;
};

/** The unit's own reference: the current side's address when it has one. */
export const unitReference = (unit: DecisionUnit): string =>
  referenceOf(unit.currentAddr ?? unit.baselineAddr);

// ---------------------------------------------------------------------------
// Reading the wire
// ---------------------------------------------------------------------------

/**
 * The shape `onion-wasm`'s `WireSkeleton` serialises. Every field is read
 * defensively — this is JSON crossing a wasm boundary, and a reader that
 * assumed its shape would turn a regenerated artifact into silent nonsense
 * about scripture structure rather than a loud failure.
 */
interface WireUnit {
  readonly unitId?: unknown;
  readonly kind?: unknown;
  readonly status?: unknown;
  readonly baselineSid?: unknown;
  readonly currentSid?: unknown;
  readonly baseline?: unknown;
  readonly current?: unknown;
  readonly displaced?: unknown;
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
const STATUSES: readonly UnitStatus[] = ["unchanged", "modified", "added", "deleted", "moved"];
const ROLES: readonly SlotRole[] = [
  "shared",
  "baselineOnly",
  "currentOnly",
  "pairBaseline",
  "pairCurrent",
];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const num = (value: unknown): number => (typeof value === "number" ? value : 0);
const flag = (value: unknown): boolean => value === true;
const str = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * One of a closed set of strings, or the fallback. Every unknown word from the
 * wire lands on the fallback rather than on the screen: a status Sefer has
 * never heard of is a regenerated artifact, and inventing a fifth rung from it
 * would be worse than reading it as "modified" and showing both sides.
 */
const oneOf = <T extends string>(all: readonly T[], value: unknown, fallback: T): T =>
  all.find((entry) => entry === value) ?? fallback;

/**
 * `[from, to]` as a range, or `undefined` when the side is absent.
 *
 * "Empty (`from == to`) is the absent side" is the wire's own sentence, and the
 * sid is what distinguishes an absent side from an empty block — so the sid is
 * consulted, not the width.
 */
const span = (value: unknown, present: boolean): EngineRange | undefined => {
  if (!present || !Array.isArray(value)) return undefined;
  const from = num(value[0]);
  const to = num(value[1]);
  return { from, to };
};

const readCoveredBy = (value: unknown): CoveredBy | undefined => {
  if (!isRecord(value)) return undefined;
  const sid = str(value.sid);
  if (sid === undefined) return undefined;
  return { unit: num(value.unit), sid, side: value.side === "baseline" ? "baseline" : "current" };
};

const readRuns = (value: unknown): readonly TextRun[] => {
  if (!Array.isArray(value)) return [];
  const out: TextRun[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const text = typeof entry.text === "string" ? entry.text : "";
    if (text === "") continue;
    out.push({
      text,
      kind: oneOf<RunKind>(["unchanged", "added", "removed"], entry.kind, "unchanged"),
    });
  }
  return out;
};

const readText = (value: unknown): UnitTextDiff | undefined => {
  if (!isRecord(value)) return undefined;
  const baseline = readRuns(value.baseline);
  const current = readRuns(value.current);
  return baseline.length === 0 && current.length === 0 ? undefined : { baseline, current };
};

const readUnit = (value: unknown): DecisionUnit | undefined => {
  if (!isRecord(value)) return undefined;
  // SAFETY: `WireUnit` declares every field as optional `unknown`, so this is a
  // naming of the record's keys and not a claim about any of their types —
  // each is still read through `str`, `num`, `flag` or `oneOf` below.
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
    displaced: flag(held.displaced),
    relabeled: flag(held.relabeled),
    baselineCount: num(held.baselineCount),
    currentCount: num(held.currentCount),
    isDup: flag(held.isDup),
    coveredBy: readCoveredBy(held.coveredBy),
    isWhitespaceChange: flag(held.isWhitespaceChange),
    isUsfmStructureChange: flag(held.isUsfmStructureChange),
    text: readText(held.text),
  };
};

const readSlot = (value: unknown): Slot | undefined => {
  if (!isRecord(value)) return undefined;
  const afterUnit = typeof value.afterUnit === "number" ? value.afterUnit : undefined;
  return {
    unit: num(value.unit),
    role: oneOf(ROLES, value.role, "shared"),
    afterUnit,
    afterSide:
      afterUnit === undefined ? undefined : value.afterSide === "baseline" ? "baseline" : "current",
  };
};

/**
 * The engine's JSON as a `DiffSkeleton`. Exported because the desktop door
 * would read the same string off IPC, exactly as `decodeHits` is.
 */
export const decodeSkeleton = (json: string): DiffSkeleton => {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed))
    return { units: [], slots: [], baselineLen: 0, currentLen: 0, engine: true };
  const units: DecisionUnit[] = [];
  if (Array.isArray(parsed.units))
    for (const entry of parsed.units) {
      const unit = readUnit(entry);
      if (unit !== undefined) units.push(unit);
    }
  const slots: Slot[] = [];
  if (Array.isArray(parsed.slots))
    for (const entry of parsed.slots) {
      const slot = readSlot(entry);
      if (slot !== undefined) slots.push(slot);
    }
  return {
    units,
    slots,
    baselineLen: num(parsed.baselineLen),
    currentLen: num(parsed.currentLen),
    engine: true,
  };
};

/** The decision map as the wire's object. Only decided units appear. */
export const encodeDecisions = (decisions: DecisionMap): string => {
  const out: Record<string, MergeSide> = {};
  for (const [id, side] of decisions) out[id] = side;
  return JSON.stringify(out);
};

// ---------------------------------------------------------------------------
// The door itself
// ---------------------------------------------------------------------------

/**
 * The free functions the regenerated galley wasm module will carry. Structural
 * and optional, so the checks below are a `typeof` on an export that does not
 * exist yet rather than a version number Sefer would have to keep in step with
 * the artifact.
 */
export interface DiffCapableModule {
  readonly diff?: (baseline: string, current: string, textMode: string) => string;
  readonly merge?: (
    baseline: string,
    current: string,
    decisions: string,
    fallback: string,
  ) => string;
}

const hasDiff = (module: unknown): module is Required<Pick<DiffCapableModule, "diff">> =>
  isRecord(module) && typeof module.diff === "function";

const hasMerge = (module: unknown): module is Required<Pick<DiffCapableModule, "merge">> =>
  isRecord(module) && typeof module.merge === "function";

/**
 * `diff`, through the engine, or a refusal naming the door.
 *
 * Takes the wasm MODULE NAMESPACE rather than the handle: these doors are
 * stateless and arrive as free functions (see the header). `makeService` in
 * `galley.ts` stays the one place the module is held, and this file stays the
 * one place the wire is read.
 *
 * `textMode` defaults to `"words"` — the marks the review screen draws.
 */
export const engineDiff = (
  module: unknown,
  baseline: string,
  current: string,
  textMode: TextMode = "words",
): Result.Result<DiffSkeleton, EngineDoorMissing> => {
  if (!hasDiff(module)) return Result.fail(doorMissing("diff"));
  return Result.succeed(decodeSkeleton(module.diff(baseline, current, textMode)));
};

/**
 * `merge`, through the engine, or a refusal naming the door.
 *
 * No `utf16` flag: the merge answers with a whole document and carries no
 * offsets. (`mergeSplices`, the transaction-shaped door, does carry them and
 * would need one. It is deliberately not wired: Sefer applies a merged book as
 * ONE `book.apply`, which is one revision and one Undo step per book, and that
 * is what a reader means by "undo that".)
 *
 * `fallback` is what an undecided unit takes, and it is required rather than
 * defaulted: "what happens to the units nobody chose" is the whole safety
 * question of a merge, and a default here would be Sefer answering it quietly
 * on the caller's behalf.
 */
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
