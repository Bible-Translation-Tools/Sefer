import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import ts from "typescript";

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
  readonly rawAssetDirs?: readonly string[];
}

export const DEFAULT_FORBIDDEN_PACKAGES: readonly string[] = [
  "solid-js",
  "@solidjs/*",
  "@tanstack/*",
  "@tauri-apps/*",
  "isomorphic-git",
  "@codemirror/*",
];

interface RawSpecifier {
  readonly value: string;
  readonly position: number;
  readonly kind: string;
}

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

const stringLiteralValue = (node: ts.Node): string | null =>
  ts.isStringLiteralLike(node) ? node.text : null;

const isImportMetaGlob = (node: ts.CallExpression): boolean =>
  ts.isPropertyAccessExpression(node.expression) &&
  node.expression.name.text === "glob" &&
  ts.isMetaProperty(node.expression.expression) &&
  node.expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword;

const isRequireCall = (node: ts.CallExpression): boolean =>
  ts.isIdentifier(node.expression) && node.expression.text === "require";

const collectSpecifiers = (source: ts.SourceFile): RawSpecifier[] => {
  const specifiers: RawSpecifier[] = [];
  const push = (node: ts.Node | undefined, kind: string): void => {
    if (node === undefined) return;
    const value = stringLiteralValue(node);
    if (value !== null) specifiers.push({ value, position: node.getStart(source), kind });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      push(node.moduleSpecifier, node.importClause?.isTypeOnly === true ? "import type" : "import");
    } else if (ts.isExportDeclaration(node)) {
      push(node.moduleSpecifier, node.isTypeOnly ? "export type … from" : "export … from");
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      push(node.moduleReference.expression, "import = require");
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) push(node.arguments[0], "import()");
      else if (isRequireCall(node)) push(node.arguments[0], "require()");
      else if (isImportMetaGlob(node)) {
        for (const argument of node.arguments) {
          if (ts.isArrayLiteralExpression(argument))
            for (const element of argument.elements) push(element, "import.meta.glob");
          else push(argument, "import.meta.glob");
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return specifiers;
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
  if (pattern.endsWith("/*")) return specifier.startsWith(pattern.slice(0, -1));
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
  const rawAssetDirs = (options.rawAssetDirs ?? []).map((directory) => path.resolve(directory));
  const violations: BoundaryViolation[] = [];

  for (const file of listSourceFiles(coreDir)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    for (const specifier of collectSpecifiers(source)) {
      const { line, character } = source.getLineAndCharacterOfPosition(specifier.position);
      const report = (reason: string): void => {
        violations.push({
          file,
          line: line + 1,
          column: character + 1,
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

      const banned = forbidden.find((pattern) => matchesPackage(specifier.value, pattern));
      if (banned !== undefined) report(`forbidden package for core (matches "${banned}")`);
    }
  }

  return violations;
};

export const formatViolation = (violation: BoundaryViolation, root: string): string =>
  `${path.relative(root, violation.file)}:${violation.line}:${violation.column} ${violation.specifier} — ${violation.reason}`;

export const readTsconfigPaths = (
  tsconfigPath: string,
): { paths: Record<string, readonly string[]>; base: string } => {
  const base = path.dirname(path.resolve(tsconfigPath));
  const parsed = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const options = parsed.config?.compilerOptions ?? {};
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
