/**
 * End-to-end: drive the BUILT application, the way a person gets it.
 *
 * Separate from the Vitest browser project, which mounts components in a real
 * Chromium and is the right tool for "does this component work". This one
 * exists to answer a different question — does the thing we are about to
 * deploy actually come up — and it can only be answered against `dist`, after
 * a real `pnpm build`, served the way a static host serves it.
 *
 * `vite preview` is that host: it serves `dist/client` with the
 * single-page-application fallback, which is the same shape as the Cloudflare
 * static-assets Worker in `wrangler.jsonc`. A deep link 404ing here would
 * 404 in production too.
 *
 * ## What belongs in here, and what does not
 *
 * Almost nothing. This is a SMOKE suite: it proves the build boots, routes
 * resolve, and nothing explodes on the way. It deliberately asserts as little
 * as possible about behaviour, because behaviour is still moving and a suite
 * that breaks every time a screen is redesigned is a suite people delete.
 *
 * Component behaviour goes in the Vitest browser project. Exploration goes
 * through `pnpm verify:chrome` and is not a test at all — see
 * `documentation/agents/verification.md`.
 */

import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const PORT = 4321;

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.e2e\.ts/,
  // A smoke suite that needs retries is telling you something; listen to it
  // rather than papering over it.
  retries: 0,
  fullyParallel: true,
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // `pnpm build` then serve it. Not `vite dev`: a dev server resolves
    // modules that a production bundle might have dropped, which is exactly
    // the class of failure this suite is here to catch.
    command: `pnpm build && pnpm exec vite preview --port ${String(PORT)} --strictPort`,
    // The repository root, not this file's directory (Playwright's default):
    // `pnpm build` has to find the root package.json.
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    url: `http://localhost:${String(PORT)}/`,
    reuseExistingServer: process.env["CI"] === undefined,
    timeout: 180_000,
  },
});
