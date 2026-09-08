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
  type Knobs,
} from "../../../vendor/galley/pkg-web/usfm_galley.js";
import {
  FindingsSnapshot,
  FORMAT_VERSION as SOUS_FORMAT_VERSION,
} from "../../../vendor/galley/sous-reader";
import { Observability, type ObservabilityService } from "../observability";
import type { Analysis } from "./analysis";

// The VALUE, not just the type: the corpus half's other implementation
// (`src/platform/tauri/corpus.ts`) opens a buffer the native engine produced,
// and the rule that nothing outside `src/core/galley` imports `vendor/` holds
// for the reader too.
export { FindingsSnapshot };
export type { Finding, Pattern, BookView } from "../../../vendor/galley/sous-reader";

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
  readonly wire: "onion" | "sous";
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
  readonly revision: string;
  readonly onionFormat: number;
  readonly sousFormat: number;
}

/**
 * The judging knobs, as a plain object.
 *
 * The wasm `Knobs` is a handle that must be freed, and its field names are the
 * Rust config's — kept verbatim so this object and the engine's own
 * documentation read the same. Copies cross this boundary in both directions;
 * no caller ever holds a `Knobs`.
 */
export interface KnobValues {
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
 * Decodes the find buffer both engine doors emit — the wasm handle here and
 * the native `Expediter` behind `src/platform/tauri/corpus.ts`.
 *
 * The layout is stated once, in `galley/src/wasm.md` ("The find buffer"):
 * little-endian `u32` throughout, UTF-16 offsets, the two length arrays before
 * the byte blob so every word stays four-byte aligned.
 *
 * Exported because the desktop door reads the same bytes off IPC; nothing
 * outside `src/core/galley` decodes an engine buffer.
 */
export const decodeHits = (bytes: Uint8Array): readonly EngineHit[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (index: number): number => view.getUint32(index * 4, true);

  const hitCount = word(0);
  const bookCount = word(1);
  let at = 2;

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

type KnobKey = keyof KnobValues;

const KNOB_KEYS: readonly KnobKey[] = [
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
   */
  readonly analyze: (text: string) => Analysis;

  /**
   * A memo for one Book: the same text returns the same `Analysis` instance.
   *
   * One per Book, held by whatever owns that Book's editor state. A gesture
   * that reads the analysis three times costs one parse, and a keystroke that
   * lands the same text (an undo back to where we were) costs none.
   */
  readonly memoize: () => (text: string) => Analysis;

  /**
   * Register or replace one whole book as a proofreading target, by the
   * caller's own id. Returns the `\id` line's canonical book code.
   */
  readonly update: (id: string, text: string) => string;

  /**
   * The same, as a declared source: verse lengths only, no text. A reference
   * publishes no findings; it is the denominator a target is compared against.
   */
  readonly updateReference: (id: string, text: string) => string;

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
   * contiguous piece. Synchronous, like `analyze`, and it throws the engine's
   * error when `id` is not a registered book — a corpus that has not been
   * told about the book would otherwise report it clean.
   */
  readonly find: (id: string, query: FindQuery) => readonly EngineHit[];

  /**
   * The same over every registered book, in canonical book order. Every hit
   * carries its `bookId`, so no second call is needed to place one.
   */
  readonly findAll: (query: FindQuery) => readonly EngineHit[];

  /** A copy of the knobs the next `publish` judges with. */
  readonly knobs: () => KnobValues;

  /** Replace some knobs. Costs a re-judge, not a re-map. */
  readonly setKnobs: (patch: Partial<KnobValues>) => void;

  /** Resident bytes across the whole handle: texts, products, cached rows. */
  readonly residentBytes: () => number;

  /**
   * Free the wasm handle. The Layer's finalizer calls this; callers do not.
   * Every method above is undefined behaviour afterwards.
   */
  readonly dispose: () => void;
}

export class Galley extends Context.Service<Galley, GalleyService>()("Galley") {}

/** The shape of `vendor/galley/manifest.json` that `accepts` reads. */
export interface EngineManifest {
  readonly wire: {
    readonly onion: { readonly formatVersion: number };
    readonly sous: { readonly formatVersion: number };
  };
}

/**
 * Does this build's readers speak the artifact's wire formats?
 *
 * Compared against the readers' own `FORMAT_VERSION` constants rather than a
 * number written here, so a regenerated `onion-reader.ts` and a stale
 * `manifest.json` disagree loudly instead of agreeing with a copy of neither.
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
  return Result.succeed(undefined);
};

const engineVersion = (): EngineVersion => ({
  engine: manifest.engine.crate,
  revision: manifest.engine.revision,
  onionFormat: manifest.wire.onion.formatVersion,
  sousFormat: manifest.wire.sous.formatVersion,
});

const readKnobs = (knobs: Knobs): KnobValues => ({
  casing: knobs.casing,
  doubled: knobs.doubled,
  doubles_productive_bp: knobs.doubles_productive_bp,
  exact_neighbor: knobs.exact_neighbor,
  lengths_enabled: knobs.lengths_enabled,
  letter_runs: knobs.letter_runs,
  min_verses: knobs.min_verses,
  placement: knobs.placement,
  pooled_neighbor: knobs.pooled_neighbor,
  presence: knobs.presence,
  rarity: knobs.rarity,
  run_shape: knobs.run_shape,
  sentence_start: knobs.sentence_start,
  sentence_start_upper_bp: knobs.sentence_start_upper_bp,
  source_copy: knobs.source_copy,
  source_copy_min_run: knobs.source_copy_min_run,
  support_floor: knobs.support_floor,
  terminal_upper_share_bp: knobs.terminal_upper_share_bp,
  word_length: knobs.word_length,
  word_length_sigma: knobs.word_length_sigma,
  word_support_floor: knobs.word_support_floor,
  z_long: knobs.z_long,
  z_short: knobs.z_short,
});

const writeKnobs = (knobs: Knobs, patch: Partial<KnobValues>): void => {
  // SAFETY: every KNOB_KEYS entry is a declared mutable field of `Knobs` (see
  // pkg-web/usfm_galley.d.ts), and `KnobValues` gives each the same type.
  const target = knobs as Record<KnobKey, boolean | number>;
  for (const key of KNOB_KEYS) {
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

  const analyze = (text: string): Analysis => {
    if (text.includes("\r")) {
      throw new EngineInputError({
        reason: "canonical text is LF; the engine refuses a carriage return",
      });
    }
    const done = observe?.span("analyze");
    const started = performance.now();
    const dish = deserialize(handle.parse(text, true, true, true));
    const engineMs = Math.round((performance.now() - started) * 1000) / 1000;
    done?.();
    // Counts and codes only — a diagnostic's message quotes the document.
    observe?.note("analyze", "ready", `diag=${dish.diagnostics.length}`);
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

  const memoize = (): ((text: string) => Analysis) => {
    let last: Analysis | undefined;
    return (text: string): Analysis => {
      if (last !== undefined && last.text === text) return last;
      last = analyze(text);
      return last;
    };
  };

  const knobs = (): KnobValues => {
    const held = handle.config();
    try {
      return readKnobs(held);
    } finally {
      held.free();
    }
  };

  const setKnobs = (patch: Partial<KnobValues>): void => {
    const held = handle.config();
    try {
      writeKnobs(held, patch);
      handle.setConfig(held);
    } finally {
      held.free();
    }
  };

  return {
    version: engineVersion,
    analyze,
    memoize,
    find: (id, query) =>
      decodeHits(
        handle.find(
          id,
          query.text,
          query.caseSensitive === true,
          query.wholeWord === true,
          query.limit ?? 0,
        ),
      ),
    findAll: (query) =>
      decodeHits(
        handle.findAll(
          query.text,
          query.caseSensitive === true,
          query.wholeWord === true,
          query.limit ?? 0,
        ),
      ),
    update: (id, text) => handle.update(id, text),
    updateReference: (id, text) => handle.updateReference(id, text),
    remove: (id) => handle.remove(id),
    publish: () => FindingsSnapshot.open(handle.publish()),
    knobs,
    setKnobs,
    residentBytes: () => handle.residentBytes(),
    dispose: () => handle.free(),
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
      yield* Effect.addFinalizer(() => Effect.sync(() => handle.free()));
      return makeService(handle, observability);
    }),
  );
