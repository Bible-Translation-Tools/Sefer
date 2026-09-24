/**
 * What `verify:launch` and `verify:perf` share: a run directory, a free port,
 * a Vite dev server on it, and the wait until a route answers.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";

const READINESS_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 250;

/** `.verify/<runId>/`, created. The id sorts by time and never collides. */
export const newRun = (root: string): { readonly runId: string; readonly runDir: string } => {
  const runId = `${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}`;
  const runDir = path.join(root, ".verify", runId);
  mkdirSync(runDir, { recursive: true });
  return { runId, runDir };
};

export const freePort = (): Promise<number> =>
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

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** `vite --port <port> --strictPort` in `root`, both streams piped for the caller to tee. */
export const spawnVite = (
  root: string,
  port: number,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ChildProcess =>
  spawn(path.join(root, "node_modules", ".bin", "vite"), ["--port", String(port), "--strictPort"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

/**
 * The `accept: text/html` header is not optional: the Solid plugin's dev page
 * middleware only answers requests that ask for HTML.
 */
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

/** Milliseconds until `url` answered 200. Throws if Vite exits or a minute passes. */
export const waitForReady = async (url: string, child: ChildProcess): Promise<number> => {
  const started = Date.now();
  while (Date.now() - started < READINESS_TIMEOUT_MS) {
    if (child.exitCode !== null) throw new Error(`vite exited with ${String(child.exitCode)}`);
    if (await responds(url)) return Date.now() - started;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${url} did not respond 200 within ${String(READINESS_TIMEOUT_MS)} ms`);
};
