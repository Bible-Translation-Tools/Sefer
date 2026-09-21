/**
 * Proves, against real builds, that the design surface ships in exactly one of
 * the two production modes.
 *
 * The claim every gated route in this repository makes — "the page module is
 * imported only inside the branch, so a production build contains none of it"
 * — is a claim about what a bundler decides to do, and bundlers change their
 * minds. This one already caught a real leak: when the gate was an exported
 * `DESIGN_ENABLED` constant rather than a `define`, the gate itself folded
 * correctly and the route compiled down to `throw notFound()`, but rolldown
 * still emitted the design page as an orphaned chunk. Unreachable, and shipped
 * anyway. A comment would never have noticed.
 *
 * Two builds into throwaway directories, then one question of each: does any
 * emitted asset contain the sentinel?
 *
 *   pnpm verify:design
 *
 * Slow enough (two full builds) to stay out of `pnpm check` and fast enough to
 * run before touching the gate.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * A string that exists in the design surface and nowhere else. It lives in
 * `DesignHome.tsx` next to a note saying so, because a sentinel somebody
 * deletes while tidying is worse than no sentinel at all.
 */
const SENTINEL = "__sefer_design_surface__";

/**
 * Always `dist`. The turnkey Solid Start plugin builds its own client and
 * server environments and ignores `--outDir`, so there is no way to put the
 * two builds side by side — they are run one after the other instead, and
 * `dist` is left holding whichever ran last. Say so rather than leaving
 * somebody to discover their `dist` is a design build.
 */
const DIST = "dist";

const build = (mode: string): void => {
  rmSync(DIST, { recursive: true, force: true });
  execFileSync("pnpm", ["exec", "vite", "build", "--mode", mode], {
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf8",
  });
};

const containsSentinel = (directory: string): string | null => {
  const walk = (current: string): string | null => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        const found = walk(full);
        if (found !== null) return found;
        continue;
      }
      // The Vite manifest names chunks; it is build metadata rather than
      // shipped code, and matching it would report a leak that is not one.
      if (entry.name === "manifest.json") continue;
      if (!entry.isFile() || statSync(full).size === 0) continue;
      if (readFileSync(full, "utf8").includes(SENTINEL)) return full;
    }
    return null;
  };
  return walk(directory);
};

const main = (): void => {
  const failures: string[] = [];

  build("production");
  const leaked = containsSentinel(DIST);
  if (leaked === null) process.stdout.write("production: design surface absent ✓\n");
  else failures.push(`production build ships the design surface: ${leaked}`);

  build("design");
  const present = containsSentinel(DIST);
  if (present === null) {
    failures.push("design build does NOT ship the design surface — the gate is off in both modes");
  } else {
    process.stdout.write("design: design surface present ✓\n");
  }

  // Left as the design build, which is not what anybody wants to deploy.
  rmSync(DIST, { recursive: true, force: true });

  if (failures.length === 0) {
    process.stdout.write("verify:design: the gate holds in both directions (dist removed)\n");
    return;
  }
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exitCode = 1;
};

if (import.meta.main) main();
