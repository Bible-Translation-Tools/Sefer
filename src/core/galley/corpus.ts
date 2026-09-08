/**
 * CorpusEngine — the seam that lets the whole-corpus half of Galley run
 * somewhere other than the main JavaScript thread.
 *
 * Galley is one handle with two halves (see `galley.ts`): `analyze(text)` for
 * one book on the keystroke path, and `update`/`publish` for the whole corpus.
 * The first must stay synchronous and in-process — a fiber and an IPC hop per
 * keystroke is a budget Sefer does not have. The second must not: a corpus
 * publication maps every changed chapter and judges every book, and doing that
 * on the thread that also paints the editor is the one cold path a translator
 * can feel.
 *
 * So the corpus half gets its own port, and it is ASYNCHRONOUS on purpose even
 * though today's Web implementation is a synchronous call away:
 *
 *   - on desktop, `NativeCorpusLive` (`src/platform/tauri/corpus.ts`) crosses
 *     IPC into `src-tauri/src/corpus.rs`, where the same engine runs natively
 *     with rayon mapping chapters on Tauri's thread pool;
 *   - on Web, `WasmCorpusLive` delegates to the wasm handle in this process.
 *     A Worker is the next step there, and it needs exactly this signature.
 *
 * The two doors publish the SAME BYTES. That is not an aspiration: the engine's
 * own conformance tests hold the native `Expediter` and the wasm `Galley` handle
 * against one set of golden buffers (`galley/src/wasm.md`, "The claim"), and
 * `galley/tests/equivalence.rs` holds the parallel chapter map against the
 * serial one. `FindingsSnapshot.open` reads either.
 *
 * `Galley` still owns the knobs and `analyze`. This port is deliberately narrow:
 * the five calls ProjectAnalysis makes off the keystroke path, and nothing else.
 */

import { Context, Data, Effect, Layer } from "effect";

import { Galley, type EngineHit, type FindQuery, type FindingsSnapshot } from "./galley";

/**
 * Which door a publication went through. Carried in telemetry only — the
 * findings are identical either way — so that a reading of the ring says
 * whether the work left the JS thread.
 */
export type CorpusEngineKind = "wasm" | "native";

/**
 * A corpus call did not complete.
 *
 * `Engine` — the engine refused the input or the publication (a malformed
 * `\id`, a Pantry budget refusal). `Io` — the call never reached the engine or
 * its answer did not come back intact (IPC, a truncated buffer). `Unavailable`
 * — there is no engine on this host to ask.
 *
 * Every door carries this failure, including `remove` and `residentBytes`,
 * because on desktop each one is an IPC round trip and an adapter that
 * swallowed a transport failure would report "the id was not known" for
 * "the host did not answer".
 */
export class CorpusError extends Data.TaggedError("CorpusError")<{
  readonly reason: "Engine" | "Io" | "Unavailable";
  readonly description: string;
}> {}

export interface CorpusEngineService {
  /** Which implementation this is. For telemetry and the about box. */
  readonly kind: CorpusEngineKind;

  /**
   * Register or replace one whole book as a proofreading target, by the
   * caller's own id. Succeeds with the `\id` line's canonical book code, which
   * is what orders the publication. Idempotent: the same text costs a checksum.
   *
   * `text` must be canonical LF, the contract every engine door documents.
   */
  readonly update: (id: string, text: string) => Effect.Effect<string, CorpusError>;

  /**
   * The same, as a declared source: verse lengths only, no text. A reference
   * publishes no findings of its own; it is the denominator a target's verses
   * are compared against.
   */
  readonly updateReference: (id: string, text: string) => Effect.Effect<string, CorpusError>;

  /** Drop a book and its cached rows. `false` when the id was never known. */
  readonly remove: (id: string) => Effect.Effect<boolean, CorpusError>;

  /**
   * One complete corpus publication.
   *
   * A snapshot replaces the previous one whole — row positions are valid only
   * inside the buffer they came from — so never hold findings from an older
   * snapshot beside a newer one.
   */
  readonly publish: () => Effect.Effect<FindingsSnapshot, CorpusError>;

  /**
   * Literal find over every registered book's verse-text projection, in
   * canonical book order.
   *
   * On the corpus port and not on `Galley` because the corpus is what HOLDS
   * the retained texts and masks: on desktop the books were registered across
   * IPC and the projections live in the native Pantry, so the search has to
   * run where they are. It is also the same reason this is asynchronous —
   * a project-wide scan is not keystroke work.
   *
   * A book the corpus was never told about contributes no hits. Registration
   * is `ProjectAnalysis.attach`'s job, which registers every book of a project
   * as it opens, so a find on an open project sees all of them.
   */
  readonly find: (query: FindQuery) => Effect.Effect<readonly EngineHit[], CorpusError>;

  /** Resident bytes on whichever side of the seam the corpus lives. */
  readonly residentBytes: () => Effect.Effect<number, CorpusError>;
}

export class CorpusEngine extends Context.Service<CorpusEngine, CorpusEngineService>()(
  "CorpusEngine",
) {}

/** The engine throws a `JsError`; nothing else here can fail. */
const engineFailure = (cause: unknown): CorpusError =>
  new CorpusError({
    reason: "Engine",
    description: cause instanceof Error ? cause.message : String(cause),
  });

/**
 * The in-process door: the wasm handle this build already holds.
 *
 * Each call is `Effect.sync`/`Effect.try` around a synchronous wasm call, so
 * the asynchrony is nominal today and the cost is one fiber step per scheduler
 * pass — not per keystroke. When the handle moves to a Worker, only this Layer
 * changes.
 */
export const WasmCorpusLive: Layer.Layer<CorpusEngine, never, Galley> = Layer.effect(
  CorpusEngine,
  Effect.gen(function* () {
    const galley = yield* Galley;
    return {
      kind: "wasm",
      update: (id, text) =>
        Effect.try({ try: () => galley.update(id, text), catch: engineFailure }),
      updateReference: (id, text) =>
        Effect.try({ try: () => galley.updateReference(id, text), catch: engineFailure }),
      remove: (id) => Effect.try({ try: () => galley.remove(id), catch: engineFailure }),
      publish: () => Effect.try({ try: () => galley.publish(), catch: engineFailure }),
      find: (query) => Effect.try({ try: () => galley.findAll(query), catch: engineFailure }),
      residentBytes: () => Effect.sync(() => galley.residentBytes()),
    };
  }),
);
