/**
 * What recording costs: the same typing, measured at each recording level.
 *
 *   pnpm verify:perf                       # 200 chars, 3 runs, levels off and all
 *   pnpm verify:perf --chars 400 --runs 5
 *   pnpm verify:perf --headed              # watch it type
 *
 * One dev server on a free port, one Chromium driven by Playwright. Each run
 * opens a FRESH page per level (fresh composition, empty ring, cold heap),
 * seeds the `small-nt` fixture through `/projects?fixture=1`, and then only
 * clicks: Open, Psalms, USFM, a line. It types a warm-up, then the measured
 * characters at a fixed cadence, then opens Compare against the files. The
 * level is set through `__sefer.observability.setLevel` before any of that.
 *
 * TWO INSTRUMENTS, because the app's own one says nothing at `off`:
 *
 *  - `meter` — the keystroke meter's numbers as the ring records them on each
 *    `editor.mutation` (`editor.gesture_ms` = the meter's `gesture`,
 *    `editor.to_paint_ms` = its `render`/`input`). Absent at `off`, where the
 *    ring records nothing — including the operation the meter writes onto.
 *  - `probe` — this script's own, installed before the app and the same at
 *    every level. From the browser's Event Timing entries of each key press:
 *    `handlers`, the summed processing time of its events (the JS work, the
 *    meter's `gesture` plus the browser's input handling), and `input`, the
 *    browser's input-to-paint. Plus `paint`, the frame trick the meter falls
 *    back to, for every key. The all-vs-off delta is taken on these, since
 *    they are the only numbers both levels have. Event Timing reports nothing
 *    under 16ms, so `presses` says how many keys it answered; the headless
 *    shell answers nearly all of them, new-headless Chrome about half.
 *
 * Deliberately NOT a setTimeout-after-keydown probe: Chrome runs the frame
 * after a discrete input before other tasks, so that measures "until the next
 * frame", not the work.
 *
 * Writes `<runDir>/<level>-<run>.jsonl` (every event of the typing window,
 * drained from the ring as it goes so a wrap loses nothing) and
 * `<runDir>/summary.json`, and prints one JSON line: medians across runs.
 */

import { createWriteStream, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { chromium, type Browser, type Page } from "playwright";

import { freePort, newRun, sleep, spawnVite, waitForReady } from "./devServer.ts";

const LEVELS = ["off", "verdicts", "spans", "all"] as const;
type Level = (typeof LEVELS)[number];

/** `core/observability.ts`'s `DEFAULT_CAPACITY`: what `ringMinutes` divides. */
const RING_CAPACITY = 2000;

const TEXT = "the quick brown fox jumps over the lazy dog and then rests a while ";

interface Options {
  readonly chars: number;
  readonly runs: number;
  readonly warmup: number;
  readonly cadence: number;
  readonly levels: readonly Level[];
  readonly headed: boolean;
}

const isLevel = (value: string): value is Level => LEVELS.some((level) => level === value);

const parseOptions = (argv: readonly string[]): Options => {
  let chars = 200;
  let runs = 3;
  let warmup = 20;
  let cadence = 150;
  let levels: readonly Level[] = ["off", "all"];
  let headed = false;
  const count = (value: string | undefined, flag: string): number => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1)
      throw new Error(`${flag} wants a positive integer`);
    return parsed;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--headed") headed = true;
    else if (argument === "--chars") chars = count(argv[(index += 1)], argument);
    else if (argument === "--runs") runs = count(argv[(index += 1)], argument);
    else if (argument === "--warmup") warmup = count(argv[(index += 1)], argument);
    else if (argument === "--cadence") cadence = count(argv[(index += 1)], argument);
    else if (argument === "--levels") {
      const asked = (argv[(index += 1)] ?? "").split(",");
      if (!asked.every(isLevel)) throw new Error(`--levels takes ${LEVELS.join(",")}`);
      levels = asked;
    } else throw new Error(`unknown argument: ${String(argument)}`);
  }
  return { chars, runs, warmup, cadence, levels, headed };
};

/** Nearest-rank percentile; `null` for no samples, never a made-up zero. */
const percentile = (values: readonly number[], p: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
};

const median = (values: readonly (number | null)[]): number | null => {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : percentile(present, 50);
};

const round = (value: number | null, places = 1): number | null =>
  value === null ? null : Number(value.toFixed(places));

/** One Event Timing entry, as the probe keeps it. */
interface Timed {
  readonly name: string;
  readonly start: number;
  readonly processing: number;
  readonly duration: number;
}

interface Probe {
  readonly entries: Timed[];
  readonly paints: number[];
}

declare global {
  var __perfProbe: Probe | undefined;
}

/**
 * Installed before any app script, so it sees every key the app does.
 *
 * Event Timing for the browser's own numbers, and a `keydown` capture
 * listener for the frame trick, which also answers the keys Event Timing
 * leaves out (anything under its 16ms floor).
 */
