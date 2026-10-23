import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const SURFACES = [
  { name: "/design", sentinel: "__sefer_design_surface__" },
  { name: "/project/$slug/playground", sentinel: "__sefer_playground_surface__" },
  { name: "/playground/history-diff", sentinel: "__sefer_history_diff_surface__" },
] as const;

const DIST = "dist";

const build = (mode: string): void => {
  rmSync(DIST, { recursive: true, force: true });
  execFileSync("pnpm", ["exec", "vite", "build", "--mode", mode], {
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf8",
  });
};

const containsSentinel = (directory: string, sentinel: string): string | null => {
  const walk = (current: string): string | null => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        const found = walk(full);
        if (found !== null) return found;
        continue;
      }
      if (entry.name === "manifest.json") continue;
      if (!entry.isFile() || statSync(full).size === 0) continue;
      if (readFileSync(full, "utf8").includes(sentinel)) return full;
    }
    return null;
  };
  return walk(directory);
};

const main = (): void => {
  const failures: string[] = [];

  build("production");
  for (const surface of SURFACES) {
    const leaked = containsSentinel(DIST, surface.sentinel);
    if (leaked === null) process.stdout.write(`production: ${surface.name} absent ✓\n`);
    else failures.push(`production build ships ${surface.name}: ${leaked}`);
  }

  build("dev");
  for (const surface of SURFACES) {
    const present = containsSentinel(DIST, surface.sentinel);
    if (present === null) {
      failures.push(`dev build does NOT ship ${surface.name} — its gate is off in both modes`);
    } else {
      process.stdout.write(`dev: ${surface.name} present ✓\n`);
    }
  }

  rmSync(DIST, { recursive: true, force: true });

  if (failures.length === 0) {
    process.stdout.write("verify:design: the gate holds in both directions (dist removed)\n");
    return;
  }
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exitCode = 1;
};

if (import.meta.main) main();
