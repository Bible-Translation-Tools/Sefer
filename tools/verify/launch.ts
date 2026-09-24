import { createWriteStream } from "node:fs";
import path from "node:path";
import process from "node:process";

import { freePort, newRun, spawnVite, waitForReady } from "./devServer.ts";

interface Options {
  readonly check: boolean;
}

const parseOptions = (argv: readonly string[]): Options => {
  let check = false;
  for (const argument of argv) {
    if (argument === "--check") check = true;
    else throw new Error(`unknown argument: ${argument}`);
  }
  return { check };
};

const main = async (): Promise<void> => {
  const options = parseOptions(process.argv.slice(2));
  const root = process.cwd();
  const { runId, runDir } = newRun(root);

  const port = await freePort();
  const url = `http://localhost:${String(port)}/dev/fixture`;

  const child = spawnVite(root, port, { ...process.env, SEFER_LOG: "1", VITE_SEFER_LOG: "1" });

  const observability = createWriteStream(path.join(runDir, "observability.jsonl"));
  const server = createWriteStream(path.join(runDir, "server.log"));
  child.stdout?.on("data", (chunk: Buffer) => server.write(chunk));
  child.stderr?.on("data", (chunk: Buffer) => {
    observability.write(chunk);
    process.stderr.write(chunk);
  });

  const stop = (): void => {
    if (child.exitCode === null) child.kill("SIGTERM");
    observability.end();
    server.end();
  };

  try {
    const readyMs = await waitForReady(url, child);
    process.stdout.write(`${JSON.stringify({ url, runId, runDir, pid: child.pid ?? 0 })}\n`);
    process.stderr.write(`ready in ${String(readyMs)} ms\n`);
  } catch (error) {
    stop();
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  if (options.check) {
    stop();
    return;
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      stop();
      process.exit(0);
    });
};

if (import.meta.main) await main();