const installProbe = (): void => {
  const probe: Probe = { entries: [], paints: [] };
  globalThis.__perfProbe = probe;
  // `durationThreshold` is Event Timing's own option, absent from the DOM
  // lib's `PerformanceObserverInit`; widened, never narrowed.
  const init: PerformanceObserverInit & { durationThreshold: number } = {
    type: "event",
    durationThreshold: 16,
  };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!(entry instanceof PerformanceEventTiming)) continue;
      probe.entries.push({
        name: entry.name,
        start: entry.startTime,
        processing: entry.processingEnd - entry.processingStart,
        duration: entry.duration,
      });
    }
  }).observe(init);
  window.addEventListener(
    "keydown",
    () => {
      const began = performance.now();
      requestAnimationFrame(() => {
        setTimeout(() => {
          probe.paints.push(performance.now() - began);
        }, 0);
      });
    },
    { capture: true },
  );
};

/**
 * One key press is several events (`keydown`, `keypress`, `beforeinput`,
 * `input`, `keyup`) sharing one hardware timestamp. Grouped on it: `handlers`
 * is the summed processing time of the press's events — the JS work, at
 * every level — and `input` the longest duration, the browser's
 * input-to-paint. `keyup` is its own interaction and is left out.
 */
const presses = (entries: readonly Timed[]): { handlers: number[]; input: number[] } => {
  const byStart = new Map<number, Timed[]>();
  for (const entry of entries) {
    if (entry.name === "keyup") continue;
    byStart.set(entry.start, [...(byStart.get(entry.start) ?? []), entry]);
  }
  const groups = [...byStart.values()].filter((group) =>
    group.some((one) => one.name === "keydown"),
  );
  return {
    handlers: groups.map((group) => group.reduce((total, one) => total + one.processing, 0)),
    input: groups.map((group) => Math.max(...group.map((one) => one.duration))),
  };
};

/**
 * Ring lines newer than `after`, in export format. Cheap: the seq is the
 * line's first field. (Page functions are serialised, so each one reaches for
 * the surface itself rather than sharing a helper.)
 */
