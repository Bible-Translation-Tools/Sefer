import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { buildDesktop, scratchHome, startDevServer } from "./desktopApp.ts";
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

  const home = scratchHome(runDir);
  mkdirSync(home, { recursive: true });
  const server = await startDevServer(root, runDir);
  try {
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
