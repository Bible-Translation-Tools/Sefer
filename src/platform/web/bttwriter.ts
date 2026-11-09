import wasmUrl from "@wycliffeassociates/scripture-kitchen/bttwriter/web/wasm?url";
import { Layer } from "effect";

import { WriterEngine, writerEngine } from "#core/migrate/writerEngine";

const WASM_URL: string = wasmUrl;

/**
 * bttwriter for the Web and desktop hosts: the module is a dynamic import, so
 * it is its own chunk and is fetched, with its wasm, the first time the
 * migration reads a Writer history.
 */
export const WebWriterEngineLive: Layer.Layer<WriterEngine> = Layer.succeed(
  WriterEngine,
  writerEngine(async () => {
    const bttwriter = await import("@wycliffeassociates/scripture-kitchen/bttwriter");
    await bttwriter.init({ module_or_path: WASM_URL });
    return bttwriter;
  }),
);
