/**
 * Galley — the adapter over the pinned Scripture Kitchen wasm artifact.
 *
 * This is the ONLY place in Sefer that parses USFM. Everything else reads an
 * `Analysis` (see `analysis.ts`). The seam has two halves on one handle:
 *
 *   - the onion half: `analyze(text)` — one book, synchronous, per gesture.
 *   - the sous half:  `update`/`publish` — the whole corpus, proofread.
 *
 * Both read the same warm chunk cache inside the handle, which is why they are
 * one service and not two.
 *
 * Effect stops at the Layer. `analyze` sits on the keystroke path, so it is a
 * plain synchronous function that throws a typed error rather than an effect
 * that must be run: a fiber per keystroke is a budget we do not have. The
 * Layer owns the wasm instance's lifetime (scoped, finalized) and the version
 * handshake, because those are exactly the things a lifetime and a typed
 * failure are for.
 */

import { Context, Data, Effect, Layer, Option, Result } from "effect";

import manifest from "../../../vendor/galley/manifest.json";
import {
  deserialize,
  declaredVersion,
  FORMAT_VERSION as ONION_FORMAT_VERSION,
} from "../../../vendor/galley/onion-reader";
import {
  Galley as GalleyHandle,
  initSync,
  type SousSettings as SousSettingsHandle,
} from "../../../vendor/galley/pkg-web/usfm_galley.js";
// The whole namespace as well as the two names above: Onion's stateless doors
// (diff, merge, format…) arrive as FREE FUNCTIONS on the module rather than as
// methods on the handle, and `diff.ts` and `format.ts` bind them by name off
// this namespace. v0.1.0 is the build that carries them.
import * as wasmModule from "../../../vendor/galley/pkg-web/usfm_galley.js";
import {
  FindingsSnapshot,
  FORMAT_VERSION as SOUS_FORMAT_VERSION,
} from "../../../vendor/galley/sous-reader";
import { Census, FORMAT_VERSION as TOC_FORMAT_VERSION } from "../../../vendor/galley/toc-reader";
import type { BookCensus } from "../../../vendor/galley/toc-reader";
import { Observability, type ObservabilityService } from "../observability";
import type { Analysis, DiagnosticView } from "./analysis";
import {
  engineDiff,
  engineMerge,
  type DecisionMap,
  type DiffSkeleton,
  type EngineDoorMissing,
  type MergeSide,
  type TextMode,
} from "./diff";
import { engineFormatEdits, readEdits, type FormatEdits, type FormatOptions } from "./format";
import {
  decodeEquivalent,
  decodeOverlay,
  decodeBlockSkeleton,
  overlayOptions,
  type BlockAddress,
  type Equivalent,
  type OverlayEdits,
  type OverlayOptions,
  type Skeleton,
} from "./overlay";

// The VALUE, not just the type: the corpus half's other implementation
// (`src/platform/tauri/corpus.ts`) opens a buffer the native engine produced,
// and the rule that nothing outside `src/core/galley` imports `vendor/` holds
// for the reader too.
export { FindingsSnapshot };
export type { Finding, Pattern, BookView } from "../../../vendor/galley/sous-reader";
// The pattern table's own vocabulary. Re-exported (not re-declared) so that a
// reader of the table — `src/core/findings/inventory.ts` — names the same
// closed sets the wire does, and a channel added upstream is a type error here
// rather than a silently unhandled row.
export {
  CHANNELS,
  CONVENTION_REASONS,
  OUTER_CLASSES,
  PATTERN_DIGIT_GLYPH,
  POOLS,
} from "../../../vendor/galley/sous-reader";
export type {
  Channel,
  ConventionReason,
  OuterClass,
  PatternKey,
  Pool,
} from "../../../vendor/galley/sous-reader";
// The census reader, same rule: `toc`/`census` answer these classes, and the
// sidebar reads chapter counts off them without learning a layout.
export { Census };
export type { BookCensus, ChapterRow, VerseRow } from "../../../vendor/galley/toc-reader";

/** The wasm module could not be instantiated at all. */
export class EngineLoadError extends Data.TaggedError("EngineLoadError")<{
  readonly reason: string;
  readonly cause?: unknown;
}> {}

/**
 * The artifact on disk speaks a wire format this build's readers do not.
 * Refusing here is the point: a silently mismatched buffer decodes into
 * plausible nonsense, and nonsense about scripture structure is worse than a
 * boot failure.
 */
export class VersionMismatch extends Data.TaggedError("VersionMismatch")<{
  readonly wire: "onion" | "sous" | "find" | "toc";
  readonly found: number;
  readonly expected: number;
}> {}

/**
 * Text was offered to the engine that violates the contract every door here
 * documents. Thrown, not returned, because `analyze` is synchronous and this
 * is a caller bug: canonical text is LF, and `Source.decode`/`Source.apply`
 * already refuse `\r` on the way in.
 */
