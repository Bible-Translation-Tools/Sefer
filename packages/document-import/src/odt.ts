import { points, roleOf } from "./model.ts";
import type { Comment, Formatting, Inline, Note, Paragraph, Reading } from "./model.ts";
import { childElement, childElements, descendants, openPackage } from "./xml.ts";
import type { ParseXml, XmlElement } from "./xml.ts";

// An OpenDocument text: content.xml holds the body and its automatic styles,
// styles.xml the named ones. Notes and comments sit inline where they are anchored.
export function readOdtWith(bytes: Uint8Array, parse: ParseXml): Reading {
  const part = openPackage(bytes, parse);
  const content = part.xml("content.xml");
  if (!content) throw new Error("Not an .odt: missing content.xml");
  const text = descendants(content, "office:text")[0];
  if (!text) throw new Error("Not a text document: content.xml has no office:text");

  const ctx: Ctx = {
    styles: readStyles([part.xml("styles.xml"), content]),
    paragraphs: [],
    notes: new Map(),
    comments: new Map(),
    trackedChanges: descendants(content, "text:changed-region").length,
  };
  walkBlocks(text, ctx, { list: false, table: false });
  return {
    format: "odt",
    paragraphs: ctx.paragraphs,
    notes: ctx.notes,
    comments: ctx.comments,
    trackedChanges: ctx.trackedChanges,
  };
}

interface Ctx {
  styles: Styles;
  paragraphs: Paragraph[];
  notes: Map<string, Note>;
  comments: Map<string, Comment>;
  trackedChanges: number;
}

interface Where {
  list: boolean;
  table: boolean;
}

function walkBlocks(el: XmlElement, ctx: Ctx, where: Where) {
  for (const child of childElements(el)) {
    switch (child.nodeName) {
      case "text:p":
      case "text:h":
        ctx.paragraphs.push(paragraph(child, ctx, where));
        break;
      case "text:list":
        walkBlocks(child, ctx, { ...where, list: true });
        break;
      case "table:table":
        walkBlocks(child, ctx, { ...where, table: true });
        break;
      case "text:tracked-changes": // the deleted text of tracked changes
      case "text:sequence-decls":
      case "text:variable-decls":
      case "office:forms":
        break;
      default: // list items, rows, cells, sections
        walkBlocks(child, ctx, where);
    }
  }
}

function paragraph(p: XmlElement, ctx: Ctx, where: Where): Paragraph {
  const style = ctx.styles.resolve(p.getAttribute("text:style-name"));
  const outline =
    p.nodeName === "text:h"
      ? Number(p.getAttribute("text:outline-level") ?? style.outline ?? 1)
      : null;
  const { role, level } = roleOf(style.name ?? null, outline);
  const inlines: Inline[] = [];
  walkInline(p, ctx, format(style), inlines);
  return {
    style: style.name ?? null,
    role,
    level,
    indent: style.indent ?? 0,
    align: style.align ?? null,
    list: where.list,
    table: where.table,
    inlines,
  };
}

function walkInline(el: XmlElement, ctx: Ctx, current: Formatting, out: Inline[]) {
  const text = (value: string) => {
    const last = out.at(-1);
    if (
      last?.kind === "text" &&
      last.superscript === current.superscript &&
      last.italic === current.italic &&
      last.bold === current.bold
    )
      last.text += value;
    else out.push({ kind: "text", text: value, ...current });
  };
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i];
    if (node.nodeType === 3) {
      // ODF collapses runs of whitespace; explicit spaces are <text:s/>.
      text((node.nodeValue ?? "").replace(/\s+/g, " "));
      continue;
    }
    if (node.nodeType !== 1) continue;
    // SAFETY: nodeType 1 is an element.
    const child = node as XmlElement;
    switch (child.nodeName) {
      case "text:s":
        text(" ".repeat(Number(child.getAttribute("text:c") ?? 1)));
        break;
      case "text:tab":
        text("\t");
        break;
      case "text:line-break":
        out.push({ kind: "break" });
        break;
      case "text:span": {
        const own = ctx.styles.resolve(child.getAttribute("text:style-name"));
        walkInline(child, ctx, { ...current, ...defined(format(own, true)) }, out);
        break;
      }
      case "text:note":
        out.push({ kind: "note", id: note(child, ctx) });
        break;
      case "office:annotation":
        annotation(child, ctx, out);
        break;
      case "office:annotation-end":
        out.push({ kind: "commentEnd", id: child.getAttribute("office:name")! });
        break;
      case "text:change-start":
      case "text:change-end":
      case "text:change":
      case "text:bookmark":
      case "text:bookmark-start":
      case "text:bookmark-end":
      case "text:soft-page-break":
      case "text:reference-mark":
        break;
      default: // links, fields, meta
        walkInline(child, ctx, current, out);
    }
  }
}

