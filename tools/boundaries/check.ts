import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { collectSpecifiers, lineIndex } from "./specifiers.ts";

export interface BoundaryViolation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly specifier: string;
  readonly reason: string;
}

export interface BoundaryOptions {
  readonly coreDir: string;
  readonly paths?: Readonly<Record<string, readonly string[]>>;
  readonly pathsBase?: string;
  readonly forbiddenPackages?: readonly string[];
  readonly forbiddenPrefixes?: readonly string[];
  readonly rawAssetDirs?: readonly string[];
  /**
   * Directories of vendored, host-neutral code core may import by relative
   * path. Empty since 2026-09-18: the Galley engine was the only one, and it
   * is a tagged git dependency now, so core reaches it by PACKAGE NAME like
   * any other — which the bare-specifier rule below already allows. Kept
   * because the next vendored thing will want it and the rule is three lines.
   * Vendored code is checked
   * by the hash in its manifest, not by this walker.
   */
  readonly vendorDirs?: readonly string[];
}

export const DEFAULT_FORBIDDEN_PACKAGES: readonly string[] = [
  "solid-js",
  "@solidjs/*",
  "@tanstack/*",
  "@tauri-apps/*",
  "isomorphic-git",
  "@codemirror/*",
  "@effect/platform-node*",
];

// A bare-specifier prefix, not a package name: "node:fs" and "node:fs/promises"
// are both the Node builtin namespace, which no package glob spells.
export const DEFAULT_FORBIDDEN_PREFIXES: readonly string[] = ["node:"];

// Core policy must run under a browser as well as under Node, but a core *test*
// is Node's own program: it may reach for the builtins and the Node platform
// layer to set up the fixtures the policy runs against.
const TEST_FILE = /\.test\.tsx?$/;

const NODE_ONLY: readonly string[] = ["node:", "@effect/platform-node"];

const isNodeSpecifier = (specifier: string): boolean =>
  NODE_ONLY.some((prefix) => specifier.startsWith(prefix));

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

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

const RAW_QUERY = /\?raw(?:&|$)/;

const withoutQuery = (specifier: string): string => specifier.split("?")[0] ?? specifier;

const isRelative = (specifier: string): boolean =>
  specifier.startsWith("./") || specifier.startsWith("../") || specifier === "..";