export class EngineInputError extends Data.TaggedError("EngineInputError")<{
  readonly reason: string;
}> {}

/** Engine identity, for the about box and for evidence in a bug report. */
export interface EngineVersion {
  readonly engine: string;
  /** The tag `vendor/galley` was taken from — `v0.1.0`. */
  readonly tag: string;
  readonly revision: string;
  readonly onionFormat: number;
  readonly sousFormat: number;
  readonly findFormat: number;
  readonly tocFormat: number;
}

/**
 * Sous's judging settings, as a plain object.
 *
 * The wasm `SousSettings` — `Knobs` before scripture-kitchen v0.1.0 — is a
 * handle that must be freed, and its field names are the Rust config's, kept
 * verbatim so this object and the engine's own documentation read the same.
 * Copies cross this boundary in both directions; no caller ever holds the
 * handle.
 *
 * `presence`, `source_copy` and `source_copy_min_run` are v0.1.0's three new
 * lanes: presence judges verse coverage against a paired reference and is ON,
 * source-copy counts consecutive words a target shares with its paired source
 * verse and is OFF, because a legitimately borrowed name would otherwise be a
 * finding in every verse that carries one.
 */
export interface SousSettings {
  readonly casing: boolean;
  readonly doubled: boolean;
  readonly doubles_productive_bp: number;
  readonly exact_neighbor: boolean;
  readonly lengths_enabled: boolean;
  readonly letter_runs: boolean;
  readonly min_verses: number;
  readonly placement: boolean;
  readonly pooled_neighbor: boolean;
  readonly presence: boolean;
  readonly rarity: boolean;
  readonly run_shape: boolean;
  readonly sentence_start: boolean;
  readonly sentence_start_upper_bp: number;
  readonly source_copy: boolean;
  readonly source_copy_min_run: number;
  readonly support_floor: number;
  readonly terminal_upper_share_bp: number;
  readonly word_length: boolean;
  readonly word_length_sigma: number;
  readonly word_support_floor: number;
  readonly z_long: number;
  readonly z_short: number;
}

// ---------------------------------------------------------------------------
// Find, through the engine
// ---------------------------------------------------------------------------

/**
 * What to look for. LITERAL — never a pattern.
 *
 * The engine's find is `memmem` over the projection; there is no regex on that
 * side and the `regex` crate is deliberately not one of its dependencies. A
 * regex query belongs to the raw-text scan in `src/core/search/search.ts`,
 * which says which query goes which way.
 */
export interface FindQuery {
  readonly text: string;
  /** Off by default, which is the simple lowercase fold — not a collator. */
  readonly caseSensitive?: boolean;
  /** The words rule the engine restates in `galley/src/find.md`. */
  readonly wholeWord?: boolean;
  /** Total hits, not per book. Omitted means no bound. */
  readonly limit?: number;
}

/**
 * Which registered books a project-wide find reads.
 *
 * `targets` is the project's own books and is the default. `references` is the
 * Library-bound source and reference resources `ProjectAnalysis.attach`
 * registered with their text (`updateReference(id, text, true)`); one
 * registered without it retains nothing to search and is in no scope at all,
 * which is why the Reference segment on `/find` is disabled until one is bound.
 */
export type FindScope = "targets" | "references" | "all";

/** Half-open, in UTF-16 units. */
export interface EngineRange {
  readonly from: number;
  readonly to: number;
}

/**
 * One hit of the engine's find, in BOTH coordinate spaces.
 *
 * `projected` is where the hit sits in the verse-text projection — what the
 * reader sees in visual mode — and `source` is where its bytes are in the
 * canonical USFM, which is where an edit has to land. They are not the same
 * interval, and the difference is not a rounding error: a hit that crosses
 * markup the projection dropped covers source that it does not cover in the
 * projection. So `source` is one range PER CONTIGUOUS PIECE, in order, and
 * `source.length > 1` means the hit spans markup — the ranges between the
 * pieces are exactly what the projection left out.
 *
 * `preview` is the projected text around the hit, ellipsed for a result card.
 * Display only: it is trimmed and elided, so no offset may be read back out of
 * it. It comes from the engine because the projection is materialized for the
 * search and dropped with it (`galley/src/wasm.md`, "The find buffer").
 */
export interface EngineHit {
  /** The caller's own book id, absent only from a single-book `find`. */
  readonly bookId?: string;
  readonly projected: EngineRange;
  readonly source: readonly EngineRange[];
  readonly preview: string;
}

