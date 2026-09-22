/**
 * Print one channel's endpoint variables as `KEY=value` lines.
 *
 *     node tools/deploy/channelEnv.ts production >> "$GITHUB_ENV"
 *
 * For the desktop job, which builds the frontend through `tauri-action` rather
 * than through `tools/deploy/web.ts` and cannot import a TypeScript table from
 * a YAML `env:` block. One table in `channels.ts`, two ways of reading it, so
 * the web build and the desktop build cannot end up pointed at different
 * content hosts for the same channel.
 */

import process from "node:process";

import { CHANNEL_ENDPOINTS, channelEnv, type Channel } from "./channels.ts";

const isChannel = (value: string): value is Channel => Object.hasOwn(CHANNEL_ENDPOINTS, value);

const main = (): void => {
  const name = process.argv[2];
  if (name === undefined || !isChannel(name)) {
    process.stderr.write(
      `channelEnv: expected one of ${Object.keys(CHANNEL_ENDPOINTS).join(", ")}\n`,
    );
    process.exitCode = 1;
    return;
  }
  for (const [key, value] of Object.entries(channelEnv(name))) {
    process.stdout.write(`${key}=${value}\n`);
  }
};

main();
