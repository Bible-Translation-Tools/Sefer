import { execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

const CHROME =
  process.env["SEFER_CHROME"] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = path.join(homedir(), ".sefer-cdp-profile");
const PORT = 9222;

const HOSTS = ["127.0.0.1", "[::1]"] as const;

interface Options {
  readonly mode: "start" | "status" | "stop";
  readonly headed: boolean;
}

const parseOptions = (argv: readonly string[]): Options => {
  let mode: Options["mode"] = "start";
  let headed = false;
  for (const argument of argv) {
    if (argument === "--headed") headed = true;
    else if (argument === "--status") mode = "status";
    else if (argument === "--stop") mode = "stop";
    else throw new Error(`unknown argument: ${argument}`);
  }
  return { mode, headed };
};

interface Version {
  readonly host: string;
  readonly cdp: string;
  readonly browser: string;
}

const askVersion = async (): Promise<Version | undefined> => {
  for (const host of HOSTS) {
    try {
      const response = await fetch(`http://${host}:${PORT}/json/version`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) continue;
      // SAFETY: every field is optional and every read below has a fallback, so a body that is not the shape DevTools documents degrades to "unknown" rather than throwing. The 200 is what we actually rely on.
      const body = (await response.json()) as {
        Browser?: string;
        webSocketDebuggerUrl?: string;
      };
      return {
        host,
        cdp: `http://${host}:${PORT}`,
        browser: body.Browser ?? "unknown",
      };
    } catch {}
  }
  return undefined;
};

const waitForVersion = async (timeoutMs: number): Promise<Version | undefined> => {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const found = await askVersion();
    if (found !== undefined) return found;
    if (Date.now() > until) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
};

const openTabs = async (version: Version): Promise<readonly string[]> => {
  try {
    const response = await fetch(`${version.cdp}/json/list`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return [];
    // SAFETY: same contract as above — both fields optional, both defaulted. A malformed entry filters out on `type`, and the `catch` covers a body that is not an array at all.
    const list = (await response.json()) as readonly { type?: string; url?: string }[];
    return list.filter((tab) => tab.type === "page").map((tab) => tab.url ?? "");
  } catch {
    return [];
  }
};

const rigProcesses = (): readonly number[] => {
  try {
    const out = execFileSync("ps", ["-Ao", "pid=,command="], { encoding: "utf8" });
    return out
      .split("\n")
      .filter((line) => line.includes(PROFILE) && line.includes("--remote-debugging-port"))
      .map((line) => Number.parseInt(line.trim().split(/\s+/)[0] ?? "", 10))
      .filter((pid) => Number.isInteger(pid));
  } catch {
    return [];
  }
};

const say = (line: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify(line)}\n`);
};

const start = async (headed: boolean): Promise<void> => {
  const already = await askVersion();
  if (already !== undefined) {
    say({
      started: false,
      reason: "already running",
      cdp: already.cdp,
      browser: already.browser,
      profile: PROFILE,
      note: "pass --stop first to change headed/headless",
    });
    return;
  }

  const args = [
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ];
  if (!headed) args.unshift("--headless=new");

  const child = spawn(CHROME, args, { detached: true, stdio: "ignore" });
  child.unref();

  const version = await waitForVersion(20_000);
  if (version === undefined) {
    say({ started: false, reason: "no debugger answered", profile: PROFILE, port: PORT });
    process.exitCode = 1;
    return;
  }
  say({
    started: true,
    headed,
    cdp: version.cdp,
    browser: version.browser,
    profile: PROFILE,
    pid: child.pid,
  });
};

const status = async (): Promise<void> => {
  const version = await askVersion();
  const pids = rigProcesses();
  if (version === undefined) {
    say({ running: false, rigProcesses: pids, profile: PROFILE });
    return;
  }
  const tabs = await openTabs(version);
  say({
    running: true,
    cdp: version.cdp,
    browser: version.browser,
    isRig: pids.length > 0,
    rigProcesses: pids,
    tabs: tabs.length,
    urls: tabs,
    profile: PROFILE,
  });
};

const stop = async (): Promise<void> => {
  const pids = rigProcesses();
  if (pids.length === 0) {
    say({ stopped: false, reason: "no rig process", profile: PROFILE });
    return;
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  const until = Date.now() + 10_000;
  for (;;) {
    if ((await askVersion()) === undefined) break;
    if (Date.now() > until) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  say({ stopped: true, pids, profile: PROFILE });
};

const options = parseOptions(process.argv.slice(2));
if (options.mode === "start") await start(options.headed);
else if (options.mode === "status") await status();
else await stop();
