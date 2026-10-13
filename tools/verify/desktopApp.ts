/**
 * The driven desktop app: what `verify:desktop` and `test:desktop` share.
 *
 * Three pieces, each on a free port so two runs (two worktrees, two agents)
 * never meet:
 *
 *   1. `cargo build --features webdriver` — the debug binary with WebdriverIO's
 *      embedded WebDriver server (`tauri-plugin-wdio-webdriver`) compiled in.
 *      The feature exists nowhere else, and `src-tauri/src/lib.rs` refuses to
 *      compile it into a release; see documentation/architecture/desktop.md.
 *   2. A Vite dev server, so the webview runs the dev module graph and
 *      `globalThis.__sefer` (the observability surface) is there to read.
 *   3. The binary itself, told the dev server's URL through `SEFER_DEV_URL`
 *      (instead of the compiled-in `localhost:3000`) and its WebDriver port
 *      through `TAURI_WEBDRIVER_PORT`, with `HOME` (and on Linux the XDG
 *      folders) pointed at a scratch folder so the app's data — the Library,
 *      settings, projects it creates — never lands in the person's own
 *      `~/Library/Application Support` or `~/.local/share`. Windows is refused:
 *      see `scratchEnv`.
 *
 * Node built-ins only, like the other `tools/verify` scripts.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { freePort, sleep, spawnVite, waitForReady } from "./devServer.ts";

const STATUS_TIMEOUT_MS = 90_000;

/** `src-tauri/target/debug/sefer`, the binary `cargo build` writes. */
const desktopBinary = (root: string): string =>
  path.join(
    root,
    "src-tauri",
    "target",
    "debug",
    process.platform === "win32" ? "sefer.exe" : "sefer",
  );

/**
 * Incremental, so a second run costs seconds; the first costs minutes. Output
 * goes to `<runDir>/cargo.log`, and a failure throws with its tail.
 */
