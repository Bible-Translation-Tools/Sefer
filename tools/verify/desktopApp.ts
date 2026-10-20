import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { freePort, sleep, spawnVite, waitForReady } from "./devServer.ts";

const STATUS_TIMEOUT_MS = 90_000;

const desktopBinary = (root: string): string =>
  path.join(
    root,
    "src-tauri",
    "target",
    "debug",
    process.platform === "win32" ? "sefer.exe" : "sefer",
  );

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

const waitForWebDriver = async (port: number, app: ChildProcess): Promise<number> => {
  const started = Date.now();
  while (Date.now() - started < STATUS_TIMEOUT_MS) {
    if (app.exitCode !== null) throw new Error(`the app exited with ${String(app.exitCode)}`);
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/status`, {
        signal: AbortSignal.timeout(2000),
      });
      // SAFETY: W3C `/status` is `{ value: { ready: boolean, message } }`; a body of another shape reads as not ready and the loop tries again.
      const body = (await response.json()) as { value?: { ready?: boolean } };
      if (body.value?.ready === true) return Date.now() - started;
    } catch {}
    await sleep(250);
  }
  throw new Error(
    `no WebDriver answered on ${String(port)} within ${String(STATUS_TIMEOUT_MS)} ms`,
  );
};

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

export const scratchHome = (runDir: string): string =>
  path.join(tmpdir(), "sefer-verify", path.basename(runDir), "home");

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

const desktopEnv = (devUrl: string, home: string): Record<string, string> => ({
  ...scratchEnv(home),
  SEFER_DEV_URL: devUrl,
});

export interface DesktopRun {
  readonly webdriver: { readonly hostname: string; readonly port: number };
  readonly devUrl: string;
  readonly home: string;
  readonly appPid: number;
  readonly vitePid: number;
  readonly readyMs: number;
  readonly stop: () => void;
}

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
