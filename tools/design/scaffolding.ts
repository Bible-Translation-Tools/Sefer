/**
 * Where the design surface has been wired into real screens, and is still
 * sitting there.
 *
 * `globalThis.__sefer.design.register(...)` lets a real screen put its own
 * knobs in the floating panel without becoming a design screen and without
 * importing `src/dev` — a global that does not exist in production is not an
 * import, which is what makes it legal where an import would fail
 * `pnpm boundaries`.
 *
 * That is a good pattern for an afternoon and a bad one for a quarter. It
 * cannot break production, because the handle is simply not there; what it
 * does is accumulate. Somebody adds three tweaks to the editor to settle a
 * gutter width, settles it, and the scaffolding stays — inert, invisible, and
 * quietly confusing the next person to read the file.
 *
 * So this lists it rather than banning it:
 *
 *     pnpm design:scaffolding
 *
 * Exit 0 either way. It is a reminder, not a gate — the whole point is that
 * the code is legitimately temporary, and a check that failed the build would
 * just teach people to avoid the pattern instead of tidying up after it.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { lineIndex } from "../oxc/lines.ts";

const NEEDLE = "__sefer";
const DESIGN_CALL = /__sefer\??\.\s*design/u;

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

const listSourceFiles = (directory: string): string[] => {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) found.push(full);
    }
  };
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return found;
  walk(directory);
  return found.sort();
};

const main = (): void => {
  const root = process.cwd();
  const source = path.join(root, "src");
  const dev = path.join(source, "dev");
  const found: string[] = [];

  for (const file of listSourceFiles(source)) {
    // `src/dev` is where the surface lives; references there are the tool
    // itself, not scaffolding left in an application screen.
    if (file.startsWith(dev)) continue;
    const text = readFileSync(file, "utf8");
    if (!text.includes(NEEDLE)) continue;
    const positionOf = lineIndex(text);
    for (const match of text.matchAll(new RegExp(DESIGN_CALL, "gu"))) {
      if (match.index === undefined) continue;
      const { line } = positionOf(match.index);
      found.push(`${path.relative(root, file)}:${String(line)}`);
    }
  }

  if (found.length === 0) {
    process.stdout.write("design: no scaffolding left in application code\n");
    return;
  }
  process.stdout.write(
    `design: ${String(found.length)} place(s) still borrowing the design panel —\n`,
  );
  for (const where of found) process.stdout.write(`  ${where}\n`);
  process.stdout.write("Temporary by design. Remove them when the question is settled.\n");
};

if (import.meta.main) main();
