/**
 * Every module specifier a source file names, with the offset it sits at.
 *
 * Its own module because it answers two questions rather than one: the core
 * boundary asks what a file under `src/core` reaches for, and the design
 * boundary asks the same of files elsewhere. The rules differ;
 * the reading does not.
 *
 * Parsed with **oxc-parser** rather than the TypeScript compiler. TypeScript 7
 * is the native port and its package no longer exports the old JS API — `.`
 * resolves to `lib/version.cjs`, and the AST lives behind `unstable/*` — so the
 * one place in this repository that used `typescript` as a LIBRARY had to move
 * somewhere. oxc is where `oxlint` and `oxfmt` already read this source from,
 * it is native, and it hands back byte spans, which the JSX-location transform
 * for the design overlay needs as well. One parser for both tools.
 *
 * Most of the work is done by oxc's module record: `staticImports`,
 * `staticExports` and `dynamicImports` arrive already collected, with spans.
 * Only the two call-shaped specifiers — `require()` and `import.meta.glob()` —
 * need the tree walked, because neither is a module-graph edge oxc records.
 */

import { parseSync } from "oxc-parser";

export interface RawSpecifier {
  readonly value: string;
  /** Offset of the opening quote, as a JS string index into the source. */
  readonly position: number;
  /** How it was written; reported verbatim so a violation says which form it was. */
  readonly kind: string;
}

/**
 * oxc spans are JS string indices, so a plain `slice` is correct even in a file
 * carrying Hebrew or Greek — which, in this repository, is not hypothetical.
 */
const literalAt = (source: string, start: number, end: number): string | null => {
  const text = source.slice(start, end);
  const quote = text[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  if (text.at(-1) !== quote) return null;
  const inner = text.slice(1, -1);
  // A template with a substitution is not a specifier anybody can resolve, and
  // an escape inside a module specifier is not a thing this codebase writes.
  return inner.includes("${") || inner.includes("\\") ? null : inner;
};

/**
 * As much of an oxc node as this walker needs: a `type` tag, maybe a span, and
 * arbitrary other keys it reads by name and otherwise recurses through.
 *
 * Typing the tree properly would mean naming a couple of hundred node
 * interfaces to use three of them, and would break the day oxc adds one. This
 * is the honest shape of what the walker actually knows.
 */
interface AstNode {
  readonly [key: string]: unknown;
}

/**
 * The one narrowing in this file, so every reader below is plain property
 * access rather than another assertion.
 */
const asNode = (value: unknown): AstNode | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  // SAFETY: checked immediately above to be a non-null, non-array object, which
  // is all `AstNode` claims — every property it exposes is `unknown` and is
  // narrowed again at the point it is read.
  return value as AstNode;
};

const typeOf = (node: AstNode | null): string | null =>
  typeof node?.type === "string" ? node.type : null;

const nameOf = (node: AstNode | null): string | null =>
  typeof node?.name === "string" ? node.name : null;

/** `import.meta.glob(...)`, whatever it was assigned to. */
const isImportMetaGlob = (callee: unknown): boolean => {
  const member = asNode(callee);
  if (typeOf(member) !== "MemberExpression") return false;
  const property = asNode(member?.property);
  if (typeOf(property) !== "Identifier" || nameOf(property) !== "glob") return false;
  return typeOf(asNode(member?.object)) === "MetaProperty";
};

const isRequire = (callee: unknown): boolean => {
  const identifier = asNode(callee);
  return typeOf(identifier) === "Identifier" && nameOf(identifier) === "require";
};

interface Spanned {
  readonly start: number;
  readonly end: number;
}

const spanOf = (value: unknown): Spanned | null => {
  const node = asNode(value);
  return typeof node?.start === "number" && typeof node.end === "number"
    ? { start: node.start, end: node.end }
    : null;
};

/**
 * `require()`, `import.meta.glob()` and `import x = require()` — the three that
 * are calls or TypeScript syntax rather than module-graph edges, so oxc does
 * not record them and the tree has to be walked.
 *
 * A generic walk rather than a typed visitor: the shapes wanted here are three
 * out of a couple of hundred node types, and a walk that ignores everything it
 * does not recognise cannot be broken by a node type oxc adds later.
 */
const walkCallSpecifiers = (
  source: string,
  program: unknown,
  push: (value: string, position: number, kind: string) => void,
): void => {
  const seen = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) seen(child);
      return;
    }
    const node = asNode(value);
    if (node === null) return;

    if (typeOf(node) === "CallExpression") {
      const isGlob = isImportMetaGlob(node.callee);
      if (isGlob || isRequire(node.callee)) {
        const kind = isGlob ? "import.meta.glob" : "require()";
        const args = Array.isArray(node.arguments) ? node.arguments : [];
        // `import.meta.glob` takes either one pattern or an array of them, and
        // the array form is how a directory that may not exist is globbed
        // beside one that does — which this repository does in the playground
        // registry, so it is not an edge case here.
        const patterns = args.flatMap((argument: unknown) => {
          const candidate = asNode(argument);
          if (typeOf(candidate) === "ArrayExpression" && Array.isArray(candidate?.elements))
            return candidate.elements;
          return [argument];
        });
        for (const pattern of patterns) {
          const span = spanOf(pattern);
          if (span === null) continue;
          const found = literalAt(source, span.start, span.end);
          if (found !== null) push(found, span.start, kind);
        }
      }
    } else if (typeOf(node) === "TSImportEqualsDeclaration") {
      const span = spanOf(asNode(node.moduleReference)?.expression);
      if (span !== null) {
        const found = literalAt(source, span.start, span.end);
        if (found !== null) push(found, span.start, "import = require");
      }
    }

    for (const key of Object.keys(node)) {
      if (key === "type") continue;
      seen(node[key]);
    }
  };

  seen(program);
};

export const collectSpecifiers = (fileName: string, source: string): RawSpecifier[] => {
  const parsed = parseSync(fileName, source, {
    sourceType: "module",
    lang: fileName.endsWith("x") ? "tsx" : "ts",
  });

  const specifiers: RawSpecifier[] = [];
  const push = (value: string, position: number, kind: string): void => {
    specifiers.push({ value, position, kind });
  };

  for (const entry of parsed.module.staticImports) {
    // A side-effect import has no entries and is not a type import; a clause
    // whose every binding is a type is the `import type { … }` form, and one
    // with a mix is an ordinary import that happens to name a type.
    const typeOnly = entry.entries.length > 0 && entry.entries.every((one) => one.isType);
    push(entry.moduleRequest.value, entry.moduleRequest.start, typeOnly ? "import type" : "import");
  }

  for (const statement of parsed.module.staticExports) {
    for (const entry of statement.entries) {
      const request = entry.moduleRequest;
      if (request === null || request === undefined) continue;
      push(request.value, request.start, entry.isType ? "export type … from" : "export … from");
    }
  }

  for (const dynamic of parsed.module.dynamicImports) {
    const value = literalAt(source, dynamic.moduleRequest.start, dynamic.moduleRequest.end);
    // `import(someVariable)` is not a specifier this checker can judge, and
    // pretending otherwise would report a violation nobody can act on.
    if (value !== null) push(value, dynamic.moduleRequest.start, "import()");
  }

  walkCallSpecifiers(source, parsed.program, push);

  return specifiers.sort((left, right) => left.position - right.position);
};

/**
 * Re-exported so `check.ts` keeps one import. The implementation moved to
 * `tools/oxc/lines.ts` when the JSX-location transform wanted it too.
 */
export { lineIndex } from "../oxc/lines.ts";