/**
 * `FIND` in ASCII, read out of the buffer's first four bytes in order.
 *
 * New at scripture-kitchen v0.1.0 (`galley/src/find.rs`, `wire::MAGIC`), and
 * the thing engine-asks item 5 asked for: the onion and sous buffers both lead
 * with a magic and a version, and the find buffer did not, so a reordered
 * record could only be caught by the nonsense it produced.
 */
export const FIND_MAGIC = 0x444e_4946;

/** The layout `decodeHits` below knows. A buffer claiming another one stops. */
export const FIND_FORMAT_VERSION = 1;

/**
 * Decodes the find buffer both engine doors emit — the wasm handle here and
 * the native `Expediter` behind `src/platform/tauri/corpus.ts`.
 *
 * The layout is stated once, in `galley/src/wasm.md` ("The find buffer"):
 * magic and version, then `hitCount` and `bookCount`, then little-endian `u32`
 * throughout, UTF-16 offsets, the two length arrays before the byte blob so
 * every word stays four-byte aligned.
 *
 * THROWS `VersionMismatch` on a header it does not know, and does not try to
 * read the rest: a find buffer decoded against the wrong layout yields hit
 * ranges that look like offsets into scripture and are not, and an editor that
 * acted on one would splice the wrong text. Thrown rather than returned
 * because this is the same synchronous path `analyze` is on; the corpus port
 * wraps it in `Effect.try` and reports `Engine`.
 *
 * Exported because the desktop door reads the same bytes off IPC; nothing
 * outside `src/core/galley` decodes an engine buffer.
 */
/**
 * `FindOptions` as the v0.1.1 doors take it: one object, every key optional,
 * defaults applied on the Rust side.
 *
 * Built rather than passed through because the engine REFUSES a key it does
 * not know and refuses `scope` on `find` by name — so the one place that knows
 * which door is being opened is the one place that decides whether `scope`
 * goes in the object. The generated `.d.ts` types the parameter `any`, which
 * is why this returns a shape rather than relying on the call site.
 */
const findOptions = (query: FindQuery, scope?: FindScope): Record<string, unknown> => ({
  ...(query.caseSensitive === undefined ? {} : { caseSensitive: query.caseSensitive }),
  ...(query.wholeWord === undefined ? {} : { wholeWord: query.wholeWord }),
  ...(query.limit === undefined ? {} : { limit: query.limit }),
  ...(scope === undefined ? {} : { scope }),
});

export const decodeHits = (bytes: Uint8Array): readonly EngineHit[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (index: number): number => view.getUint32(index * 4, true);

  const magic = word(0);
  if (magic !== FIND_MAGIC)
    throw new VersionMismatch({ wire: "find", found: magic, expected: FIND_MAGIC });
  const version = word(1);
  if (version !== FIND_FORMAT_VERSION)
    throw new VersionMismatch({ wire: "find", found: version, expected: FIND_FORMAT_VERSION });

  const hitCount = word(2);
  const bookCount = word(3);
  let at = 4;

  // Pass one: the fixed-width hit records, whose width varies with the piece
  // count, so the id and preview tables cannot be found without walking them.
  const records: {
    readonly book: number;
    readonly projected: EngineRange;
    readonly source: EngineRange[];
  }[] = [];
  for (let hit = 0; hit < hitCount; hit += 1) {
    const book = word(at);
    const projected = { from: word(at + 1), to: word(at + 2) };
    const pieces = word(at + 3);
    at += 4;
    const source: EngineRange[] = [];
    for (let piece = 0; piece < pieces; piece += 1)
      source.push({ from: word(at + piece * 2), to: word(at + piece * 2 + 1) });
    at += pieces * 2;
    records.push({ book, projected, source });
  }

  const idLengths: number[] = [];
  for (let book = 0; book < bookCount; book += 1) idLengths.push(word(at + book));
  at += bookCount;
  const previewLengths: number[] = [];
  for (let hit = 0; hit < hitCount; hit += 1) previewLengths.push(word(at + hit));
  at += hitCount;

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let cursor = at * 4;
  const take = (length: number): string => {
    const text = decoder.decode(bytes.subarray(cursor, cursor + length));
    cursor += length;
    return text;
  };
  const ids = idLengths.map(take);
  const previews = previewLengths.map(take);

  return records.map((record, index) => ({
    bookId: ids[record.book],
    projected: record.projected,
    source: record.source,
    // SAFETY: `previews` was built from `previewLengths`, which has one entry
    // per hit record, so every record index is inside it.
    preview: previews[index]!,
  }));
};

type SettingKey = keyof SousSettings;

const SETTING_KEYS: readonly SettingKey[] = [
  "casing",
  "doubled",
  "doubles_productive_bp",
  "exact_neighbor",
  "lengths_enabled",
  "letter_runs",
  "min_verses",
  "placement",
  "pooled_neighbor",
  "presence",
  "rarity",
  "run_shape",
  "sentence_start",
  "sentence_start_upper_bp",
  "source_copy",
  "source_copy_min_run",
  "support_floor",
  "terminal_upper_share_bp",
  "word_length",
  "word_length_sigma",
  "word_support_floor",
  "z_long",
  "z_short",
];