const isInside = (directory: string, target: string): boolean => {
  const relative = path.relative(directory, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const matchesPackage = (specifier: string, pattern: string): boolean => {
  if (pattern.endsWith("*")) return specifier.startsWith(pattern.slice(0, -1));
  return specifier === pattern || specifier.startsWith(`${pattern}/`);
};

const resolveAlias = (
  specifier: string,
  paths: Readonly<Record<string, readonly string[]>>,
  base: string,
): string | null => {
  for (const [pattern, targets] of Object.entries(paths)) {
    const target = targets[0];
    if (target === undefined) continue;
    const starIndex = pattern.indexOf("*");
    if (starIndex === -1) {
      if (specifier === pattern) return path.resolve(base, target);
      continue;
    }
    const prefix = pattern.slice(0, starIndex);
    const suffix = pattern.slice(starIndex + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    const middle = specifier.slice(prefix.length, specifier.length - suffix.length);
    return path.resolve(base, target.replace("*", middle));
  }
  return null;
};

export const checkCoreBoundary = (options: BoundaryOptions): BoundaryViolation[] => {
  const coreDir = path.resolve(options.coreDir);
  const paths = options.paths ?? {};
  const pathsBase = path.resolve(options.pathsBase ?? path.dirname(coreDir));
  const forbidden = options.forbiddenPackages ?? DEFAULT_FORBIDDEN_PACKAGES;
  const forbiddenPrefixes = options.forbiddenPrefixes ?? DEFAULT_FORBIDDEN_PREFIXES;
  const rawAssetDirs = (options.rawAssetDirs ?? []).map((directory) => path.resolve(directory));
  const vendorDirs = (options.vendorDirs ?? []).map((directory) => path.resolve(directory));
  const violations: BoundaryViolation[] = [];

  for (const file of listSourceFiles(coreDir)) {
    const source = readFileSync(file, "utf8");
    const positionOf = lineIndex(source);
    const isTest = TEST_FILE.test(file);

    for (const specifier of collectSpecifiers(file, source)) {
      const { line, column } = positionOf(specifier.position);
      const report = (reason: string): void => {
        violations.push({
          file,
          line,
          column,
          specifier: specifier.value,
          reason: `${reason} (${specifier.kind})`,
        });
      };

      if (isRelative(specifier.value)) {
        const resolved = path.resolve(path.dirname(file), withoutQuery(specifier.value));
        if (
          RAW_QUERY.test(specifier.value) &&
          rawAssetDirs.some((directory) => isInside(directory, resolved))
        )
          continue;
        if (vendorDirs.some((directory) => isInside(directory, resolved))) continue;
        // A core test is Node's own program: it may reach outside core for the
        // Node platform layers (filesystem, engine bytes) it builds fixtures with.
        if (isTest) continue;
        if (!isInside(coreDir, resolved))
          report(`resolves to ${path.relative(pathsBase, resolved)}, outside core`);
        continue;
      }

      if (path.isAbsolute(specifier.value)) {
        if (!isInside(coreDir, path.resolve(specifier.value))) report("absolute path outside core");
        continue;
      }

      const aliased = resolveAlias(specifier.value, paths, pathsBase);
      if (aliased !== null) {
        if (!isInside(coreDir, aliased))
          report(`alias resolves to ${path.relative(pathsBase, aliased)}, outside core`);
        continue;
      }

      if (isTest && isNodeSpecifier(specifier.value)) continue;

      const bannedPrefix = forbiddenPrefixes.find((prefix) => specifier.value.startsWith(prefix));
      if (bannedPrefix !== undefined) {
        report(`forbidden bare specifier for core (starts with "${bannedPrefix}")`);
        continue;
      }

      const banned = forbidden.find((pattern) => matchesPackage(specifier.value, pattern));
      if (banned !== undefined) report(`forbidden package for core (matches "${banned}")`);
    }
  }

  return violations;
};

export const formatViolation = (violation: BoundaryViolation, root: string): string =>
  `${path.relative(root, violation.file)}:${violation.line}:${violation.column} ${violation.specifier} — ${violation.reason}`;

/**
 * A tsconfig is JSON with comments, and `ts.readConfigFile` used to absorb
 * that. TypeScript 7 does not export it, so this strips what a tsconfig is
 * allowed to carry beyond JSON — line and block comments, and trailing commas
 * — while leaving anything inside a string alone. A path that happens to
 * contain `//` is the case a naive strip gets wrong, and this repository's own
 * config would not catch the mistake.
 */
const stripJsonc = (text: string): string => {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (inString) {
      out += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      out += character;
      continue;
    }
    const next = text[index + 1];
    if (character === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      out += "\n";
      continue;
    }
    if (character === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }
    out += character;
  }
  // Trailing commas, now that no comma inside a string can be mistaken for one.
  return out.replace(/,(\s*[}\]])/g, "$1");
};

export const readTsconfigPaths = (
  tsconfigPath: string,
): { paths: Record<string, readonly string[]>; base: string } => {
  const base = path.dirname(path.resolve(tsconfigPath));
  const parsed: unknown = JSON.parse(stripJsonc(readFileSync(tsconfigPath, "utf8")));
  // SAFETY: two optional fields read off a config file this repository owns.
  // A tsconfig that does not have them is the ordinary case, not an error.
  const config = parsed as {
    compilerOptions?: { paths?: Record<string, readonly string[]>; baseUrl?: string };
  };
  const options = config.compilerOptions ?? {};
  const paths = options.paths ?? {};
  return { paths, base: path.resolve(base, options.baseUrl ?? ".") };
};

const main = (): void => {
  const root = process.cwd();
  const { paths, base } = readTsconfigPaths(path.join(root, "tsconfig.json"));
  const violations = checkCoreBoundary({
    coreDir: path.join(root, "src", "core"),
    paths,
    pathsBase: base,
    rawAssetDirs: [path.join(root, "fixtures")],
  });

  if (violations.length === 0) {
    process.stdout.write("boundaries: src/core is clean\n");
    return;
  }

  for (const violation of violations) process.stderr.write(`${formatViolation(violation, root)}\n`);
  process.stderr.write(`boundaries: ${violations.length} violation(s) in src/core\n`);
  process.exitCode = 1;
};

if (import.meta.main) main();
