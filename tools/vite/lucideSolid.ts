/**
 * A Vite plugin that makes `lucide-solid` run on Solid 2.
 *
 * lucide-solid 1.46 is a Solid 1 package: its peer range is `^1.4.7`, and its
 * `solid` export condition (the JSX source the Solid plugin compiles) reaches
 * for `splitProps` from `solid-js` and `Dynamic` from `solid-js/web`. Solid 2
 * renamed the DOM runtime to `@solidjs/web` and replaced `splitProps` with
 * `omit`, so the icons would resolve to `undefined` and throw on first render.
 *
 * The whole incompatibility is five symbols in ONE file (`dist/source/Icon.jsx`)
 * — every icon module imports nothing but that file — so rather than fork a
 * thousand icons or hand-roll our own set, this plugin redirects lucide-solid's
 * own `solid-js` / `solid-js/web` imports to `lucideSolidShim.ts`, which
 * re-exports Solid 2 and fills the two gaps. Nothing else in the build sees the
 * shim: the rewrite is keyed on the IMPORTER, not the specifier.
 *
 * When lucide-solid ships a Solid 2 build, delete this file, the shim, and the
 * plugin's line in `vite.config.ts`. Nothing else knows it exists.
 */

import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

const SHIM = fileURLToPath(new URL("./lucideSolidShim.ts", import.meta.url));

/** Solid 1's two module specifiers, as lucide-solid writes them. */
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
