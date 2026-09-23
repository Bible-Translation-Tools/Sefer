/**
 * The Web host's engine loader: the wasm as a bundled asset URL, fetched once
 * and handed to `GalleyLive`.
 *
 * `?url` keeps the artifact a file the browser can cache and the dev server can
 * serve, instead of a base64 blob inside the JS bundle — three quarters of a
 * megabyte does not belong in the main chunk. The Tauri host shares this path:
 * its webview fetches the same asset off the bundled frontend.
 */

import wasmUrl from "@wycliffeassociates/scripture-kitchen/web/wasm?url";
import { Effect, Layer } from "effect";

import {
  EngineLoadError,
  Galley,
  GalleyLive,
  type VersionMismatch,
} from "../../core/galley/galley";

/** The bundled asset's URL. Exported for evidence in a boot failure report. */
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
