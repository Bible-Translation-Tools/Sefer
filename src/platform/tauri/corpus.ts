/**
 * The desktop answer to the `CorpusEngine` port: the analysis engine, native.
 *
 * The decision (2026-09-08): on desktop the whole-corpus half of Galley leaves
 * the JavaScript thread. `publish()` maps every changed chapter and judges
 * every book in the project, and running that in the webview means running it
 * on the thread that paints the editor. `src-tauri/src/corpus.rs` holds the
 * same engine natively, on its own thread, built with the crate's `parallel`
 * feature so the chapter map goes wide on rayon — which is what the v1 app did
 * and the only reason a full New Testament felt instant.
 *
 * The per-book `analyze` does NOT come through here and never will: it is
 * synchronous, on the keystroke path, and stays in the wasm handle beside the
 * editor (`src/core/galley/galley.ts`). Two doors, one publication.
 *
 * Everything here is translation, not policy. The one thing worth reading twice
 * is `publish`: the Rust command answers with `tauri::ipc::Response`, so the
 * publication crosses as raw bytes and arrives as an `ArrayBuffer`. Serialising
 * a hundred kilobytes of fixed-width rows into a JSON array of numbers would
 * cost more than the publication that produced them.
 */
import { invoke } from "@tauri-apps/api/core";
import { Effect, Layer } from "effect";

import {
  CorpusEngine,
  CorpusError,
  FindingsSnapshot,
  type CorpusEngineService,
} from "../../core/galley";

/**
 * The Rust side prefixes every error with a stable reason name (see
 * `src-tauri/src/errors.rs`), so this function never reads engine prose. An
 * unrecognised prefix is `Io`: a new failure should degrade to "the call did
 * not complete" rather than to a reason the caller cannot act on.
 */
const REASONS: Readonly<Record<string, CorpusError["reason"]>> = {
  Engine: "Engine",
  Io: "Io",
};

const failureOf = (cause: unknown): CorpusError => {
  const message = cause instanceof Error ? cause.message : String(cause);
  const separator = message.indexOf(": ");
  const prefix = separator === -1 ? "" : message.slice(0, separator);
  return new CorpusError({
    reason: REASONS[prefix] ?? "Io",
    description: separator === -1 ? message : message.slice(separator + 2),
  });
};

const call = <A>(
  command: string,
  args: Record<string, unknown> = {},
): Effect.Effect<A, CorpusError> =>
  Effect.tryPromise({ try: () => invoke<A>(command, args), catch: failureOf });

/**
 * A raw `ipc::Response` arrives as an `ArrayBuffer`, but the shape is the
 * host's promise rather than something the type system checked, so it is
 * narrowed here. `FindingsSnapshot.open` accepts either an `ArrayBuffer` or a
 * view; anything else means the command changed shape and is a wiring bug, not
 * a corpus without findings.
 */
const openSnapshot = (payload: unknown): Effect.Effect<FindingsSnapshot, CorpusError> => {
  if (!(payload instanceof ArrayBuffer) && !ArrayBuffer.isView(payload))
    return Effect.fail(
      new CorpusError({
        reason: "Io",
        description: `corpus_publish answered with ${typeof payload}, not bytes`,
      }),
    );
  return Effect.try({
    try: () => FindingsSnapshot.open(payload),
    // A buffer that will not open is a wire-format disagreement between this
    // build's reader and the engine the desktop host linked. Loud, not silent:
    // a mismatched buffer decodes into plausible nonsense.
    catch: (cause) =>
      new CorpusError({
        reason: "Io",
        description: cause instanceof Error ? cause.message : String(cause),
      }),
  });
};

const nativeCorpus: CorpusEngineService = {
  kind: "native",
  update: (id, text) => call<string>("corpus_update", { id, text }),
  updateReference: (id, text) => call<string>("corpus_update_reference", { id, text }),
  remove: (id) => call<boolean>("corpus_remove", { id }),
  publish: () => Effect.flatMap(call<unknown>("corpus_publish"), openSnapshot),
  residentBytes: () => call<number>("corpus_resident_bytes"),
};

/**
 * The Layer. No requirements: the engine lives in the host process, so there is
 * nothing for core to provide it. Its state is managed on the Rust side for the
 * life of the process, which is why nothing here is scoped and nothing is freed.
 */
export const NativeCorpusLive: Layer.Layer<CorpusEngine> = Layer.succeed(
  CorpusEngine,
  nativeCorpus,
);
