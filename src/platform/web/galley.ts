import wasmUrl from "@wycliffeassociates/scripture-kitchen/web/wasm?url";
import { Effect, Layer } from "effect";

import { EngineLoadError, Galley, GalleyLive, type VersionMismatch } from "#core/galley/galley";

const WASM_URL: string = wasmUrl;

export const WebGalleyLive: Layer.Layer<Galley, EngineLoadError | VersionMismatch> = Layer.unwrap(
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(WASM_URL);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return GalleyLive(new Uint8Array(await response.arrayBuffer()));
    },
    catch: (cause) => new EngineLoadError({ reason: `cannot fetch ${WASM_URL}`, cause }),
  }),
);
