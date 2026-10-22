import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * The old `t("…")` door only shrinks. New copy is a Paraglide message,
 * `m.some_id(…)` from `src/app/messages/en.json`; a screen moving to messages
 * lowers the count. This counts `t(` calls in the app and fails if there are
 * more than `tools/quality/legacy-copy.json` allows. When there are fewer, it
 * writes the lower number, so the ceiling follows the work down (the
 * pre-commit hook stages it).
 */

const ROOT = process.cwd();
const BASELINE = path.join(ROOT, "tools", "quality", "legacy-copy.json");
const SCANNED = ["src", path.join("packages", "editor", "src")];
const CALL = /(?<![\w.$])t\(/g;

const sources = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return name === "paraglide" ? [] : sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });

const counted = SCANNED.flatMap((directory) => sources(path.join(ROOT, directory))).reduce(
  (total, file) => total + (readFileSync(file, "utf8").match(CALL)?.length ?? 0),
  0,
);

// SAFETY: the file this script writes, `{ "calls": number }`.
const allowed = (JSON.parse(readFileSync(BASELINE, "utf8")) as { calls: number }).calls;

if (counted > allowed) {
  console.error(
    `legacy-copy: ${counted} t() calls, ${counted - allowed} more than the ${allowed} allowed. New copy is a message: add it to src/app/messages/en.json and call m.<id>().`,
  );
  process.exit(1);
}
if (counted < allowed) writeFileSync(BASELINE, `${JSON.stringify({ calls: counted })}\n`);
console.log(`legacy-copy: ${counted} t() calls (ceiling ${Math.min(counted, allowed)})`);
