import type { Analysis, DiagnosticView } from "@sefer/text/engine/analysis";
import {
  Hits,
  FORMAT_VERSION as FIND_FORMAT_VERSION,
} from "@wycliffeassociates/scripture-kitchen/find-reader";
import { MaskMap } from "@wycliffeassociates/scripture-kitchen/mask-reader";
import {
  deserialize,
  declaredVersion,
  FORMAT_VERSION as ONION_FORMAT_VERSION,
} from "@wycliffeassociates/scripture-kitchen/reader";
import {
  FindingsSnapshot,
  FORMAT_VERSION as SOUS_FORMAT_VERSION,
} from "@wycliffeassociates/scripture-kitchen/sous-reader";
import {
  fromSettings,
  toSettings,
  type SousSettingsValues,
} from "@wycliffeassociates/scripture-kitchen/sous-settings";
import {
  Census as ProjectToc,
  FORMAT_VERSION as TOC_FORMAT_VERSION,
} from "@wycliffeassociates/scripture-kitchen/toc-reader";
import type { BookCensus as BookToc } from "@wycliffeassociates/scripture-kitchen/toc-reader";
import { Galley as GalleyHandle, initSync } from "@wycliffeassociates/scripture-kitchen/web";
import * as wasmModule from "@wycliffeassociates/scripture-kitchen/web";
import { Context, Data, Effect, Layer, Option, Result } from "effect";

