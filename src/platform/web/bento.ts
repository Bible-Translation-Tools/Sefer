import { initSync } from "@wycliffeassociates/scripture-kitchen/bento";
import wasmUrl from "@wycliffeassociates/scripture-kitchen/bento/web/wasm?url";
import { Effect, Layer } from "effect";

import { EngineLoadError } from "#core/galley/galley";

const WASM_URL: string = wasmUrl;

/**
 * Starts bento, the kitchen's manifest reader and writer, beside galley: its
 * functions are module-level, so every manifest read after boot finds it
 * running. A module that cannot be fetched fails the boot like galley's.
 */
export const WebBentoLive: Layer.Layer<never, EngineLoadError> = Layer.effectDiscard(
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(WASM_URL);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      initSync({ module: new Uint8Array(await response.arrayBuffer()) });
    },
    catch: (cause) => new EngineLoadError({ reason: `cannot start bento from ${WASM_URL}`, cause }),
  }),
);
