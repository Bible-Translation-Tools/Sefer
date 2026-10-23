import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { lineIndex } from "../oxc/lines.ts";
import { listSourceFiles } from "../oxc/sourceFiles.ts";

const NEEDLE = "__sefer";
const DESIGN_CALL = /__sefer\??\.\s*design/u;

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

const main = (): void => {
  const root = process.cwd();
  const source = path.join(root, "src");
  const dev = path.join(source, "dev");
  const found: string[] = [];

  for (const file of listSourceFiles(source, SOURCE_EXTENSIONS)) {
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
