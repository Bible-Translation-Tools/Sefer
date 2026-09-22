/**
 * Runs the Tauri CLI with the generated config overlays.
 *
 * `pnpm dev:tauri` and `pnpm build:tauri` go through here rather than calling
 * `tauri` directly, because both need the same two things first: the updater
 * overlay written from the environment, and — when `SEFER_CHANNEL=preview` —
 * the preview product name and identifier layered on top. Doing that in a
 * shell one-liner would not survive Windows, and forgetting it would silently
 * build a desktop app with no updater endpoint.
 *
 * Usage: `node tools/tauri/run.ts dev|build [extra tauri args…]`.
 */

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
