import MagicString from "magic-string";
import { parseSync } from "oxc-parser";
import type { Plugin } from "vite";

import { lineIndex } from "../oxc/lines.ts";

const LOCATION_ATTRIBUTE = "data-loc";

interface AstNode {
  readonly [key: string]: unknown;
}

const asNode = (value: unknown): AstNode | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  // SAFETY: checked immediately above to be a non-null, non-array object, which is all `AstNode` claims — every property is `unknown` and is narrowed again where it is read.
  return value as AstNode;
};

const intrinsicName = (node: AstNode): { name: string; end: number } | null => {
  const name = asNode(node.name);
  if (name === null || name.type !== "JSXIdentifier") return null;
  if (typeof name.name !== "string" || typeof name.end !== "number") return null;
  const first = name.name[0] ?? "";
  if (first !== first.toLowerCase() || first === "") return null;
  return { name: name.name, end: name.end };
};

const alreadyStamped = (node: AstNode): boolean => {
  const attributes = Array.isArray(node.attributes) ? node.attributes : [];
  return attributes.some((attribute: unknown) => {
    const name = asNode(asNode(attribute)?.name);
    return name?.type === "JSXIdentifier" && name.name === LOCATION_ATTRIBUTE;
  });
};

const collectOpeningElements = (program: unknown): AstNode[] => {
  const found: AstNode[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    const node = asNode(value);
    if (node === null) return;
    if (node.type === "JSXOpeningElement") found.push(node);
    for (const key of Object.keys(node)) {
      if (key === "type") continue;
      walk(node[key]);
    }
  };
  walk(program);
  return found;
};

export interface JsxLocationOptions {
  readonly enabled: boolean;
  readonly root: string;
}

export const jsxLocation = (options: JsxLocationOptions): Plugin => ({
  name: "sefer:jsx-location",
  enforce: "pre",
  apply: () => options.enabled,

  transform(code, id) {
    if (!options.enabled) return null;
    const file = id.split("?")[0] ?? id;
    if (!file.endsWith(".tsx") && !file.endsWith(".jsx")) return null;
    if (file.includes("/node_modules/")) return null;

    const parsed = parseSync(file, code, { sourceType: "module", lang: "tsx" });
    if (parsed.errors.length > 0) return null;

    const elements = collectOpeningElements(parsed.program);
    if (elements.length === 0) return null;

    const relative = file.startsWith(options.root) ? file.slice(options.root.length) : file;
    const path = relative.replace(/^\/+/u, "");
    const positionOf = lineIndex(code);
    const edited = new MagicString(code);
    let stamped = 0;

    for (const element of elements) {
      if (alreadyStamped(element)) continue;
      const intrinsic = intrinsicName(element);
      if (intrinsic === null) continue;
      const start = typeof element.start === "number" ? element.start : null;
      if (start === null) continue;
      const { line, column } = positionOf(start);
      edited.appendLeft(intrinsic.end, ` ${LOCATION_ATTRIBUTE}="${path}:${line}:${column}"`);
      stamped += 1;
    }

    if (stamped === 0) return null;
    return { code: edited.toString(), map: edited.generateMap({ hires: true, source: id }) };
  },
});