export interface GalleyService {
  /** What artifact this is. Read from the manifest, not from the wasm. */
  readonly version: () => EngineVersion;

  /**
   * Parse one book. SYNCHRONOUS, and the only USFM parse in the app.
   *
   * Always asks for the one wants set — diagnostics, toc, UTF-16 offsets —
   * because structure and diagnostics come out of the same walk and the editor
   * needs both on the same keystroke. There is no cheaper mode worth a second
   * code path.
   *
   * Throws `EngineInputError` when `text` contains `\r`.
   *
   * `id` chooses the DOOR, not just the label. Given one, this registers the
   * text (`update`) and then parses off the retained copy (`parse(id)`);
   * without one it goes through the loose-text door. The id door is the
   * cheaper of the two for anything the corpus holds anyway — the engine's own
   * numbers put ~85% of a warm parse in plating the wire buffer and marshalling
   * the string back across the wall, and the id door marshals no string in.
   *
   * The ordering is the contract: `parse(id)` answers off what `update` last
   * retained, so the two happen here, together, and a caller cannot get a
   * parse of yesterday's text by holding the id.
   */
  readonly analyze: (text: string, why?: string, id?: string) => Analysis;

  /**
   * One registered book's diagnostics, without a parse buffer.
   *
   * About ten times cheaper than `analyze` on the same book, because it plates
   * only the diagnostics section: no tree, no tokens, no UTF-16 table crossing
   * the wall. This is the door for the sixty-five books nobody is looking at —
   * their findings are wanted, their CodeMirror decorations are not.
   *
   * The book must be registered; `update` it first.
   */
  readonly lint: (id: string, why?: string) => readonly DiagnosticView[];

  /**
   * One registered book's census — chapter count, verse count, chapter rows —
   * off the `Toc` that `update` already built.
   *
   * Nothing is derived: no chunk is resolved, no text is read, no wire is
   * plated. This is what a sidebar and a chapter picker want, and asking for
   * it is what takes one parse per book off a project's open.
   */
  readonly toc: (id: string) => BookCensus | undefined;

  /**
   * The same over every registered book, in canonical book order — the
   * project-wide census in one call.
   *
   * Offsets are bytes, not UTF-16: the table that rebases them travels with a
   * book's text, and a census spans books. Counts are unit-free, so a sidebar
   * never notices.
   */
  readonly census: () => Census;

  /**
   * A memo for one Book: the same text returns the same `Analysis` instance.
   *
   * One per Book, held by whatever owns that Book's editor state. A gesture
   * that reads the analysis three times costs one parse, and a keystroke that
   * lands the same text (an undo back to where we were) costs none.
   */
  readonly memoize: (id?: string) => (text: string) => Analysis;

  /**
   * Register or replace one whole book as a proofreading target, by the
   * caller's own id. Returns the `\id` line's canonical book code.
   */
  readonly update: (id: string, text: string) => string;

  /**
   * The same, as a declared source. A reference publishes no findings; it is
   * the denominator a target is compared against.
   *
   * `keepText` — omitted is `false` — makes it retain the text, the mask and
   * the UTF-16 table a target retains too, which is what `find`'s `references`
   * scope and the overlay doors read. It costs what a target costs minus the
   * resident analysis, so a reference nobody searches or overlays stays off it
   * and remains verse lengths only.
   */
  readonly updateReference: (id: string, text: string, keepText?: boolean) => string;

  /** Drop a book and its cached rows. `false` when the id was never known. */
  readonly remove: (id: string) => boolean;

  /**
   * One complete corpus publication. A snapshot replaces the previous one
   * whole — row positions are valid only inside the buffer they came from, so
   * never hold findings from an older snapshot beside a newer one.
   */
  readonly publish: () => FindingsSnapshot;

  /**
   * Literal find over ONE registered book's verse-text projection.
   *
   * Searches what the reader sees: a needle inside a footnote is not found,
   * and a needle that spans one comes back with one source range per
   * contiguous piece. Since v0.1.0 ANY registered book that retains text may
   * be searched — a target, or a reference registered with `keepText` — and it
   * throws only when the book retains none, because a corpus that has not been
   * told about the book would otherwise report it clean.
   */
  readonly find: (id: string, query: FindQuery) => readonly EngineHit[];

  /**
   * The same over every searchable book in `scope`, in canonical book order.
   * Every hit carries its `bookId`, so no second call is needed to place one.
   * `scope` omitted is `targets`.
   */
  readonly findAll: (query: FindQuery, scope?: FindScope) => readonly EngineHit[];

