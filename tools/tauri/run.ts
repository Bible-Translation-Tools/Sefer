import { spawnSync } from "node:child_process";
import process from "node:process";

import { channelOf, writeUpdaterConfig } from "./updaterConfig.ts";

const [command, ...rest] = process.argv.slice(2);
if (command === undefined) {
  process.stderr.write("usage: node tools/tauri/run.ts dev|build [args…]\n");
  process.exit(2);
}

const overlay = writeUpdaterConfig(process.cwd());
const configs = ["--config", overlay];
if (channelOf(process.env.SEFER_CHANNEL) === "preview") {
  configs.push("--config", "src-tauri/tauri.conf.preview.json");
}

const result = spawnSync("pnpm", ["exec", "tauri", command, ...configs, ...rest], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
