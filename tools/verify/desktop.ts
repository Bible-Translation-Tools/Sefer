/**
 * `pnpm verify:desktop` — the real desktop app, driveable over WebDriver.
 *
 * The desktop twin of `verify:launch`: builds the debug binary with the
 * embedded WebDriver server (`cargo build --features webdriver`, incremental),
 * starts a Vite dev server and the app on free ports, waits until the
 * WebDriver server answers `/status`, and prints ONE JSON line:
 *
 *     {"webdriver":"http://127.0.0.1:61234","hostname":"127.0.0.1","port":61234,
 *      "devUrl":"http://localhost:61233/","home":"…/.verify/<runId>/home",
 *      "runId":"…","runDir":"…/.verify/<runId>","appPid":1234,"vitePid":1233}
 *
 * Attach from a script with WebdriverIO:
 *
 *     import { remote } from "webdriverio";
 *     const browser = await remote({ hostname, port, capabilities: {} });
 *     await browser.execute(() => globalThis.__sefer?.state());
 *     await browser.saveScreenshot(".verify/<runId>/01-landing.png");
 *     await browser.deleteSession(); // the app keeps running
 *
 * Without `--check` it stays up until SIGINT or SIGTERM, then stops the app
 * and the dev server. With `--check` it opens one session, reads the title and
 * whether `globalThis.__sefer` is there, prints that as a second JSON line,
 * and stops.
 *
 *     pnpm verify:desktop                 # build, launch, stay up
 *     pnpm verify:desktop --check         # build, launch, prove a session, stop
 *     pnpm verify:desktop --no-build      # reuse the binary as it is
 *     pnpm verify:desktop --home <dir>    # keep the app's data across runs
 *
 * The app's window appears and takes focus: a WKWebView has no headless mode.
 * Its data lives under the scratch `HOME`, never the person's own.
 */

import path from "node:path";
import process from "node:process";

import { buildDesktop, startDesktop } from "./desktopApp.ts";
import { newRun } from "./devServer.ts";

interface Options {
  readonly check: boolean;
  readonly build: boolean;
  readonly home: string | undefined;
}

const parseOptions = (argv: readonly string[]): Options => {
  let check = false;
  let build = true;
  let home: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") check = true;
    else if (argument === "--no-build") build = false;
    else if (argument === "--home") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("--home needs a folder");
      home = path.resolve(value);
      index += 1;
    } else throw new Error(`unknown argument: ${String(argument)}`);
  }
  return { check, build, home };
};

/** One W3C call, without a client library: the check needs three. */
const call = async (
  base: string,
  method: "POST" | "DELETE",
  route: string,
  body?: unknown,
): Promise<unknown> => {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  // SAFETY: every W3C response is `{ value }`; the check only reports it.
  const answer = (await response.json()) as { value?: unknown };
  if (!response.ok) throw new Error(`${method} ${route}: ${JSON.stringify(answer.value)}`);
  return answer.value;
};

const check = async (base: string): Promise<Record<string, unknown>> => {
  // SAFETY: a new session's value carries `sessionId` (W3C §8.1).
  const session = (await call(base, "POST", "/session", { capabilities: {} })) as {
    sessionId: string;
  };
  try {
    const page = await call(base, "POST", `/session/${session.sessionId}/execute/sync`, {
      script:
        "return { title: document.title, url: location.href, sefer: typeof globalThis.__sefer, host: typeof globalThis.__TAURI_INTERNALS__ }",
      args: [],
    });
    return { session: true, page };
  } finally {
    await call(base, "DELETE", `/session/${session.sessionId}`);
  }
};

const main = async (): Promise<void> => {
  const options = parseOptions(process.argv.slice(2));
  const root = process.cwd();
  const { runId, runDir } = newRun(root);

  if (options.build) {
    process.stderr.write("building the driven debug binary (cargo build --features webdriver)…\n");
    buildDesktop(root, runDir);
  }

  const run = await startDesktop(
    root,
    runDir,
    options.home === undefined ? {} : { home: options.home },
  );
  const webdriver = `http://${run.webdriver.hostname}:${String(run.webdriver.port)}`;
  process.stdout.write(
    `${JSON.stringify({
      webdriver,
      hostname: run.webdriver.hostname,
      port: run.webdriver.port,
      devUrl: run.devUrl,
      home: run.home,
      runId,
      runDir,
      appPid: run.appPid,
      vitePid: run.vitePid,
    })}\n`,
  );
  process.stderr.write(`ready in ${String(run.readyMs)} ms\n`);

  if (options.check) {
    try {
      process.stdout.write(`${JSON.stringify(await check(webdriver))}\n`);
    } catch (error) {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 1;
    } finally {
      run.stop();
    }
    return;
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      run.stop();
      process.exit(0);
    });
};

if (import.meta.main) await main();