  /** A copy of the settings the next `publish` judges with. */
  readonly settings: () => SousSettings;

  /** Replace some settings. Costs a re-judge, not a re-map. */
  readonly setSettings: (patch: Partial<SousSettings>) => void;

  /** Resident bytes across the whole handle: texts, products, cached rows. */
  readonly residentBytes: () => number;

  /**
   * Onion's decision-unit diff of two whole USFM documents.
   *
   * `textMode` is the intra-unit grain a `modified` unit's word marks come
   * back at, and it defaults to `words` because that is what the review screen
   * shows. Spans are UTF-16 into each side's own document.
   *
   * It is still a `Result`: the door is a free function on the wasm module,
   * probed by name, so an artifact that lost it refuses by name
   * (`DIFF_DOOR`) instead of being quietly replaced by a second opinion about
   * scripture structure. There is no interim diff any more — Will, 2026-09-15.
   */
  readonly diff: (
    baseline: string,
    current: string,
    textMode?: TextMode,
  ) => Result.Result<DiffSkeleton, EngineDoorMissing>;

  /**
   * The merged document under a decision map, `{unitId: "baseline"|"current"}`.
   *
   * `fallback` is what an undecided unit takes and is never defaulted here —
   * that is the whole safety question of a merge and it belongs to the caller.
   * An unknown unit id rejects loudly inside the engine rather than falling
   * back fuzzily; the caller re-diffs.
   */
  readonly merge: (
    baseline: string,
    current: string,
    decisions: DecisionMap,
    fallback: MergeSide,
  ) => Result.Result<string, EngineDoorMissing>;

  /**
   * Onion's formatter, as EDITS rather than a rewritten document.
   *
   * Edits, so the whole normalisation goes through `book.apply` as ONE
   * transaction and Undo takes it back in one step — a replaced document would
   * be one enormous change that no reviewer could read. Offsets are UTF-16
   * always: `formatEdits` converts on the way out, and the unit is a property
   * of the call, not of the engine.
   *
   * `opts` is omitted by every caller today; the formatter's defaults are the
   * engine's `FormatOptions::default`, and choosing among a dozen switches is a
   * settings surface Sefer has not designed.
   */
  readonly formatEdits: (
    text: string,
    opts?: FormatOptions,
  ) => Result.Result<FormatEdits, EngineDoorMissing>;

  /**
   * One registered book's block structure — the verses and the block markers
   * hanging off them, addressed so the two sides of an overlay can be matched
   * in TypeScript.
   *
   * Offsets are UTF-16, like everything else that reaches a screen. Throws
   * when the book retains no text (`updateReference` without `keepText`).
   */
  readonly skeleton: (id: string, opts?: OverlayOptions) => Skeleton;

  /**
   * The edits that make `targetId`'s skeleton `sourceId`'s, exactly — MATCH
   * FORMATTING, as one applicable transaction plus the report of what it did.
   *
   * A source block the target lacks is inserted; an inside block arrives EMPTY
   * (`report.inserted[].empty`), because where a verse's text splits is
   * unknowable across languages and the translator pastes each line into place.
   * A target block the source lacks is removed and its text joins the block
   * before it. Offsets are UTF-16.
   *
   * An overlay is a SUGGESTION applied on request, never a finding.
   */
  readonly overlay: (targetId: string, sourceId: string, opts?: OverlayOptions) => OverlayEdits;

  /**
   * Where one SOURCE block's address lands in the target: the node that is
   * already there, where the overlay would put one, or the news that the verse
   * itself has no pair. `address.marker` is required and a stale one THROWS
   * rather than answering about a different node.
   */
  readonly targetNodeFor: (
    targetId: string,
    sourceId: string,
    address: BlockAddress,
    opts?: OverlayOptions,
  ) => Equivalent;

  /** The mirror: a TARGET block's address, answered in the source. */
  readonly sourceNodeFor: (
    targetId: string,
    sourceId: string,
    address: BlockAddress,
    opts?: OverlayOptions,
  ) => Equivalent;

  /**
   * Has this registered book's text moved since it was last registered?
   *
   * `undefined` when the id is not registered, which is the question a caller
   * asks before deciding to register it. Cheaper than a re-parse and cheaper
   * than a hash of the whole document: the answer is chunk membership, so a
   * chapter that only moved is not reported as rework.
   */
  readonly changedSinceUpdate: (id: string, text: string) => boolean | undefined;

  /**
   * How many declared sources the last publication's source-copy lane wanted
   * to read and could not, because they were registered while the lane was off
   * and so kept no word lane.
   *
   * A count, which is what the engine keeps — nonzero means "re-send those
   * references' text", not "nothing was found". It is a LIBRARY note, never a
   * finding about scripture: the bindings cannot answer the lane they were
   * bound for, and that is a fact about the project's setup.
   */
  readonly wordlessReferences: () => number;