const drain = (page: Page, after: number): Promise<string[]> =>
  page.evaluate(
    (last) =>
      (globalThis.__sefer?.observability?.export() ?? "")
        .split("\n")
        .filter((line) => Number(/^\{"seq":(\d+)/u.exec(line)?.[1] ?? -1) > last),
    after,
  );

const seqOf = (line: string): number => Number(/^\{"seq":(\d+)/u.exec(line)?.[1] ?? -1);

const lastSeq = (lines: readonly string[], fallback: number): number =>
  lines.length === 0 ? fallback : seqOf(lines.at(-1) ?? "");

const charCount = async (page: Page): Promise<number> => {
  const text = await page
    .getByText(/^\d+ chars$/u)
    .first()
    .textContent();
  return Number(/\d+/u.exec(text ?? "")?.[0] ?? Number.NaN);
};

interface Tails {
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
}

interface Measurement {
  readonly level: Level;
  readonly run: number;
  readonly typed: number;
  readonly inserted: number;
  readonly seconds: number;
  readonly meter: {
    readonly samples: number;
    readonly gesture: Tails;
    /** The browser and CodeMirror taking the input, before the first transaction. */
    readonly browserInput: Tails;
    /** What no span and no bucket accounted for. */
    readonly unaccounted: Tails;
    readonly render: Tails;
    readonly renderSource: Record<string, number>;
  };
  readonly probe: {
    readonly presses: number;
    readonly handlers: Tails;
    readonly input: Tails;
    readonly paint: Tails;
  };
  readonly heapMB: number;
  readonly events: number;
  readonly eventsPerMin: number;
  readonly bytesPerMin: number;
  readonly ringMinutes: number | null;
  readonly failures: number;
  readonly errors: number;
  readonly projectOpenMs: number;
  readonly compareMs: number | null;
}

const tails = (values: readonly number[]): Tails => ({
  p50: round(percentile(values, 50)),
  p95: round(percentile(values, 95)),
  p99: round(percentile(values, 99)),
});

const typeAt = async (
  page: Page,
  count: number,
  cadence: number,
  onEvery?: () => Promise<void>,
) => {
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press(TEXT[index % TEXT.length] ?? "x");
    if (onEvery !== undefined && index % 25 === 24) await onEvery();
    const due = started + (index + 1) * cadence;
    await sleep(Math.max(0, due - performance.now()));
  }
};

const measure = async (
  browser: Browser,
  base: string,
  level: Level,
  run: number,
  options: Options,
  runDir: string,
): Promise<Measurement> => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(installProbe);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  try {
    await page.goto(`${base}/projects?fixture=1`);
    const open = page.getByRole("button", { name: "Open", exact: true });
    await open.waitFor();
    const set = await page.evaluate((next) => {
      const surface = globalThis.__sefer?.observability;
      surface?.setLevel(next);
      return surface?.level();
    }, level);
    if (set !== level) throw new Error(`could not set level ${level}: is this the dev server?`);

    // One project open, timed from the click to the book list.
    const openStarted = performance.now();
    await open.click();
    const psalms = page.locator("a[href='/project/small-nt/book/PSA']");
    await psalms.waitFor();
    const projectOpenMs = performance.now() - openStarted;

    await psalms.click();
    await page.locator("button:text-is('USFM')").click();
    await page.locator(".cm-line:has-text('meditates day and night')").click();
    await page.keyboard.press("End");
    await typeAt(page, options.warmup, options.cadence);
    await sleep(1000);

    const before = await charCount(page);
    let seq = lastSeq(await drain(page, -1), -1);
    const out = createWriteStream(path.join(runDir, `${level}-${String(run)}.jsonl`));
    const lines: string[] = [];
    const take = async (): Promise<void> => {
      const fresh = await drain(page, seq);
      seq = lastSeq(fresh, seq);
      for (const line of fresh) {
        lines.push(line);
        out.write(`${line}\n`);
      }
    };
    await page.evaluate(() => {
      globalThis.__perfProbe?.entries.splice(0);
      globalThis.__perfProbe?.paints.splice(0);
    });

    const started = performance.now();
    await typeAt(page, options.chars, options.cadence, take);
    await sleep(1000);
    await take();
    const seconds = (performance.now() - started) / 1000;
    out.end();
    const inserted = (await charCount(page)) - before;

    const probe = await page.evaluate(() => globalThis.__perfProbe ?? { entries: [], paints: [] });
    const pressed = presses(probe.entries);
    const counts = await page.evaluate(() => ({
      failures: globalThis.__sefer?.observability?.failures().length ?? 0,
      errors: globalThis.__sefer?.observability?.errors().length ?? 0,
    }));
    await cdp.send("HeapProfiler.collectGarbage");
    const metrics = await cdp.send("Performance.getMetrics");
    const heap = metrics.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? 0;

    // One comparison: the editor against the files, which the typing made differ.
    const compareStarted = performance.now();
    await page.getByRole("button", { name: "Compare" }).click();
    const differ = page.getByText(/^[1-9]\d* book\(s\) differ$/u);
    const compared = await differ.waitFor({ timeout: 15_000 }).then(
      () => true,
      () => false,
    );
    const compareMs = compared ? performance.now() - compareStarted : null;

    // SAFETY: every line is the ring's own `eventLine` output, drained above.
    const mutations = lines
      .map((line) => JSON.parse(line) as { name: string; attrs?: Record<string, unknown> })
      .filter(
        (event) =>
          event.name === "editor.mutation" && event.attrs?.["editor.gesture_ms"] !== undefined,
      );
    const numeric = (key: string) =>
      mutations
        .map((event) => event.attrs?.[key])
        .filter((value): value is number => typeof value === "number");
    const renderSource: Record<string, number> = {};
    for (const event of mutations) {
      const source = String(event.attrs?.["editor.to_paint_source"] ?? "none");
      renderSource[source] = (renderSource[source] ?? 0) + 1;
    }
    const minutes = seconds / 60;
    const bytes = lines.reduce((total, line) => total + Buffer.byteLength(line) + 1, 0);
    const eventsPerMin = lines.length / minutes;
    return {
      level,
      run,
      typed: options.chars,
      inserted,
      seconds: Number(seconds.toFixed(1)),
      meter: {
        samples: mutations.length,
        gesture: tails(numeric("editor.gesture_ms")),
        browserInput: tails(numeric("editor.browser_input_ms")),
        unaccounted: tails(numeric("editor.unaccounted_ms")),
        render: tails(numeric("editor.to_paint_ms")),
        renderSource,
      },
      probe: {
        presses: pressed.handlers.length,
        handlers: tails(pressed.handlers),
        input: tails(pressed.input),
        paint: tails(probe.paints),
      },
      heapMB: Number((heap / 1024 / 1024).toFixed(1)),
      events: lines.length,
      eventsPerMin: Math.round(eventsPerMin),
      bytesPerMin: Math.round(bytes / minutes),
      ringMinutes: eventsPerMin === 0 ? null : Number((RING_CAPACITY / eventsPerMin).toFixed(2)),
      failures: counts.failures,
      errors: counts.errors,
      projectOpenMs: Math.round(projectOpenMs),
      compareMs: compareMs === null ? null : Math.round(compareMs),
    };
  } finally {
    await page.close();
    await context.close();
  }
};

