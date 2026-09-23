import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { playwright } from "@vitest/browser-playwright";
import { loadEnv } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

import { jsxLocation } from "./tools/vite/jsxLocation.ts";
import { lucideSolidCompat } from "./tools/vite/lucideSolid.ts";

/**
 * Where the browser posts OTLP, and the reason it is a path and not the
 * collector's own URL.
 *
 * A collector is a different origin — `http://127.0.0.1:27686` against a dev
 * server on `http://localhost:3000` differs in both host and port — and an
 * OTLP body is `application/json`, so the browser sends a CORS preflight
 * first. motel answers `OPTIONS /v1/logs` with a bare 404 and no
 * `Access-Control-Allow-Origin`, so the preflight fails and the POST is never
 * made: the export is silently dropped in the browser, with nothing on the
 * wire for the collector to be missing.
 *
 * Proxying it through the dev server makes every export SAME-ORIGIN, so there
 * is no preflight to fail and no collector configuration to get right. The
 * same literal is in `src/app/composition.ts`, which is the only thing that
 * posts here.
 */
const OTLP_PROXY_PATH = "/__otlp";

const shortGitSha = (): string | null => {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

const buildIdentity = (mode: string): string => `${shortGitSha() ?? "dev"}+${mode}`;

/**
 * Which engine tag this build resolved, read from the ONE place it is pinned.
 *
 * The engine is a tagged git dependency, so the dependency spec IS the pin and
 * this reads it rather than restating it — a second record of the tag is
 * exactly how two records drift. A
 * spec without a `#tag` (a branch, a local link) reports itself as written,
 * which is the honest answer for a build that is not on a release.
 */
const galleyTag = (): string => {
  try {
    const manifest: unknown = JSON.parse(readFileSync("package.json", "utf8"));
    // SAFETY: one optional field read off this repository's own package.json,
    // which `JSON.parse` types as `unknown`. Both the field and the key are
    // checked for undefined on the next line; a package.json without them is
    // the "unpinned" case, not a crash.
    const spec = (manifest as { dependencies?: Record<string, string> }).dependencies?.[
      "@wycliffeassociates/scripture-kitchen"
    ];
    if (spec === undefined) return "unpinned";
    return spec.includes("#") ? spec.slice(spec.lastIndexOf("#") + 1) : spec;
  } catch {
    return "unknown";
  }
};

export default defineConfig(({ mode }) => {
  // The one answer to "does this build carry the design surface", shared by
  // the `__SEFER_DESIGN__` define below and the JSX-location transform. The
  // mode is `dev` because that is the channel it deploys to; the define keeps
  // its own name because it describes the payload, not the channel.
  const designBuild = mode === "development" || mode === "dev";

  // `loadEnv` so the collector may be named either in a `.env` file or, as the
  // documented command does, exported in the shell that runs `pnpm dev`.
  const collector = (loadEnv(mode, process.cwd(), "VITE_").VITE_SEFER_OTLP_URL ?? "")
    .trim()
    .replace(/\/+$/u, "");

  return {
    // Turnkey client mode: no index.html and no mount file — the plugin
    // generates the entries around src/App.tsx, wrapped in src/Document.tsx
    // (or a built-in shell). `vite build` prerenders the shell into
    // dist/client/index.html and emits a purely static dist/client.
    plugins: [
      // Stamps every intrinsic JSX element with its file:line:col, so a click
      // in the design overlay can name a place in the source. MUST come before
      // solid(), which erases JSX — the plugin's own `enforce: "pre"` says so
      // too, but the order here is the one somebody reads. Dev and design
      // builds only; production never sees it.
      jsxLocation({ enabled: designBuild, root: process.cwd() }),
      // Tailwind v4 compiles from the CSS itself: `src/app/ui/tokens.css` holds
      // the `@import "tailwindcss"`, the `@source` glob and the `@theme` bridge,
      // so there is no config file to keep in step with it.
      tailwindcss(),
      // lucide-solid is a Solid 1 package; this redirects its own solid imports
      // to a shim. See tools/vite/lucideSolid.ts.
      lucideSolidCompat(),
      // Scans src/routes and generates src/routeTree.gen.ts — the typed route
      // tree — on dev and build. Must be registered before solid().
      tanstackRouter({
        target: "solid",
        autoCodeSplitting: true,
      }),
      // Client mode only for now: TanStack's SSR needs per-request router
      // wiring (router.load() + dehydration) that the generated streaming
      // entry doesn't perform — see the README's SSR note.
      solid({ start: true, diagnostics: true }),
    ],
    define: {
      __SEFER_BUILD__: JSON.stringify(buildIdentity(mode)),
      __GALLEY_TAG__: JSON.stringify(galleyTag()),
      __SEFER_DESIGN__: JSON.stringify(designBuild),
    },
    server: {
      port: 3000,
      strictPort: true,
      ...(collector === ""
        ? {}
        : {
            proxy: {
              [OTLP_PROXY_PATH]: {
                target: collector,
                changeOrigin: true,
                rewrite: (path: string) => path.slice(OTLP_PROXY_PATH.length),
              },
            },
          }),
    },
    resolve: {
      // @codemirror/lint pins its own @codemirror/state; a second copy means a
      // second Facet identity and "Unrecognized extension value in extension set".
      dedupe: ["@codemirror/state", "@codemirror/view"],
      // tsconfig.json's `paths` (`#core/*` and the other layer aliases) are the
      // one record of the aliases; Vite reads them rather than a copy here.
      tsconfigPaths: true,
    },
    optimizeDeps: {
      include: [
        "effect/unstable/http/FetchHttpClient",
        "effect/unstable/observability/Otlp",
        // Pre-bundled at startup rather than discovered when the first
        // multibuffer route loads: a mid-session re-optimization reloads the
        // page, and a reload drops the open project.
        "@tanstack/virtual-core",
      ],
    },
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: "core",
            environment: "node",
            include: ["src/**/*.test.ts", "tools/**/*.test.ts"],
            exclude: [...configDefaults.exclude, "**/*.browser.test.*"],
          },
        },
        {
          extends: true,
          test: {
            name: "browser",
            include: ["src/**/*.browser.test.{ts,tsx}"],
            browser: {
              enabled: true,
              provider: playwright(),
              // Stated rather than left to the default, which is headless in
              // CI and HEADED on a laptop — so the suite raised a Chromium
              // window over whatever the person was doing, and on macOS took
              // the keyboard with it. Nothing here needs to be watched: a
              // failure is read from the terminal. `--browser.headless=false`
              // is still there for the run where you do want to watch.
              headless: true,
              instances: [{ browser: "chromium" }],
            },
          },
        },
      ],
    },
    build: {
      target: "esnext",
      // Keep images as asset files instead of inlining them into the JS bundle.
      assetsInlineLimit: 0,
    },
  };
});
