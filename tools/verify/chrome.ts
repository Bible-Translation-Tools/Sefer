/**
 * The verification browser: one Chrome, its own profile, the debugger on.
 *
 * Chrome 136+ refuses remote debugging on the DEFAULT data directory, which is
 * also where a person's real browsing lives — so a dedicated `--user-data-dir`
 * is not a nicety, it is the only way in. That directory is also where this
 * rig's OPFS lives, which is why the profile is long-lived and named rather
 * than a temporary: a project imported once (en_ulb, 66 books) is still there
 * next week, and no agent has to import it again.
 *
 * HEADLESS BY DEFAULT, and that is the point of this file. macOS activates an
 * application, not a window: a visible Chrome driven by an agent raises
 * `Google Chrome.app` and takes the keyboard away from whatever the person was
 * doing in their own Chrome — a different profile, but the same dock icon.
 * Headless draws nothing, takes no focus, and still does OPFS, screenshots and
 * tracing.
 *
 * Two more things this exists to prevent, both learned the hard way:
 *
 *   * Launching the app while an instance with another `--user-data-dir` is
 *     already running does NOT start a second one. macOS activates the running
 *     process, so the person clicks Chrome and gets the rig's empty profile
 *     instead of their own, with no explanation. `--stop` is the fix, and
 *     `--status` is how you find out that is what happened.
 *   * A rig left running holds the port. Start is idempotent: if the profile
 *     is already up it reports the endpoint rather than failing or, worse,
 *     launching a second Chrome that silently cannot bind.
 *
 * Usage:
 *
 *     pnpm verify:chrome                # start headless, print the endpoint
 *     pnpm verify:chrome --headed       # start with a window, to watch or drive
 *     pnpm verify:chrome --status       # is it up, which mode, how many tabs
 *     pnpm verify:chrome --stop         # quit it and give the port back
 *
 * Attach with Playwright's `chromium.connectOverCDP(endpoint)`, where
 * `endpoint` is the `cdp` field of the JSON line this prints.
 */

import { execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

/**
 * Google Chrome, unless `SEFER_CHROME` names another Chromium build — Brave on
 * a machine without Chrome, say. Anything that speaks CDP and honours
 * `--user-data-dir` works; the rig's profile is still its own, so a person's
 * profile in that browser is never touched.
 *
 *     SEFER_CHROME="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" pnpm verify:chrome
 */
const CHROME =
  process.env["SEFER_CHROME"] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = path.join(homedir(), ".sefer-cdp-profile");
const PORT = 9222;

/**
 * Both loopback spellings, because which one answers has changed between
 * launches: Chrome binds one family and REFUSES the other outright, so a rig
 * that only knows `127.0.0.1` looks dead half the time.
 */
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

/** Ask both spellings who is there. `undefined` means nothing is listening. */
const askVersion = async (): Promise<Version | undefined> => {
  for (const host of HOSTS) {
    try {
      const response = await fetch(`http://${host}:${PORT}/json/version`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) continue;
      // SAFETY: every field is optional and every read below has a fallback,
      // so a body that is not the shape DevTools documents degrades to
      // "unknown" rather than throwing. The 200 is what we actually rely on.
      const body = (await response.json()) as {
        Browser?: string;
        webSocketDebuggerUrl?: string;
      };
      return {
        host,
        cdp: `http://${host}:${PORT}`,
        browser: body.Browser ?? "unknown",
      };
    } catch {
      // Refused, or the other address family. Try the next spelling.
    }
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
    // SAFETY: same contract as above — both fields optional, both defaulted.
    // A malformed entry filters out on `type`, and the `catch` covers a body
    // that is not an array at all.
    const list = (await response.json()) as readonly { type?: string; url?: string }[];
    return list.filter((tab) => tab.type === "page").map((tab) => tab.url ?? "");
  } catch {
    return [];
  }
};

/**
 * Whether the running Chrome is the RIG's — matched on the profile path, not
 * on the port. Anything else answering 9222 is somebody else's browser, and
 * `--stop` must not kill it.
 */
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
    // Idempotent on purpose: a second launch would fail to bind and leave a
    // stray Chrome behind, which is how the rig ends up hijacking a desktop.
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
    // Nothing here should ever become the machine's default browser, nor ask.
    "--no-default-browser-check",
    "about:blank",
  ];
  // `--headless=new` is the modern headless: same renderer, same OPFS, no
  // window and no focus. The old `--headless` is a different browser and does
  // not share this profile's storage.
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
    // Deliberately does NOT kill whatever else may hold the port: this command
    // owns the rig's profile and nothing else.
    say({ stopped: false, reason: "no rig process", profile: PROFILE });
    return;
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone between the listing and the signal.
    }
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