import { Observability, type ObservabilityService } from "../observability";
import {
  engineDiff,
  engineMerge,
  engineMergeSplices,
  type DecisionMap,
  type MergeSplice,
  type DiffSkeleton,
  type EngineDoorMissing,
  type MergeSide,
  type DiffOptions,
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

export { FindingsSnapshot };
export type { Finding, Pattern } from "@wycliffeassociates/scripture-kitchen/sous-reader";
export {
  booksByPattern,
  describe as describeFinding,
  markBefore,
  type MarkBefore,
  type Message as FindingMessage,
  type MessageContext as FindingMessageContext,
  type MessageId as FindingMessageId,
  type Query as FindingQuery,
  type QueryPurpose as FindingQueryPurpose,
  type QueryPart as FindingQueryPart,
  type QueryClass as FindingQueryClass,
} from "@wycliffeassociates/scripture-kitchen/sous-messages";
export { default as FINDING_MESSAGES_EN } from "@wycliffeassociates/scripture-kitchen/sous-messages.en.json";
export {
  ordinalOf,
  patternIdentity,
  siteIdentityOf,
} from "@wycliffeassociates/scripture-kitchen/sous-identity";
export {
  SETTING_KEYS as SOUS_SETTING_KEYS,
  SOUS_SETTINGS,
  type SettingGroup as SousSettingGroup,
  type SettingKey as SousSettingKey,
  type SousSettingsValues,
} from "@wycliffeassociates/scripture-kitchen/sous-settings";
export {
  OUTER_CLASSES,
  PATTERN_DIGIT_GLYPH,
  POOLS,
} from "@wycliffeassociates/scripture-kitchen/sous-reader";
export type {
  CasingForm,
  Channel,
  Cluster,
  ConventionReason,
  OuterClass,
  PatternKey,
  Pool,
  Usual,
} from "@wycliffeassociates/scripture-kitchen/sous-reader";
export type { BookCensus as BookToc } from "@wycliffeassociates/scripture-kitchen/toc-reader";
export type { MaskMap };

export class EngineLoadError extends Data.TaggedError("EngineLoadError")<{
  readonly reason: string;
  readonly cause?: unknown;
}> {}

export class VersionMismatch extends Data.TaggedError("VersionMismatch")<{
  readonly wire: "onion" | "sous" | "find" | "toc" | "mask";
  readonly found: number;
  readonly expected: number;
}> {}

export class EngineInputError extends Data.TaggedError("EngineInputError")<{
  readonly reason: string;
}> {}

export interface EngineVersion {
  readonly engine: string;
  readonly tag: string;
  readonly onionFormat: number;
  readonly sousFormat: number;
  readonly findFormat: number;
  readonly tocFormat: number;
}

export interface FindQuery {
  readonly text: string;
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
  readonly limit?: number;
}

export type FindScope = "targets" | "references" | "all";

/** Half-open, in UTF-16 units. */
export interface EngineRange {
  readonly from: number;
  readonly to: number;
}

export interface EngineHit {
  readonly bookId?: string;
  readonly projected: EngineRange;
  readonly source: readonly EngineRange[];
  readonly preview: string;
}

const PARSE_ALL = { diagnostics: true, toc: true, utf16: true } as const;

const findOptions = (query: FindQuery, scope?: FindScope): Record<string, unknown> => ({
  ...(query.caseSensitive === undefined ? {} : { caseSensitive: query.caseSensitive }),
  ...(query.wholeWord === undefined ? {} : { wholeWord: query.wholeWord }),
  ...(query.limit === undefined ? {} : { limit: query.limit }),
  ...(scope === undefined ? {} : { scope }),
});

const decodeHits = (bytes: Uint8Array): readonly EngineHit[] => {
  const hits = Hits.open(bytes);
  const out: EngineHit[] = [];
  for (let hitIndex = 0; hitIndex < hits.hitCount; hitIndex += 1) {
    const hit = hits.hit(hitIndex);
    const projected = { from: hit.projectedFrom, to: hit.projectedTo };
    const bookId = hits.id(hit.bookIndex);
    const rows = hit.pieces();
    const source: EngineRange[] = [];
    for (let pieceIndex = 0; pieceIndex < rows.length; pieceIndex += 1) {
      const piece = rows.seek(pieceIndex);
      source.push({ from: piece.sourceFrom, to: piece.sourceTo });
    }
    out.push({ bookId, projected, source, preview: hits.preview(hitIndex) });
  }
  return out;
};

export interface LintReport {
  readonly diagnostics: readonly DiagnosticView[];
  readonly usfmVersion: string | null;
  readonly sourceHash: bigint;
  readonly docLen: number;
}

export interface ExtensionMarker {
  readonly name: string;
  readonly category: string;
}

export interface ExtensionReport {
  readonly name?: string;
  readonly reason: string;
}

export interface GalleyService {
  readonly version: () => EngineVersion;

  readonly setExtensions: (
    markers: readonly ExtensionMarker[],
    opts?: { readonly relaxZPrefix?: boolean },
  ) => readonly ExtensionReport[];

  readonly analyzeText: (text: string, why?: string) => Analysis;

  readonly analyzeBook: (
    id: string,
    text: string,
    why?: string,
    into?: ObservabilityService,
  ) => Analysis;

  readonly lint: (id: string, why?: string) => LintReport;

  readonly toc: (id: string) => BookToc | undefined;

  readonly tocAll: () => ProjectToc;

  readonly mask: (id: string) => MaskMap | undefined;

  readonly readerMask: (text: string, recipe?: "text" | "verseText") => MaskMap | undefined;

  readonly hash: (text: string) => bigint;

  readonly memoize: (id?: string) => (text: string) => Analysis;

  readonly update: (id: string, text: string) => string;

  readonly updateReference: (id: string, text: string, keepText?: boolean) => string;

  readonly remove: (id: string) => boolean;

  readonly publish: () => FindingsSnapshot;

  readonly find: (id: string, query: FindQuery) => readonly EngineHit[];

  readonly findAll: (query: FindQuery, scope?: FindScope) => readonly EngineHit[];

  readonly settings: () => SousSettingsValues;

  readonly setSettings: (values: SousSettingsValues) => void;

  readonly residentBytes: () => number;

  readonly diff: (
    baseline: string,
    current: string,
    opts?: Partial<DiffOptions>,
  ) => Result.Result<DiffSkeleton, EngineDoorMissing>;

  readonly merge: (
    baseline: string,
    current: string,
    decisions: DecisionMap,
    fallback: MergeSide,
  ) => Result.Result<string, EngineDoorMissing>;

  readonly mergeSplices: (
    baseline: string,
    current: string,
    decisions: DecisionMap,
    fallback: MergeSide,
  ) => Result.Result<readonly MergeSplice[], EngineDoorMissing>;

  readonly formatEdits: (
    text: string,
    opts?: FormatOptions,
  ) => Result.Result<FormatEdits, EngineDoorMissing>;

  readonly skeleton: (id: string, opts?: OverlayOptions) => Skeleton;

  readonly overlay: (targetId: string, sourceId: string, opts?: OverlayOptions) => OverlayEdits;

  readonly targetNodeFor: (
    targetId: string,
    sourceId: string,
    address: BlockAddress,
    opts?: OverlayOptions,
  ) => Equivalent;

  readonly sourceNodeFor: (
    targetId: string,
    sourceId: string,
    address: BlockAddress,
    opts?: OverlayOptions,
  ) => Equivalent;

  readonly changedSinceUpdate: (id: string, text: string) => boolean | undefined;

  readonly wordlessReferences: () => number;

  readonly dispose: () => void;
}

export class Galley extends Context.Service<Galley, GalleyService>()("Galley") {}

const engineVersion = (): EngineVersion => ({
  engine: "usfm_galley",
  tag: typeof __GALLEY_TAG__ === "string" ? __GALLEY_TAG__ : "unknown",
  onionFormat: ONION_FORMAT_VERSION,
  sousFormat: SOUS_FORMAT_VERSION,
  findFormat: FIND_FORMAT_VERSION,
  tocFormat: TOC_FORMAT_VERSION,
});

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

  let live: GalleyHandle | null = handle;

  const dispose = (): void => {
    const held = live;
    live = null;
    held?.free();
  };

  const parseAnalysis = (
    text: string,
    why: string,
    id?: string,
    into?: ObservabilityService,
  ): Analysis => {
    if (text.includes("\r")) {
      throw new EngineInputError({
        reason: "canonical text is LF; the engine refuses a carriage return",
      });
    }
    const done = (into ?? observe)?.span("galley.parse", undefined, {
      "galley.why": why,
      "galley.text_length": text.length,
      ...(id === undefined ? {} : { "book.id": id }),
    });
    const started = performance.now();
    const dish = deserialize(
      id === undefined
        ? handle.parseText(text, PARSE_ALL)
        : (handle.update(id, text), handle.parse(id, PARSE_ALL)),
    );
    const engineMs = Math.round((performance.now() - started) * 1000) / 1000;
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

  const analyzeText = (text: string, why = "unnamed"): Analysis => parseAnalysis(text, why);

  const analyzeBook = (
    id: string,
    text: string,
    why = "unnamed",
    into?: ObservabilityService,
  ): Analysis => parseAnalysis(text, why, id, into);

  const lint = (id: string, why = "unnamed"): LintReport => {
    const done = observe?.span("galley.lint", undefined, {
      "galley.why": why,
      "book.id": id,
    });
    const started = performance.now();
    const dish = deserialize(handle.lint(id));
    const diagnostics = [...dish.diagnostics];
    done?.({
      "galley.diagnostics": diagnostics.length,
      "galley.engine_ms": Math.round((performance.now() - started) * 1000) / 1000,
    });
    return {
      diagnostics,
      usfmVersion: declaredVersion(dish),
      sourceHash: dish.sourceHash,
      docLen: dish.sourceLength,
    };
  };

  const toc = (id: string): BookToc | undefined => {
    const one = ProjectToc.open(handle.toc(id, { utf16: true }));
    return one.bookCount === 0 ? undefined : one.book(0);
  };

  const mask = (id: string): MaskMap | undefined => {
    try {
      return MaskMap.open(handle.mask(id, { recipe: "verseText", utf16: true }));
    } catch {
      return undefined;
    }
  };

  const readerMask = (text: string, recipe: "text" | "verseText" = "text"): MaskMap | undefined => {
    try {
      return MaskMap.open(handle.maskOf(text, { recipe, utf16: true }));
    } catch {
      return undefined;
    }
  };

  const memoize = (id?: string): ((text: string) => Analysis) => {
    let last: Analysis | undefined;
    return (text: string): Analysis => {
      if (last !== undefined && last.text === text) return last;
      last = id === undefined ? analyzeText(text, "editor") : analyzeBook(id, text, "editor");
      return last;
    };
  };

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

  const setExtensions = (
    markers: readonly ExtensionMarker[],
    opts?: { readonly relaxZPrefix?: boolean },
  ): readonly ExtensionReport[] => {
    const list = JSON.stringify(
      markers.map((marker) => ({ name: marker.name, category: marker.category })),
    );
    const reports = wasmModule.setExtensions(list, { relaxZPrefix: opts?.relaxZPrefix === true });
    // SAFETY: the engine answers a JSON array of `{ name, reason }` reports (`onion/src/extensions.rs`); a list report carries no `line`.
    const parsed = JSON.parse(reports) as ExtensionReport[];
    observe?.note("galley.extensions", "ready", undefined, {
      "galley.extensions": markers.map((marker) => marker.name).join(",") || "none",
      "galley.extensions_refused": parsed.length,
    });
    return parsed;
  };

  return {
    version: engineVersion,
    setExtensions,
    analyzeText,
    analyzeBook,
    memoize,
    lint,
    toc,
    mask,
    readerMask,
    hash: (text) => wasmModule.xxh3Text(text),
    tocAll: () => ProjectToc.open(handle.tocAll()),
    find: (id, query) => decodeHits(handle.find(id, query.text, findOptions(query))),
    findAll: (query, scope) =>
      decodeHits(handle.findAll(query.text, findOptions(query, scope ?? "targets"))),
    update: (id, text) => handle.update(id, text),
    updateReference: (id, text, keepText) =>
      handle.updateReference(id, text, { keepText: keepText === true }),
    remove: (id) => handle.remove(id),
    publish: () => FindingsSnapshot.open(handle.publish()),
    diff: (baseline, current, opts) => engineDiff(wasmModule, baseline, current, opts),
    merge: (baseline, current, decisions, fallback) =>
      engineMerge(wasmModule, baseline, current, decisions, fallback),
    mergeSplices: (baseline, current, decisions, fallback) =>
      engineMergeSplices(wasmModule, baseline, current, decisions, fallback),
    formatEdits: (text, opts) => engineFormatEdits(wasmModule, text, opts),
    skeleton: (id, opts) => decodeBlockSkeleton(handle.skeleton(id, overlayOptions(opts))),
    overlay: overlayEdits,
    targetNodeFor: (targetId, sourceId, address, opts) =>
      decodeEquivalent(handle.targetNodeFor(targetId, sourceId, address, overlayOptions(opts))),
    sourceNodeFor: (targetId, sourceId, address, opts) =>
      decodeEquivalent(handle.sourceNodeFor(targetId, sourceId, address, overlayOptions(opts))),
    changedSinceUpdate: (id, text) => {
      const changed = handle.changedSinceUpdate(id, text);
      return changed === undefined ? undefined : changed.length > 0;
    },
    wordlessReferences: () => handle.lastWordlessReferences(),
    settings: () => fromSettings(handle),
    setSettings: (values) => toSettings(handle, values),
    residentBytes: () => handle.residentBytes(),
    dispose,
  };
};

export const GalleyLive = (
  bytes: Uint8Array,
): Layer.Layer<Galley, EngineLoadError | VersionMismatch> =>
  Layer.effect(
    Galley,
    Effect.gen(function* () {
      yield* instantiate(bytes);
      const observability = yield* Effect.serviceOption(Observability);
      const handle = yield* Effect.try({
        try: () => new GalleyHandle(),
        catch: (cause) =>
          new EngineLoadError({ reason: "the engine handle would not open", cause }),
      });
      const service = makeService(handle, observability);
      yield* Effect.addFinalizer(() => Effect.sync(() => service.dispose()));
      return service;
    }),
  );
