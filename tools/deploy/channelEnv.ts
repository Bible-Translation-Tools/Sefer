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
