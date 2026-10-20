import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Effect, Layer } from "effect";

import { EngineLoadError, Galley, GalleyLive, type VersionMismatch } from "#core/galley/galley";

const WASM_PATH = fileURLToPath(
  import.meta.resolve("@wycliffeassociates/scripture-kitchen/web/wasm"),
);

export const NodeGalleyLive: Layer.Layer<Galley, EngineLoadError | VersionMismatch> = Layer.unwrap(
  Effect.try({
    try: () => GalleyLive(readFileSync(WASM_PATH)),
    catch: (cause) => new EngineLoadError({ reason: `cannot read ${WASM_PATH}`, cause }),
  }),
);
