/**
 * `pnpm test:desktop` — the desktop specs in `e2e-desktop/`, against the real
 * app.
 *
 * Builds the driven debug binary, starts a Vite dev server on a free port,
 * then runs WebdriverIO with `e2e-desktop/wdio.conf.ts`. `@wdio/tauri-service`
 * spawns the app itself (embedded provider: it sets `TAURI_WEBDRIVER_PORT` and
 * connects to the server inside the app). The app inherits WebdriverIO's
 * environment, which is how `SEFER_DEV_URL` reaches it; the config hands it
 * `SEFER_DESKTOP_HOME` as its `HOME`, so only the app runs under the scratch
 * folder.
 * Artifacts (cargo and Vite logs, WebdriverIO's output, screenshots of a
 * failing spec) land in `.verify/<runId>/`.
 *
 *     pnpm test:desktop               # build, then run every spec
 *     pnpm test:desktop --no-build    # reuse the binary as it is
 *
 * Not in CI and not in `pnpm check` yet; documentation/architecture/testing.md
 * says how it would go there.
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { buildDesktop, startDevServer } from "./desktopApp.ts";
import { newRun } from "./devServer.ts";

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  for (const argument of argv)
    if (argument !== "--no-build") throw new Error(`unknown argument: ${argument}`);

  const root = process.cwd();
  const { runId, runDir } = newRun(root);
  process.stderr.write(`run ${runId}: ${runDir}\n`);
  if (!argv.includes("--no-build")) {
    process.stderr.write("building the driven debug binary (cargo build --features webdriver)…\n");
    buildDesktop(root, runDir);
  }

  const home = path.join(runDir, "home");
  mkdirSync(home, { recursive: true });
  const server = await startDevServer(root, runDir);
  try {
    // Not spawnSync: that would stop this process draining Vite's pipes, and a
    // dev server whose output nobody reads eventually blocks writing it.
    const wdio = spawn(
      path.join(root, "node_modules", ".bin", "wdio"),
      ["run", path.join(root, "e2e-desktop", "wdio.conf.ts")],
      {
        cwd: root,
        stdio: "inherit",
        env: {
          ...process.env,
          SEFER_DEV_URL: server.devUrl,
          SEFER_DESKTOP_HOME: home,
          SEFER_VERIFY_RUN_DIR: runDir,
        },
      },
    );
    const status = await new Promise<number | null>((resolve) => {
      wdio.on("exit", resolve);
    });
    process.exitCode = status ?? 1;
  } finally {
    server.stop();
  }
};

if (import.meta.main) await main();
