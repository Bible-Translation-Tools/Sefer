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
  /**
   * The self-contained directory. Named `coreDir` because `src/core` was the
   * first, but the rule set — stay inside, no framework packages, no Node
   * builtins — is exactly what "this folder is liftable somewhere else" means,
   * and `src/dev/annotate` wants precisely that.
   */
  readonly coreDir: string;
  /** What violations call this directory; defaults to "core". */
  readonly label?: string;
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
  const label = options.label ?? "core";
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
          report(`resolves to ${path.relative(pathsBase, resolved)}, outside ${label}`);
        continue;
      }

      if (path.isAbsolute(specifier.value)) {
        if (!isInside(coreDir, path.resolve(specifier.value)))
          report(`absolute path outside ${label}`);
        continue;
      }

      const aliased = resolveAlias(specifier.value, paths, pathsBase);
      if (aliased !== null) {
        if (!isInside(coreDir, aliased))
          report(`alias resolves to ${path.relative(pathsBase, aliased)}, outside ${label}`);
        continue;
      }

      if (isTest && isNodeSpecifier(specifier.value)) continue;

      const bannedPrefix = forbiddenPrefixes.find((prefix) => specifier.value.startsWith(prefix));
      if (bannedPrefix !== undefined) {
        report(`forbidden bare specifier for ${label} (starts with "${bannedPrefix}")`);
        continue;
      }

      const banned = forbidden.find((pattern) => matchesPackage(specifier.value, pattern));
      if (banned !== undefined) report(`forbidden package for ${label} (matches "${banned}")`);
    }
  }

  return violations;
};

export const formatViolation = (violation: BoundaryViolation, root: string): string =>
  `${path.relative(root, violation.file)}:${violation.line}:${violation.column} ${violation.specifier} — ${violation.reason}`;

export interface ReachOptions {
  /** Files under here are read. */
  readonly from: string;
  /** Subtrees of `from` this rule does not apply to. */
  readonly except?: readonly string[];
  /** Directories a file under `from` may not resolve a specifier into. */
  readonly forbidden: readonly string[];
  /**
   * Specifier kinds that are allowed through anyway. `import()` is the one that
   * matters: a dynamic import behind `import.meta.env.DEV` is how a route
   * reaches dev-only code WITHOUT putting it in the production bundle, which is
   * the opposite of the leak this rule exists to catch.
   */
  readonly allowKinds?: readonly string[];
  readonly paths?: Readonly<Record<string, readonly string[]>>;
  readonly pathsBase?: string;
  /** Named in the violation, so the message says which rule was broken. */
  readonly label: string;
}

/**
 * Which directories a subtree is not allowed to REACH INTO — the mirror of
 * `checkCoreBoundary`, which asks what a subtree may not reach OUT to.
 *
 * Two rules use it, and both are about the design surface:
 *
 *   * nothing outside `src/dev` may statically import `src/dev`. The route
 *     gates already keep dev code out of a production bundle; this keeps a
 *     static edge from ever being written in the first place, which is the
 *     architectural claim rather than the bundling one. A dynamic `import()`
 *     from a route is how the gate is spelled, so that stays allowed.
 *   * `src/dev/annotate` may not import `src/core` or `src/app`. The comment
 *     overlay is a DOM tool that happens to live here; keeping it ignorant of
 *     Sefer is the whole reason it can be lifted into another repository as a
 *     folder copy. `src/dev/design`, which holds the screens themselves, is
 *     under no such rule — it is supposed to reach for the real components.
 */
export const checkReach = (options: ReachOptions): BoundaryViolation[] => {
  const from = path.resolve(options.from);
  const except = (options.except ?? []).map((directory) => path.resolve(directory));
  const forbidden = options.forbidden.map((directory) => path.resolve(directory));
  const allowKinds = new Set(options.allowKinds ?? []);
  const paths = options.paths ?? {};
  const pathsBase = path.resolve(options.pathsBase ?? from);
  const violations: BoundaryViolation[] = [];

  for (const file of listSourceFiles(from)) {
    if (except.some((directory) => isInside(directory, file))) continue;
    const source = readFileSync(file, "utf8");
    const positionOf = lineIndex(source);

    for (const specifier of collectSpecifiers(file, source)) {
      if (allowKinds.has(specifier.kind)) continue;

      const resolved = isRelative(specifier.value)
        ? path.resolve(path.dirname(file), withoutQuery(specifier.value))
        : resolveAlias(withoutQuery(specifier.value), paths, pathsBase);
      if (resolved === null) continue;

      const breached = forbidden.find((directory) => isInside(directory, resolved));
      if (breached === undefined) continue;

      const { line, column } = positionOf(specifier.position);
      violations.push({
        file,
        line,
        column,
        specifier: specifier.value,
        reason: `${options.label}: reaches into ${path.relative(pathsBase, breached)} (${specifier.kind})`,
      });
    }
  }

  return violations;
};

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
  const source = path.join(root, "src");
  const dev = path.join(source, "dev");
  const { paths, base } = readTsconfigPaths(path.join(root, "tsconfig.json"));

  const violations = [
    ...checkCoreBoundary({
      coreDir: path.join(source, "core"),
      paths,
      pathsBase: base,
      rawAssetDirs: [path.join(root, "fixtures")],
    }),
    ...checkReach({
      from: source,
      except: [dev],
      forbidden: [dev],
      // The route gates — `/dev/fixture`, `/project/$slug/playground` and the
      // design routes — are exactly this: a dynamic import inside a build-time
      // `import.meta.env` branch, which is what keeps the page out of the
      // production bundle. Statically importing the same module would not.
      allowKinds: ["import()"],
      paths,
      pathsBase: base,
      label: "src/dev is dev-only",
    }),
    // The annotator gets `src/core`'s OWN rule set rather than a weaker one of
    // its own, because "liftable into another repository as a folder copy" and
    // "imports no framework, no Node builtin, and nothing outside itself" are
    // the same sentence. Solid is on the forbidden list, which is the whole
    // point: the overlay is a DOM tool, and the day it imports `solid-js` is
    // the day it stops being droppable into anything that is not this app.
    ...checkCoreBoundary({
      coreDir: path.join(dev, "annotate"),
      label: "the annotator",
      paths,
      pathsBase: base,
    }),
  ];

  if (violations.length === 0) {
    process.stdout.write("boundaries: src/core is clean, src/dev is sealed\n");
    return;
  }

  for (const violation of violations) process.stderr.write(`${formatViolation(violation, root)}\n`);
  process.stderr.write(`boundaries: ${violations.length} violation(s)\n`);
  process.exitCode = 1;
};

if (import.meta.main) main();
