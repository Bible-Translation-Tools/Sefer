import { execFileSync } from "node:child_process";
import process from "node:process";

import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { playwright } from "@vitest/browser-playwright";
import { loadEnv } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

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

export default defineConfig(({ mode }) => {
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
    },
    optimizeDeps: {
      include: ["effect/unstable/http/FetchHttpClient", "effect/unstable/observability/Otlp"],
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
