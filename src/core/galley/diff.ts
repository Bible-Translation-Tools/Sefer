// diff.ts
//
// The DIFF DOOR: Onion's decision-unit diff, as Sefer's types, and the one
// constant that names what the pinned artifact is missing.
//
// Onion already has the diff Sefer wants. `onion/src/diff.rs` is a whole
// engine: it cuts each side into BLOCKS at its own table-of-contents anchors
// (front matter, chapter open, verse), pairs them by a deliberately loose key
// (book + chapter + verse START, so a rebridged or moved verse still pairs and
// a renumbered one reads as a delete plus an add), and hands back a
// `DiffSkeleton` — an interleave of slots plus a list of `DecisionUnit`s, each
// addressed by a re-derivable sid rather than a minted id. `onion-wasm`
// already binds `diff(baseline, current) -> JSON` with UTF-16 spans into each
// side's own document, and takes `{"unitId": "baseline"|"current"}` back to
// `merge`.
//
// What is missing is one re-export. Sefer pins the GALLEY wasm crate, and
// `galley/src/wasm.rs` does not carry the diff surface, so
// `vendor/galley/pkg-web/usfm_galley.d.ts` exports the `Galley` class, `Knobs`
// and the init glue and nothing else. That is the same shape as the format ask
// (`Fixes.FORMAT_DOOR`), and it is answered the same way: the types are here,
// the call is here, and the call REFUSES BY NAME until the artifact carries it.
// A silent fallback inside this module would mean nobody could tell which diff
// they were reading.
//
// ## Where the door will be: the MODULE, not the handle
//
// Will's shape for the next galley build (2026-09-15): Onion's stateless doors
// come across as FREE FUNCTIONS on the wasm module, under onion-wasm's own
// names — `diff`, `merge`, `mergeSplices`, `format`, `formatEdits`,
// `formatEditsIn`, `toByte`, `toUtf16`, `locate`, plus the `FormatOpts`,
// `Edits` and `Splices` classes. They are stateless, so a handle method would
// be a claim about ownership that is not true; the `Galley` handle keeps the
// things that DO hold state — the corpus, the chunk cache, the knobs.
//
// So the probe below is on the MODULE NAMESPACE, not on the handle: the day the
// artifact is regenerated, `typeof module.diff === "function"` becomes true and
// the door opens with nothing else in Sefer to change.
//
// ## Offsets: ask for UTF-16
//
// The new wire reports BYTE offsets unless a `utf16` flag is passed. Sefer
// speaks UTF-16 everywhere — `Analysis.docLen` is `text.length`, every `Change`
// and every `Book.apply` range is a JavaScript string index, and the find
// buffer is already decoded as UTF-16 — so this module passes `utf16: true` on
// every offset-bearing call and never converts. A byte offset that reached a
// `book.apply` would splice inside a character, which is the worst bug
// available here and one no type would catch.
//
// The interim lives one directory over, in `src/core/diff/skeleton.ts`, and
// builds these very same types from the line/verse diff Sefer already had. The
// screen therefore has one shape to render, whichever half produced it, and
// `DiffSkeleton.engine` says which — because a reader deciding what to keep is
// entitled to know whether the alignment came from a USFM parser or from a
// verse-key walk.

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
 * Not on the wasm wire today — `onion-wasm`'s `diff` serialises the skeleton
 * alone — so this is optional and the interim fills it. It is typed here
 * because the shape is the engine's and Sefer should not invent a second one
 * for the same fact.
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
 * `engine` is false for the interim skeleton built in `src/core/diff`. It is
 * on the value rather than known by the caller because the two travel together
 * through the screen, and "which diff is this" must never be a guess.
 */
export interface DiffSkeleton {
  readonly units: readonly DecisionUnit[];
  readonly slots: readonly Slot[];
  readonly baselineLen: number;
  readonly currentLen: number;
  readonly engine: boolean;
}

/** `{unitId: side}` — the consumer contract, verbatim. Absent reads as the default. */
export type DecisionMap = ReadonlyMap<string, MergeSide>;

// ---------------------------------------------------------------------------
// The refusal
// ---------------------------------------------------------------------------

/**
 * The pinned engine does not expose the operation. Loud on purpose, exactly as
 * `Fixes.Unsupported` is: a silent fall back to the interim would read to a
 * reviewer as "the engine aligned this", which is the one thing they cannot
 * check for themselves.
 */
export class EngineDoorMissing extends Data.TaggedError("EngineDoorMissing")<{
  readonly operation: string;
  readonly reason: string;
  readonly description: string;
}> {}

/**
 * The one sentence naming the door, so the code, the error and the
 * documentation all say the same thing.
 *
 * The diff EXISTS: `onion/src/diff.rs` is a complete decision-unit differ and
 * `onion-wasm/src/lib.rs` binds `diff`, `merge` and `mergeSplices` on top of
 * it. What is missing is the re-export on the artifact Sefer pins — the galley
 * wasm built from `galley/src/wasm.rs` (`vendor/galley/manifest.json`,
 * revision `f3a2b0b`), which exports the `Galley` class and the init glue and
 * no stateless Onion doors at all. One file upstream, not a new feature — the
 * same shape as `Fixes.FORMAT_DOOR`, and asked for beside it
 * (`planning/01-discussing/engine-asks-2026-09-14.md`, items 1 and 1b).
 */
export const DIFF_DOOR =
  "the module-level diff(baseline, current, utf16) and " +
  "merge(baseline, current, decisions, default) exports of the galley wasm — " +
  "onion::diff has the decision-unit differ and onion-wasm binds both, but " +
  "galley/src/wasm.rs does not re-export them, so the pinned artifact has no " +
  "diff door";

const missing = (operation: string): EngineDoorMissing =>
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
  readonly diff?: (baseline: string, current: string, utf16: boolean) => string;
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
 * `utf16: true` on every call. See the header — Sefer has no byte offsets and
 * must never acquire one.
 */
export const engineDiff = (
  module: unknown,
  baseline: string,
  current: string,
): Result.Result<DiffSkeleton, EngineDoorMissing> => {
  if (!hasDiff(module)) return Result.fail(missing("diff"));
  return Result.succeed(decodeSkeleton(module.diff(baseline, current, true)));
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
  if (!hasMerge(module)) return Result.fail(missing("merge"));
  return Result.succeed(module.merge(baseline, current, encodeDecisions(decisions), fallback));
};