  /**
   * Free the wasm handle. IDEMPOTENT: the first call frees the pointer and
   * drops it, and every later call does nothing — the Layer's finalizer goes
   * through this same door, so a caller who disposes early does not double
   * free. Every method above is undefined behaviour afterwards.
   */
  readonly dispose: () => void;
}

export class Galley extends Context.Service<Galley, GalleyService>()("Galley") {}

/** The shape of `vendor/galley/manifest.json` that `accepts` reads. */
export interface EngineManifest {
  readonly wire: {
    readonly onion: { readonly formatVersion: number };
    readonly sous: { readonly formatVersion: number };
    readonly find: { readonly magic: number; readonly formatVersion: number };
    readonly toc: { readonly formatVersion: number };
  };
}

/**
 * Does this build's readers speak the artifact's wire formats?
 *
 * The onion and sous versions are compared against the READERS' own
 * `FORMAT_VERSION` constants rather than numbers written here, so a
 * regenerated reader and a stale `manifest.json` disagree loudly instead of
 * agreeing with a copy of neither.
 *
 * The find buffer has no generated reader — `decodeHits` in this file is it —
 * so its magic and version are compared against this module's own constants,
 * which is the same discipline with the reader and the constant in one place.
 * v0.1.0 is where the find buffer acquired a header at all (engine-asks 5).
 */
export const accepts = (artifact: EngineManifest): Result.Result<void, VersionMismatch> => {
  if (artifact.wire.onion.formatVersion !== ONION_FORMAT_VERSION) {
    return Result.fail(
      new VersionMismatch({
        wire: "onion",
        found: artifact.wire.onion.formatVersion,
        expected: ONION_FORMAT_VERSION,
      }),
    );
  }
  if (artifact.wire.sous.formatVersion !== SOUS_FORMAT_VERSION) {
    return Result.fail(
      new VersionMismatch({
        wire: "sous",
        found: artifact.wire.sous.formatVersion,
        expected: SOUS_FORMAT_VERSION,
      }),
    );
  }
  if (artifact.wire.find.magic !== FIND_MAGIC) {
    return Result.fail(
      new VersionMismatch({ wire: "find", found: artifact.wire.find.magic, expected: FIND_MAGIC }),
    );
  }
  if (artifact.wire.find.formatVersion !== FIND_FORMAT_VERSION) {
    return Result.fail(
      new VersionMismatch({
        wire: "find",
        found: artifact.wire.find.formatVersion,
        expected: FIND_FORMAT_VERSION,
      }),
    );
  }
  if (artifact.wire.toc.formatVersion !== TOC_FORMAT_VERSION) {
    return Result.fail(
      new VersionMismatch({
        wire: "toc",
        found: artifact.wire.toc.formatVersion,
        expected: TOC_FORMAT_VERSION,
      }),
    );
  }
  return Result.succeed(undefined);
};

const engineVersion = (): EngineVersion => ({
  engine: manifest.engine.crate,
  tag: manifest.engine.tag,
  revision: manifest.engine.revision,
  onionFormat: manifest.wire.onion.formatVersion,
  sousFormat: manifest.wire.sous.formatVersion,
  findFormat: manifest.wire.find.formatVersion,
  tocFormat: manifest.wire.toc.formatVersion,
});

const readSettings = (held: SousSettingsHandle): SousSettings => ({
  casing: held.casing,
  doubled: held.doubled,
  doubles_productive_bp: held.doubles_productive_bp,
  exact_neighbor: held.exact_neighbor,
  lengths_enabled: held.lengths_enabled,
  letter_runs: held.letter_runs,
  min_verses: held.min_verses,
  placement: held.placement,
  pooled_neighbor: held.pooled_neighbor,
  presence: held.presence,
  rarity: held.rarity,
  run_shape: held.run_shape,
  sentence_start: held.sentence_start,
  sentence_start_upper_bp: held.sentence_start_upper_bp,
  source_copy: held.source_copy,
  source_copy_min_run: held.source_copy_min_run,
  support_floor: held.support_floor,
  terminal_upper_share_bp: held.terminal_upper_share_bp,
  word_length: held.word_length,
  word_length_sigma: held.word_length_sigma,
  word_support_floor: held.word_support_floor,
  z_long: held.z_long,
  z_short: held.z_short,
});

const writeSettings = (held: SousSettingsHandle, patch: Partial<SousSettings>): void => {
  // SAFETY: every SETTING_KEYS entry is a declared mutable field of
  // `SousSettings` (see pkg-web/usfm_galley.d.ts), and Sefer's own
  // `SousSettings` gives each the same type.
  const target = held as Record<SettingKey, boolean | number>;
  for (const key of SETTING_KEYS) {
    const value = patch[key];
    if (value !== undefined) target[key] = value;
  }
};

