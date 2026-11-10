import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Layer } from "effect";

import { WriterEngine, writerEngine } from "#core/migrate/writerEngine";

const WASM_PATH = fileURLToPath(
  import.meta.resolve("@wycliffeassociates/scripture-kitchen/bttwriter/web/wasm"),
);

/** bttwriter under Node, for tests: started from the wasm file's bytes. */
export const NodeWriterEngineLive: Layer.Layer<WriterEngine> = Layer.succeed(
  WriterEngine,
  writerEngine(async () => {
    const bttwriter = await import("@wycliffeassociates/scripture-kitchen/bttwriter");
    bttwriter.initSync({ module: readFileSync(WASM_PATH) });
    return bttwriter;
  }),
);
