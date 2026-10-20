import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

const SHIM = fileURLToPath(new URL("./lucideSolidShim.ts", import.meta.url));

const REDIRECTED = new Set(["solid-js", "solid-js/web"]);

export const lucideSolidCompat = (): Plugin => ({
  name: "sefer:lucide-solid-compat",
  enforce: "pre",
  resolveId(source, importer) {
    if (importer === undefined) return null;
    if (!REDIRECTED.has(source)) return null;
    return importer.includes("lucide-solid") ? SHIM : null;
  },
});