/**
 * `initSync` instantiates into module-global state inside the generated glue,
 * so a second call is at best wasted work and at worst a throw. Sefer has one
 * engine per process; the guard makes a second `GalleyLive` (a test suite, a
 * second window on one worker) reuse the instance rather than fight it.
 */
let instantiated = false;

const instantiate = (bytes: Uint8Array): Effect.Effect<void, EngineLoadError> =>
  Effect.try({
    try: () => {
      if (instantiated) return;
      initSync({ module: bytes });
      instantiated = true;
    },
    catch: (cause) => new EngineLoadError({ reason: "initSync refused the wasm module", cause }),
  });

const makeService = (
  handle: GalleyHandle,
  observability: Option.Option<ObservabilityService>,
): GalleyService => {
  const observe = Option.getOrUndefined(observability);
  let revision = 0;

  /**
   * The handle, until it is freed. `dispose` takes it out of this slot before
   * calling `free()`, so the pointer is released exactly once however many
   * times dispose is called: `wasm-bindgen`'s `free()` zeroes the pointer and
   * unregisters the finalizer, so a second call on the same object is a double
   * free of the Rust allocation. One owner, one free — and the Layer's
   * finalizer goes through this same door rather than round it.
   */
  let live: GalleyHandle | null = handle;

  const dispose = (): void => {
    const held = live;
    live = null;
    held?.free();
  };

  const analyze = (text: string, why = "unnamed", id?: string): Analysis => {
    if (text.includes("\r")) {
      throw new EngineInputError({
        reason: "canonical text is LF; the engine refuses a carriage return",
      });
    }
    // `why` is the door: there are several into this parse and the timing of
    // one says nothing without knowing which fired. See `memoize`.
    // `id` is a label the caller already has, not the engine learning about
    // Books: the parse is over text and stays that way. Without it "which of
    // these 66 parses was slow" has no answer.
    const done = observe?.span("galley.parse", undefined, {
      "galley.why": why,
      "galley.text_length": text.length,
      ...(id === undefined ? {} : { "book.id": id }),
    });
    const started = performance.now();
    // Two doors, and `id` picks between them.
    //
    // With an id: register the text and parse off the retained copy. The
    // corpus has to learn this text anyway — it is a proofreading target — so
    // the register is not a cost this path added, and what it buys is a parse
    // that marshals no string across the wall. The engine's own numbers put
    // most of a warm parse in the marshal and the wire plate.
    //
    // Without one: the loose-text door, for text the corpus does not hold —
    // a reference pane, a review reading, a STET excerpt.
    //
    // The order is the contract. `parse(id)` answers off whatever `update`
    // last retained, so nothing may run between them, which is why both are
    // here rather than at two call sites that merely intend to be adjacent.
    const dish = deserialize(
      id === undefined
        ? handle.parseText(text, true, true, true)
        : (handle.update(id, text), handle.parse(id, true, true, true)),
    );
    const engineMs = Math.round((performance.now() - started) * 1000) / 1000;
    // Counts and codes only — a diagnostic's message quotes the document. On
    // the span that measured the parse, not a note beside it saying the same
    // thing under the same name.
    done?.({ "galley.diagnostics": dish.diagnostics.length, "galley.engine_ms": engineMs });
    revision += 1;
    return {
      dish,
      text,
      docLen: text.length,
      sourceHash: dish.sourceHash,
      revision,
      engineMs,
      usfmVersion: declaredVersion(dish),
    };
  };

  const lint = (id: string, why = "unnamed"): readonly DiagnosticView[] => {
    const done = observe?.span("galley.lint", undefined, {
      "galley.why": why,
      "book.id": id,
    });
    const started = performance.now();
    // The same reader the parse buffer uses: upstream plates a lint report as
    // a parse buffer with only the diagnostics section asked for, so there is
    // no second layout to learn and no second decoder to keep true.
    const dish = deserialize(handle.lint(id));
    // Materialised, not handed back as a cursor. The cursor reads a buffer
    // this function owns and nothing else holds, and a caller that kept one
    // past the next call would be reading whatever the engine plated next.
    const found = [...dish.diagnostics];
    done?.({
      "galley.diagnostics": found.length,
      "galley.engine_ms": Math.round((performance.now() - started) * 1000) / 1000,
    });
    return found;
  };

  const toc = (id: string): BookCensus | undefined => {
    // UTF-16, because a chapter row's offsets are handed to CodeMirror. The
    // project-wide `census` cannot do this — the table that rebases offsets
    // travels with one book's text — which is why it answers counts only.
    const census = Census.open(handle.toc(id, true));
    return census.bookCount === 0 ? undefined : census.book(0);
  };

  const memoize = (id?: string): ((text: string) => Analysis) => {
    let last: Analysis | undefined;
    return (text: string): Analysis => {
      if (last !== undefined && last.text === text) return last;
      last = analyze(text, "editor", id);
      return last;
    };
  };

  const settings = (): SousSettings => {
    const held = handle.config();
    try {
      return readSettings(held);
    } finally {
      held.free();
    }
  };

  const setSettings = (patch: Partial<SousSettings>): void => {
    const held = handle.config();
    try {
      writeSettings(held, patch);
      handle.setConfig(held);
    } finally {
      held.free();
    }
  };

  /**
   * One overlay call's edits, read out and freed.
   *
   * `overlay` answers the same `Edits` class `formatEdits` does, which is the
   * whole point of the shape: an editor applies an overlay exactly as it
   * applies a fix, through one `book.apply`.
   */
  const overlayEdits = (
    targetId: string,
    sourceId: string,
    opts?: OverlayOptions,
  ): OverlayEdits => {
    const wire = overlayOptions(opts);
    const held = handle.overlay(targetId, sourceId, wire);
    try {
      return decodeOverlay(readEdits(held), handle.overlayReport(targetId, sourceId, wire));
    } finally {
      held.free();
    }
  };

  return {
    version: engineVersion,
    analyze,
    memoize,
    lint,
    toc,
    census: () => Census.open(handle.tocAll(undefined, undefined)),
    find: (id, query) => decodeHits(handle.find(id, query.text, findOptions(query))),
    findAll: (query, scope) =>
      decodeHits(handle.findAll(query.text, findOptions(query, scope ?? "targets"))),
    update: (id, text) => handle.update(id, text),
    updateReference: (id, text, keepText) => handle.updateReference(id, text, keepText === true),
    remove: (id) => handle.remove(id),
    publish: () => FindingsSnapshot.open(handle.publish()),
    // Probed on the MODULE, where the stateless doors live: they are free
    // functions, not handle methods, so an artifact that is not the vendored
    // build refuses by name rather than throwing a `TypeError` about
    // `undefined`.
    diff: (baseline, current, textMode) => engineDiff(wasmModule, baseline, current, textMode),
    merge: (baseline, current, decisions, fallback) =>
      engineMerge(wasmModule, baseline, current, decisions, fallback),
    formatEdits: (text, opts) => engineFormatEdits(wasmModule, text, opts),
    skeleton: (id, opts) => decodeBlockSkeleton(handle.skeleton(id, overlayOptions(opts), true)),
    overlay: overlayEdits,
    targetNodeFor: (targetId, sourceId, address, opts) =>
      decodeEquivalent(
        handle.targetNodeFor(targetId, sourceId, address, overlayOptions(opts), true),
      ),
    sourceNodeFor: (targetId, sourceId, address, opts) =>
      decodeEquivalent(
        handle.sourceNodeFor(targetId, sourceId, address, overlayOptions(opts), true),
      ),
    // `undefined` is "not registered", which is the question a caller asks
    // before deciding to register it; an empty range list is "registered and
    // unchanged". The two are different answers and neither is a boolean on
    // its own, which is why the engine's `Uint32Array | undefined` is narrowed
    // here rather than upstream.
    changedSinceUpdate: (id, text) => {
      const changed = handle.changedSinceUpdate(id, text);
      return changed === undefined ? undefined : changed.length > 0;
    },
    wordlessReferences: () => handle.lastWordlessReferences(),
    settings,
    setSettings,
    residentBytes: () => handle.residentBytes(),
    dispose,
  };
};

/**
 * The Layer: instantiate the wasm once, check the wire handshake, and hand out
 * one handle whose life is the Layer's.
 *
 * Takes bytes rather than fetching them, so `src/core` stays free of both
 * `node:fs` and `fetch`. The hosts in `src/platform/{node,web}/galley.ts`
 * supply them.
 */
export const GalleyLive = (
  bytes: Uint8Array,
): Layer.Layer<Galley, EngineLoadError | VersionMismatch> =>
  Layer.effect(
    Galley,
    Effect.gen(function* () {
      yield* Effect.fromResult(accepts(manifest));
      yield* instantiate(bytes);
      const observability = yield* Effect.serviceOption(Observability);
      const handle = yield* Effect.try({
        try: () => new GalleyHandle(),
        catch: (cause) =>
          new EngineLoadError({ reason: "the engine handle would not open", cause }),
      });
      const service = makeService(handle, observability);
      // The finalizer frees through the service, not through the handle: that
      // is the one door that knows whether the pointer is still ours, so a
      // caller who disposed early and the scope closing afterwards free once
      // between them.
      yield* Effect.addFinalizer(() => Effect.sync(() => service.dispose()));
      return service;
    }),
  );
