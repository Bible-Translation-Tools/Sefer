import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { initSync } from "@wycliffeassociates/scripture-kitchen/bento";

const WASM_PATH = fileURLToPath(
  import.meta.resolve("@wycliffeassociates/scripture-kitchen/bento/web/wasm"),
);

/** Starts bento under Node, as `WebBentoLive` does at boot; the unit tests' setup runs it. */
export const startBento = (): void => {
  initSync({ module: readFileSync(WASM_PATH) });
};
