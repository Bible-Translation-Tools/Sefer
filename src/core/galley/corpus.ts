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
 * though the one implementation is a synchronous call away: `WasmCorpusLive`
 * delegates to the wasm handle in this process, on both hosts. A Worker is the
 * next step, and it needs exactly this signature.
 *
 * There was a second implementation — `NativeCorpusLive`, crossing IPC into a
 * natively-linked engine with rayon mapping chapters — and it is gone. The id
 * doors are why: `parse(id)` and `lint(id)` answer off the text a handle
 * retains, so a corpus in another process is a corpus the parse path cannot
 * name, and keeping both meant sending every book's text across the wall
 * twice. One resident copy of the project beats a parallel map we paid for in
 * marshalling.
 *
 * `Galley` still owns the settings and `analyze`. This port is deliberately narrow:
 * the five calls ProjectAnalysis makes off the keystroke path, and nothing else.
 */

import { Context, Data, Effect, Layer } from "effect";

import {
  Galley,
  type EngineHit,
  type FindQuery,
  type FindScope,
  type FindingsSnapshot,
} from "./galley";

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
   * The same, as a declared source. A reference publishes no findings of its
   * own; it is the denominator a target's verses are compared against.
   *
   * `keepText` — omitted is `false`, which is verse lengths and nothing else —
   * makes it retain the text, the mask and the projection a target retains, so
   * that `find`'s `references` scope and the overlay doors can read it. It is
   * a real cost per reference, which is why it is asked for rather than
   * assumed: a project binds a source to be compared against, and only some of
   * those are also searched or overlaid.
   */
  readonly updateReference: (
    id: string,
    text: string,
    keepText?: boolean,
  ) => Effect.Effect<string, CorpusError>;

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
   * as it opens, so a find on an open project sees all of them — and
   * `attachReferences`' for a bound source or reference, which is what the
   * `references` scope reads.
   *
   * `scope` omitted is `targets`, so every existing caller searches exactly
   * what it searched before.
   */
  readonly find: (
    query: FindQuery,
    scope?: FindScope,
  ) => Effect.Effect<readonly EngineHit[], CorpusError>;

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
      updateReference: (id, text, keepText) =>
        Effect.try({ try: () => galley.updateReference(id, text, keepText), catch: engineFailure }),
      remove: (id) => Effect.try({ try: () => galley.remove(id), catch: engineFailure }),
      publish: () => Effect.try({ try: () => galley.publish(), catch: engineFailure }),
      find: (query, scope) =>
        Effect.try({ try: () => galley.findAll(query, scope), catch: engineFailure }),
      residentBytes: () => Effect.sync(() => galley.residentBytes()),
    };
  }),
);