/** Medians across runs, per level, in the shape the one printed line carries. */
const summarise = (measurements: readonly Measurement[], level: Level) => {
  const mine = measurements.filter((one) => one.level === level);
  const pick = (read: (one: Measurement) => number | null) => round(median(mine.map(read)), 2);
  return {
    runs: mine.length,
    meter: {
      gesture: {
        p50: pick((one) => one.meter.gesture.p50),
        p95: pick((one) => one.meter.gesture.p95),
        p99: pick((one) => one.meter.gesture.p99),
      },
      render: { p95: pick((one) => one.meter.render.p95) },
    },
    probe: {
      handlers: {
        p50: pick((one) => one.probe.handlers.p50),
        p95: pick((one) => one.probe.handlers.p95),
        p99: pick((one) => one.probe.handlers.p99),
      },
      input: { p95: pick((one) => one.probe.input.p95), p99: pick((one) => one.probe.input.p99) },
      paint: { p95: pick((one) => one.probe.paint.p95), p99: pick((one) => one.probe.paint.p99) },
    },
    heapMB: pick((one) => one.heapMB),
    eventsPerMin: pick((one) => one.eventsPerMin),
    bytesPerMin: pick((one) => one.bytesPerMin),
    ringMinutes: pick((one) => one.ringMinutes),
    failures: pick((one) => one.failures),
    projectOpenMs: pick((one) => one.projectOpenMs),
    compareMs: pick((one) => one.compareMs),
  };
};

const percentOver = (value: number | null, baseline: number | null): number | null =>
  value === null || baseline === null || baseline === 0
    ? null
    : round(((value - baseline) / baseline) * 100);

const main = async (): Promise<void> => {
  const options = parseOptions(process.argv.slice(2));
  const root = process.cwd();
  const { runId, runDir } = newRun(root);
  const port = await freePort();
  const base = `http://localhost:${String(port)}`;

  // No sinks and no stream: the numbers are the ring's own cost, not a
  // console's or a collector's.
  const env = { ...process.env };
  for (const key of ["SEFER_LOG", "VITE_SEFER_LOG", "VITE_SEFER_STREAM", "VITE_SEFER_OTLP_URL"])
    delete env[key];
  const child = spawnVite(root, port, env);
  const server = createWriteStream(path.join(runDir, "server.log"));
  child.stdout?.on("data", (chunk: Buffer) => server.write(chunk));
  child.stderr?.on("data", (chunk: Buffer) => server.write(chunk));

  let browser: Browser | undefined;
  try {
    await waitForReady(`${base}/projects`, child);
    browser = await chromium.launch({ headless: !options.headed });
    // Warm Vite's transform cache so the first measured page is not also
    // the one that compiled the app.
    const warm = await browser.newPage();
    await warm.goto(`${base}/projects?fixture=1`);
    await warm.getByRole("button", { name: "Open", exact: true }).waitFor();
    await warm.close();

    const measurements: Measurement[] = [];
    for (let run = 0; run < options.runs; run += 1) {
      // Alternate the order, so drift over the session lands on both levels.
      const order = run % 2 === 0 ? options.levels : [...options.levels].reverse();
      for (const level of order) {
        const measured = await measure(browser, base, level, run, options, runDir);
        measurements.push(measured);
        process.stderr.write(
          `run ${String(run)} ${level}: probe handlers p95 ${String(measured.probe.handlers.p95)}ms (${String(measured.probe.presses)} presses), ` +
            `meter gesture p95 ${String(measured.meter.gesture.p95)}ms, ` +
            `${String(measured.eventsPerMin)} events/min, inserted ${String(measured.inserted)}/${String(measured.typed)}\n`,
        );
      }
    }

    const levels = Object.fromEntries(
      options.levels.map((level) => [level, summarise(measurements, level)]),
    );
    const off = levels.off;
    const all = levels.all;
    const delta =
      off === undefined || all === undefined
        ? undefined
        : {
            handlersP95: percentOver(all.probe.handlers.p95, off.probe.handlers.p95),
            handlersP99: percentOver(all.probe.handlers.p99, off.probe.handlers.p99),
            inputP95: percentOver(all.probe.input.p95, off.probe.input.p95),
            inputP99: percentOver(all.probe.input.p99, off.probe.input.p99),
            paintP95: percentOver(all.probe.paint.p95, off.probe.paint.p95),
            paintP99: percentOver(all.probe.paint.p99, off.probe.paint.p99),
          };
    const summary = {
      runId,
      runDir,
      options: { ...options, headed: undefined },
      levels,
      ...(delta === undefined ? {} : { allVsOffPercent: delta }),
    };
    writeFileSync(
      path.join(runDir, "summary.json"),
      `${JSON.stringify({ ...summary, measurements }, null, 2)}\n`,
    );
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch (error) {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    if (child.exitCode === null) child.kill("SIGTERM");
    server.end();
  }
};

if (import.meta.main) await main();
