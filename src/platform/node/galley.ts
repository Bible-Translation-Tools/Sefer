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
 * Resolved through the PACKAGE rather than by walking up from this file.
 *
 * The engine is a tagged git dependency, so where its bytes sit on disk is
 * pnpm's business and not this module's — `import.meta.resolve` asks the
 * resolver the same question the bundler asks on the Web path, which is what
 * keeps the two hosts loading the same artifact without either one spelling a
 * path into `node_modules`.
 */
export const WASM_PATH = fileURLToPath(
  import.meta.resolve("@wycliffeassociates/scripture-kitchen/web/wasm"),
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
