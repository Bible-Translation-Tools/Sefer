import { parseSync } from "oxc-parser";

export interface RawSpecifier {
  readonly value: string;
  readonly position: number;
  readonly kind: string;
}

const literalAt = (source: string, start: number, end: number): string | null => {
  const text = source.slice(start, end);
  const quote = text[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  if (text.at(-1) !== quote) return null;
  const inner = text.slice(1, -1);
  return inner.includes("${") || inner.includes("\\") ? null : inner;
};

interface AstNode {
  readonly [key: string]: unknown;
}

const asNode = (value: unknown): AstNode | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  // SAFETY: checked immediately above to be a non-null, non-array object, which is all `AstNode` claims — every property it exposes is `unknown` and is narrowed again at the point it is read.
  return value as AstNode;
};

const typeOf = (node: AstNode | null): string | null =>
  typeof node?.type === "string" ? node.type : null;

const nameOf = (node: AstNode | null): string | null =>
  typeof node?.name === "string" ? node.name : null;

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
    if (value !== null) push(value, dynamic.moduleRequest.start, "import()");
  }

  walkCallSpecifiers(source, parsed.program, push);

  return specifiers.sort((left, right) => left.position - right.position);
};

export { lineIndex } from "../oxc/lines.ts";
