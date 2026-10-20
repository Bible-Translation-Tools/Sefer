import { readdirSync, statSync } from "node:fs";
import path from "node:path";

export const listSourceFiles = (directory: string, extensions: ReadonlySet<string>): string[] => {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isFile() && extensions.has(path.extname(entry.name))) found.push(full);
    }
  };
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return found;
  walk(directory);
  return found.sort();
};
