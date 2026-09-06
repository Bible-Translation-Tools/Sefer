import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";

const READINESS_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 250;

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

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("no port available"));
        return;
      }
      const { port } = address;
      server.close(() => {
        resolve(port);
      });
    });
  });

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const responds = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { accept: "text/html" },
    });
    return response.status === 200;
  } catch {
    return false;
  }
};

const waitForReady = async (url: string, child: ChildProcess): Promise<number> => {
  const started = Date.now();
  while (Date.now() - started < READINESS_TIMEOUT_MS) {
    if (child.exitCode !== null) throw new Error(`vite exited with ${String(child.exitCode)}`);
    if (await responds(url)) return Date.now() - started;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${url} did not respond 200 within ${String(READINESS_TIMEOUT_MS)} ms`);
};

const main = async (): Promise<void> => {
  const options = parseOptions(process.argv.slice(2));
  const root = process.cwd();
  const runId = `${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}`;
  const runDir = path.join(root, ".verify", runId);
  mkdirSync(runDir, { recursive: true });

  const port = await freePort();
  const url = `http://localhost:${String(port)}/dev/fixture`;

  const child = spawn(
    path.join(root, "node_modules", ".bin", "vite"),
    ["--port", String(port), "--strictPort"],
    {
      cwd: root,
      env: { ...process.env, SEFER_LOG: "1", VITE_SEFER_LOG: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

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