export const buildDesktop = (root: string, runDir: string): void => {
  const log = path.join(runDir, "cargo.log");
  const result = spawnSync("cargo", ["build", "--features", "webdriver"], {
    cwd: path.join(root, "src-tauri"),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const output = `${result.stdout}${result.stderr}`;
  createWriteStream(log).end(output);
  if (result.status !== 0)
    throw new Error(
      `cargo build failed (see ${log}):\n${output.split("\n").slice(-30).join("\n")}`,
    );
};

/** Milliseconds until the embedded server's `/status` says ready. */
const waitForWebDriver = async (port: number, app: ChildProcess): Promise<number> => {
  const started = Date.now();
  while (Date.now() - started < STATUS_TIMEOUT_MS) {
    if (app.exitCode !== null) throw new Error(`the app exited with ${String(app.exitCode)}`);
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/status`, {
        signal: AbortSignal.timeout(2000),
      });
      // SAFETY: W3C `/status` is `{ value: { ready: boolean, message } }`; a
      // body of another shape reads as not ready and the loop tries again.
      const body = (await response.json()) as { value?: { ready?: boolean } };
      if (body.value?.ready === true) return Date.now() - started;
    } catch {
      // Not listening yet.
    }
    await sleep(250);
  }
  throw new Error(
    `no WebDriver answered on ${String(port)} within ${String(STATUS_TIMEOUT_MS)} ms`,
  );
};

/** A Vite dev server for the webview, on a free port, logging to `<runDir>/vite.log`. */
export const startDevServer = async (
  root: string,
  runDir: string,
): Promise<{ readonly devUrl: string; readonly pid: number; readonly stop: () => void }> => {
  const port = await freePort();
  const devUrl = `http://localhost:${String(port)}/`;
  const vite = spawnVite(root, port);
  const log = createWriteStream(path.join(runDir, "vite.log"));
  vite.stdout?.pipe(log);
  vite.stderr?.pipe(log);
  const stop = (): void => {
    if (vite.exitCode === null) vite.kill("SIGTERM");
  };
  try {
    await waitForReady(devUrl, vite);
  } catch (error) {
    stop();
    throw error;
  }
  return { devUrl, pid: vite.pid ?? 0, stop };
};

/**
 * The app's scratch `HOME` for a run: `<tmp>/sefer-verify/<runId>/home`, NOT
 * under `.verify/` (which holds the logs and screenshots). The fs capability
 * scope's globs cross one hidden folder below `$APPDATA`, and a journal path
 * nests the project's absolute path inside app data, so a `HOME` under
 * `.claude/…/.verify/` put two hidden folders in every journal path and every
 * backup-journal write was refused as a forbidden path (2026-10-13). A
 * person's real paths have none.
 */
export const scratchHome = (runDir: string): string =>
  path.join(tmpdir(), "sefer-verify", path.basename(runDir), "home");

/**
 * The variables that move the app's data folders under the scratch `home`:
 * `HOME` on macOS, where app data is `$HOME/Library/Application Support`, and
 * on Linux the XDG folders too, which take precedence over `HOME` when the
 * developer has them set. `test:desktop` hands the same variables to
 * `@wdio/tauri-service` (`e2e-desktop/wdio.conf.ts`), which spawns the app
 * itself. Windows is refused: Tauri reads app data from the Known Folders
 * API, which no environment variable redirects, so a driven run there would
 * write into the developer's own `%APPDATA%\org.wycliffe.sefer`.
 */
export const scratchEnv = (home: string): Record<string, string> => {
  if (process.platform === "win32")
    throw new Error(
      "driven desktop runs are macOS and Linux only: on Windows the app's data folder cannot be moved to a scratch folder",
    );
  return {
    HOME: home,
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_STATE_HOME: path.join(home, ".local", "state"),
  };
};

/** The environment the app runs under: the dev server's URL and the scratch folders. */
const desktopEnv = (devUrl: string, home: string): Record<string, string> => ({
  ...scratchEnv(home),
  SEFER_DEV_URL: devUrl,
});

export interface DesktopRun {
  /** Where a WebDriver client connects: `remote({ hostname, port })`. */
  readonly webdriver: { readonly hostname: string; readonly port: number };
  readonly devUrl: string;
  /** The scratch `HOME` the app ran under; its data is in `Library/Application Support/org.wycliffe.sefer`. */
  readonly home: string;
  readonly appPid: number;
  readonly vitePid: number;
  readonly readyMs: number;
  readonly stop: () => void;
}

/**
 * Starts Vite and the app, waits for both, and tees the app's output into
 * `<runDir>/app.log`. `home` defaults to a fresh `scratchHome(runDir)`; pass a
 * folder to keep a profile across runs.
 */
export const startDesktop = async (
  root: string,
  runDir: string,
  options: { readonly home?: string } = {},
): Promise<DesktopRun> => {
  const binary = desktopBinary(root);
  if (!existsSync(binary)) throw new Error(`${binary} is missing; build it first`);
  const home = options.home ?? scratchHome(runDir);
  mkdirSync(home, { recursive: true });
  const started = Date.now();

  const server = await startDevServer(root, runDir);
  const webdriverPort = await freePort();
  const app = spawn(binary, [], {
    cwd: root,
    env: {
      ...process.env,
      ...desktopEnv(server.devUrl, home),
      TAURI_WEBDRIVER_PORT: String(webdriverPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const appLog = createWriteStream(path.join(runDir, "app.log"));
  app.stdout?.pipe(appLog);
  app.stderr?.pipe(appLog);
  const stop = (): void => {
    if (app.exitCode === null) app.kill("SIGTERM");
    server.stop();
  };

  try {
    await waitForWebDriver(webdriverPort, app);
  } catch (error) {
    stop();
    throw error;
  }

  return {
    webdriver: { hostname: "127.0.0.1", port: webdriverPort },
    devUrl: server.devUrl,
    home,
    appPid: app.pid ?? 0,
    vitePid: server.pid,
    readyMs: Date.now() - started,
    stop,
  };
};
