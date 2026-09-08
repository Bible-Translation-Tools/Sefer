/**
 * The Node host's engine loader: read the pinned wasm off disk and hand the
 * bytes to `GalleyLive`.
 *
 * Tests and tooling only. The shipping hosts are web and Tauri, which both go
 * through `src/platform/web/galley.ts`; this exists so a Node test can exercise
 * the real engine without a browser or a bundler.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Effect, Layer } from "effect";

import {
  EngineLoadError,
  Galley,
  GalleyLive,
  type VersionMismatch,
} from "../../core/galley/galley";

/**
 * Resolved from this module's own URL rather than from `process.cwd()`, so it
 * holds wherever the runner is started from.
 */
export const WASM_PATH = fileURLToPath(
  new URL("../../../vendor/galley/pkg-web/usfm_galley_bg.wasm", import.meta.url),
);

/**
 * The read happens when the Layer is built, not when this module is imported:
 * three quarters of a megabyte is not something an import should cost a runner
 * that never asks for the engine.
 */
export const NodeGalleyLive: Layer.Layer<Galley, EngineLoadError | VersionMismatch> = Layer.unwrap(
  Effect.try({
    try: () => GalleyLive(readFileSync(WASM_PATH)),
    catch: (cause) => new EngineLoadError({ reason: `cannot read ${WASM_PATH}`, cause }),
  }),
);
