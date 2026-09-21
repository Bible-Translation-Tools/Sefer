/**
 * Stamps every intrinsic JSX element with the file, line and column it was
 * written at, so a click in the running application can name a place in the
 * source.
 *
 * This is the piece that decides whether the design overlay is worth having.
 * A comment that says `.flex.items-center.gap-2` sends whoever reads it
 * grepping; a comment that says `src/app/ui/review/DecisionRow.tsx:42` is
 * something an agent can act on in one step.
 *
 * Nothing upstream provides it. Checked against what is installed:
 * `@solidjs/babel-plugin@2.0.0-rc.6` contains no occurrence of "location" at
 * all; `@solidjs/vite-plugin@3.0.0-next.38` exposes no option for it;
 * `@tanstack/router-plugin@1.168.35` transforms routes, code splitting and
 * HMR and stamps nothing (its Devtools' "open in editor" is route-FILE
 * granularity, from the generator's own `filePath`); and the
 * `@solid-devtools/debugger` sitting in the store reads `owner.sdtLocation`,
 * which a transform that is not installed sets, and which is component-level
 * regardless. React gets this free from fiber `_debugSource`. Solid does not.
 *
 * ## How
 *
 * `enforce: "pre"`, because the Solid transform erases JSX into template
 * strings and `setAttribute` calls — after it there is no JSX left to stamp.
 *
 * The transform is a TEXT INSERTION, not a re-print: parse with oxc, find each
 * opening element's name span, and splice ` data-loc="…"` in after it with
 * `magic-string`. No code generation, so nothing about the file can be
 * changed by a bug in this plugin except the presence of one attribute — and
 * the sourcemap comes free.
 *
 * Solid hoists static attributes into the template's HTML string, so a stamped
 * element costs nothing at runtime beyond the bytes.
 *
 * ## Only intrinsic elements
 *
 * `<div>` yes, `<Card>` no. Stamping a component passes `data-loc` as a PROP,
 * and most components never spread unknown props onto a DOM node, so it would
 * silently vanish — worse, it would vanish inconsistently, which is the kind
 * of thing somebody debugs for an hour. A click resolves to the nearest
 * ancestor carrying `data-loc`, which lands on the real DOM element the
 * component rendered. That is the wanted answer anyway: the reader wants the
 * markup, not the call site.
 *
 * ## Dev and design builds only
 *
 * Production never sees this, so the attribute cannot reach a real release.
 */

import MagicString from "magic-string";
import { parseSync } from "oxc-parser";
import type { Plugin } from "vite";

import { lineIndex } from "../oxc/lines.ts";

/** What the overlay reads, and what a pasted comment prints. */
export const LOCATION_ATTRIBUTE = "data-loc";

interface AstNode {
  readonly [key: string]: unknown;
}

const asNode = (value: unknown): AstNode | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  // SAFETY: checked immediately above to be a non-null, non-array object, which
  // is all `AstNode` claims — every property is `unknown` and is narrowed again
  // where it is read.
  return value as AstNode;
};

/**
 * An intrinsic element is a plain `JSXIdentifier` starting with a lower-case
 * letter. `<Foo.Bar>` parses as a `JSXMemberExpression` and is a component
 * whatever its casing; `<Foo>` is a component by the JSX casing rule. Anything
 * this cannot positively identify as intrinsic is left alone.
 */
const intrinsicName = (node: AstNode): { name: string; end: number } | null => {
  const name = asNode(node.name);
  if (name === null || name.type !== "JSXIdentifier") return null;
  if (typeof name.name !== "string" || typeof name.end !== "number") return null;
  const first = name.name[0] ?? "";
  if (first !== first.toLowerCase() || first === "") return null;
  return { name: name.name, end: name.end };
};

/** Does this element already say where it is? Then leave it as written. */
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
  /**
   * Whether to run at all. The caller decides, because "is this a build that
   * carries the design surface" is a question `vite.config.ts` can answer and
   * this file should not have an opinion about.
   */
  readonly enabled: boolean;
  /** Prefix stripped from the reported path, so it reads `src/app/…`. */
  readonly root: string;
}

export const jsxLocation = (options: JsxLocationOptions): Plugin => ({
  name: "sefer:jsx-location",
  enforce: "pre",
  apply: () => options.enabled,

  transform(code, id) {
    if (!options.enabled) return null;
    // `?` guards a Vite query suffix (`?raw`, `?url`, HMR's `?t=`).
    const file = id.split("?")[0] ?? id;
    if (!file.endsWith(".tsx") && !file.endsWith(".jsx")) return null;
    if (file.includes("/node_modules/")) return null;

    const parsed = parseSync(file, code, { sourceType: "module", lang: "tsx" });
    // A file oxc could not parse is one Vite is about to complain about far
    // more usefully than this plugin could. Leave it exactly as written.
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