function note(el: XmlElement, ctx: Ctx): string {
  const kind = el.getAttribute("text:note-class") === "endnote" ? "endnote" : "footnote";
  const id = `${kind === "footnote" ? "fn" : "en"}:${el.getAttribute("text:id") ?? ctx.notes.size}`;
  const body = childElement(el, "text:note-body");
  const text = body
    ? childElements(body, "text:p")
        .map((p) => p.textContent ?? "")
        .join(" ")
    : "";
  ctx.notes.set(id, { id, kind, text: text.replace(/\s+/g, " ").trim() });
  return id;
}

function annotation(el: XmlElement, ctx: Ctx, out: Inline[]) {
  const name = el.getAttribute("office:name");
  const id = name ?? `odt-${ctx.comments.size}`;
  ctx.comments.set(id, {
    id,
    author: descendants(el, "dc:creator")[0]?.textContent ?? "",
    date: descendants(el, "dc:date")[0]?.textContent ?? null,
    text: childElements(el, "text:p")
      .map((p) => p.textContent)
      .join("\n")
      .trim(),
    parentId: null,
    resolved: el.getAttribute("loext:resolved") === "true",
  });
  out.push({ kind: "commentStart", id });
  // An unnamed annotation marks a point, not a range.
  if (!name) out.push({ kind: "commentEnd", id });
}

interface StyleProps {
  name?: string;
  parent?: string;
  indent?: number;
  align?: Paragraph["align"];
  outline?: number;
  italic?: boolean;
  bold?: boolean;
  superscript?: boolean;
}

interface Styles {
  resolve(name: string | null): StyleProps;
}

// Styles inherit through style:parent-style-name. Automatic styles (content.xml)
// are anonymous ("P3", "T1"), so the name a person chose comes from the nearest
// named ancestor.
function readStyles(roots: (XmlElement | null)[]): Styles {
  const byName = new Map<string, StyleProps & { automatic: boolean }>();
  for (const root of roots) {
    if (!root) continue;
    for (const style of descendants(root, "style:style")) {
      const name = style.getAttribute("style:name");
      if (!name) continue;
      const paragraphProps = childElement(style, "style:paragraph-properties");
      const textProps = childElement(style, "style:text-properties");
      const props: StyleProps & { automatic: boolean } = {
        automatic: style.parentNode?.nodeName === "office:automatic-styles",
        name: style.getAttribute("style:display-name") ?? name,
        parent: style.getAttribute("style:parent-style-name") ?? undefined,
      };
      const indent = points(paragraphProps?.getAttribute("fo:margin-left") ?? null);
      if (indent !== null) props.indent = indent;
      const align = paragraphProps?.getAttribute("fo:text-align");
      if (align)
        props.align =
          align === "center"
            ? "center"
            : align === "end" || align === "right"
              ? "end"
              : align === "justify"
                ? "justify"
                : "start";
      const outline = style.getAttribute("style:default-outline-level");
      if (outline) props.outline = Number(outline);
      const fontStyle = textProps?.getAttribute("fo:font-style");
      if (fontStyle) props.italic = fontStyle === "italic" || fontStyle === "oblique";
      const weight = textProps?.getAttribute("fo:font-weight");
      if (weight) props.bold = weight === "bold" || Number(weight) >= 600;
      // e.g. "super 58%" or "33% 58%"
      const position = textProps?.getAttribute("style:text-position");
      if (position) props.superscript = position.startsWith("super") || parseFloat(position) > 0;
      byName.set(name, props);
    }
  }
  const resolve = (name: string | null, depth = 0): StyleProps => {
    const own = name ? byName.get(name) : undefined;
    if (!own || depth > 20) return {};
    const inherited = resolve(own.parent ?? null, depth + 1);
    const { automatic, ...props } = own;
    return {
      ...inherited,
      ...defined(props),
      name: automatic ? (inherited.name ?? undefined) : own.name,
    };
  };
  return { resolve: (name) => resolve(name) };
}

function format(style: StyleProps, partial = false): Formatting {
  if (partial) return { superscript: style.superscript!, italic: style.italic!, bold: style.bold! };
  return {
    superscript: style.superscript ?? false,
    italic: style.italic ?? false,
    bold: style.bold ?? false,
  };
}

function defined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  // SAFETY: Object.keys of a T lists only T's own keys.
  for (const key of Object.keys(value) as (keyof T)[])
    if (value[key] !== undefined) out[key] = value[key];
  return out;
}
