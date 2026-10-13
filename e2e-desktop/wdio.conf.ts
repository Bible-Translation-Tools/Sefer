/**
 * Desktop end-to-end: drive the REAL Tauri app with WebdriverIO.
 *
 * Run through `pnpm test:desktop` (`tools/verify/desktopTest.ts`), never
 * `wdio` directly: that script builds the debug binary with the `webdriver`
 * feature, starts the Vite dev server the webview loads, and hands this config
 * `SEFER_DEV_URL`, `SEFER_DESKTOP_HOME` and `SEFER_VERIFY_RUN_DIR`.
 *
 * The driver is WebdriverIO's embedded one: `tauri-plugin-wdio-webdriver`
 * inside the app serves W3C WebDriver over the platform's own webview API
 * (WKWebView on macOS, where Tauri's `tauri-driver` does not work), and
 * `@wdio/tauri-service` spawns the binary with `TAURI_WEBDRIVER_PORT` set and
 * connects to it. Separate from `e2e/` (Playwright, the built Web bundle) and
 * from the Vitest projects.
 *
 * ## What belongs in here
 *
 * Smoke checks of what only the desktop host can get wrong: the native
 * filesystem, git2, the Tauri IPC and its permissions, the system webview.
 * Like `e2e/`, it says nothing about how a screen looks — behaviour is still
 * moving, and a suite that breaks on every redesign is one people delete.
 * `tauri-plugin-wdio` (the service's `browser.tauri.execute` and command
 * mocking) is deliberately not installed: `browser.execute` reaches the page,
 * `globalThis.__sefer` is the evidence, and nothing here mocks the host.
 */

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const runDir = process.env["SEFER_VERIFY_RUN_DIR"] ?? path.join(root, ".verify", "test-desktop");
const home = process.env["SEFER_DESKTOP_HOME"];
if (process.env["SEFER_DEV_URL"] === undefined || home === undefined)
  throw new Error("run the desktop specs through `pnpm test:desktop`, which starts the dev server");

const application = path.join(root, "src-tauri", "target", "debug", "sefer");

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: [path.join(root, "e2e-desktop", "**", "*.desktop.ts")],
  // One app, one window: specs run one after another in it.
  maxInstances: 1,
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": { application },
      "wdio:tauriServiceOptions": {
        appBinaryPath: application,
        driverProvider: "embedded",
        // The app's data goes under the run's scratch folder, never the
        // person's own Library.
        env: { HOME: home },
      },
    },
  ],
  services: [["@wdio/tauri-service", {}]],
  framework: "mocha",
  reporters: ["spec"],
  // The first open compiles the dev module graph and the Galley wasm: slow.
  mochaOpts: { ui: "bdd", timeout: 180_000 },
  waitforTimeout: 30_000,
  logLevel: "warn",
  outputDir: runDir,
  // A smoke suite that needs retries is telling you something.
  specFileRetries: 0,
  afterTest: async (test, _context, result) => {
    if (result.passed) return;
    const name = test.title.replaceAll(/[^a-z0-9]+/giu, "-");
    await browser.saveScreenshot(path.join(runDir, `failed-${name}.png`));
  },
};
