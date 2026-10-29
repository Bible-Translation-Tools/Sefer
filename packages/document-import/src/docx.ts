import { roleOf } from "./model.ts";
import type { Comment, Formatting, Inline, Note, Paragraph, Reading } from "./model.ts";
import { childElement, childElements, descendants, openPackage } from "./xml.ts";
import type { ParseXml, XmlElement } from "./xml.ts";

// A Word document: word/document.xml holds the body, word/styles.xml the named
// styles, and footnotes, endnotes and comments each live in a part of their own
// that the body points at by id.
export function readDocxWith(bytes: Uint8Array, parse: ParseXml): Reading {
  const part = openPackage(bytes, parse);
  const document = part.xml("word/document.xml");
  if (!document) throw new Error("Not a .docx: missing word/document.xml");
  const body = childElement(document, "w:body");
  if (!body) throw new Error("Not a .docx: the document has no body");

  const ctx: Ctx = {
    styles: readStyles(part.xml("word/styles.xml")),
    paragraphs: [],
    trackedChanges: 0,
  };
  walkBlocks(body, ctx, false);

  const notes = new Map<string, Note>();
  readNotes(part.xml("word/footnotes.xml"), "w:footnote", "footnote", notes);
  readNotes(part.xml("word/endnotes.xml"), "w:endnote", "endnote", notes);
  return {
    format: "docx",
    paragraphs: ctx.paragraphs,
    notes,
    comments: readComments(part.xml("word/comments.xml"), part.xml("word/commentsExtended.xml")),
    trackedChanges: ctx.trackedChanges,
  };
}

interface Ctx {
  styles: Styles;
  paragraphs: Paragraph[];
  trackedChanges: number;
}

function walkBlocks(el: XmlElement, ctx: Ctx, table: boolean) {
  for (const child of childElements(el)) {
    switch (child.nodeName) {
      case "w:p":
        ctx.paragraphs.push(paragraph(child, ctx, table));
        break;
      case "w:tbl":
        walkBlocks(child, ctx, true);
        break;
      case "w:del":
      case "w:moveFrom":
        ctx.trackedChanges++;
        break;
      case "w:sectPr":
      case "w:tblPr":
      case "w:tblGrid":
      case "w:trPr":
      case "w:tcPr":
      case "w:sdtPr":
        break;
      default: // rows, cells, content controls, custom XML, block-level insertions
        if (child.nodeName === "w:ins" || child.nodeName === "w:moveTo") ctx.trackedChanges++;
        walkBlocks(child, ctx, table);
    }
  }
}

function paragraph(p: XmlElement, ctx: Ctx, table: boolean): Paragraph {
  const pPr = childElement(p, "w:pPr");
  const styleId = pPr && childElement(pPr, "w:pStyle")?.getAttribute("w:val");
  const style = ctx.styles.resolve(styleId ?? ctx.styles.defaultParagraph);
  const direct = pPr ? paragraphProps(pPr) : {};
  const outline = direct.outline ?? style.outline ?? null;
  const { role, level } = roleOf(style.name ?? null, outline === null ? null : outline + 1);
  const inlines: Inline[] = [];
  walkInline(p, ctx, style, inlines);
  return {
    style: style.name ?? null,
    role,
    level,
    indent: direct.indent ?? style.indent ?? 0,
    align: direct.align ?? style.align ?? null,
    list: direct.list ?? style.list ?? false,
    table,
    inlines,
  };
}

function walkInline(el: XmlElement, ctx: Ctx, style: StyleProps, out: Inline[]) {
  for (const child of childElements(el)) {
    switch (child.nodeName) {
      case "w:r":
        run(child, ctx, style, out);
        break;
      case "w:commentRangeStart":
        out.push({ kind: "commentStart", id: child.getAttribute("w:id")! });
        break;
      case "w:commentRangeEnd":
        out.push({ kind: "commentEnd", id: child.getAttribute("w:id")! });
        break;
      case "w:del":
      case "w:moveFrom":
        ctx.trackedChanges++;
        break;
      case "w:pPr":
      case "w:proofErr":
      case "w:bookmarkStart":
      case "w:bookmarkEnd":
      case "mc:AlternateContent": // text boxes and drawings
        break;
      default: // hyperlinks, tracked insertions, smart tags, simple fields, content controls
        if (child.nodeName === "w:ins" || child.nodeName === "w:moveTo") ctx.trackedChanges++;
        walkInline(child, ctx, style, out);
    }
  }
}

function run(r: XmlElement, ctx: Ctx, paragraphStyle: StyleProps, out: Inline[]) {
  const rPr = childElement(r, "w:rPr");
  if (rPr && toggle(childElement(rPr, "w:vanish"))) return; // hidden text
  const charStyleId = rPr && childElement(rPr, "w:rStyle")?.getAttribute("w:val");
  const charStyle = charStyleId ? ctx.styles.resolve(charStyleId) : {};
  const direct = rPr ? runProps(rPr) : {};
  const format: Formatting = {
    superscript: direct.superscript ?? charStyle.superscript ?? paragraphStyle.superscript ?? false,
    italic: direct.italic ?? charStyle.italic ?? paragraphStyle.italic ?? false,
    bold: direct.bold ?? charStyle.bold ?? paragraphStyle.bold ?? false,
  };
  const text = (value: string) => {
    const last = out.at(-1);
    if (last?.kind === "text" && sameFormat(last, format)) last.text += value;
    else out.push({ kind: "text", text: value, ...format });
  };
  for (const child of childElements(r)) {
    switch (child.nodeName) {
      case "w:t":
        text(child.textContent ?? "");
        break;
      case "w:tab":
        text("\t");
        break;
      case "w:noBreakHyphen":
        text("-");
        break;
      case "w:br": {
        const type = child.getAttribute("w:type");
        if (type === "page" || type === "column") text(" ");
        else out.push({ kind: "break" });
        break;
      }
      case "w:cr":
        out.push({ kind: "break" });
        break;
      case "w:footnoteReference":
        out.push({ kind: "note", id: `fn:${child.getAttribute("w:id")}` });
        break;
      case "w:endnoteReference":
        out.push({ kind: "note", id: `en:${child.getAttribute("w:id")}` });
        break;
      // delText, instrText, softHyphen, rendered page breaks: no text a reader sees
    }
  }
}

function sameFormat(a: Formatting, b: Formatting) {
  return a.superscript === b.superscript && a.italic === b.italic && a.bold === b.bold;
}

interface StyleProps {
  name?: string;
  basedOn?: string;
  indent?: number;
  align?: Paragraph["align"];
  outline?: number;
  list?: boolean;
  italic?: boolean;
  bold?: boolean;
  superscript?: boolean;
}

interface Styles {
  defaultParagraph: string | null;
  resolve(id: string | null): StyleProps;
}

// Word styles inherit through w:basedOn; resolve walks the chain, nearest wins.
function readStyles(styles: XmlElement | null): Styles {
  const byId = new Map<string, StyleProps>();
  let defaultParagraph: string | null = null;
  for (const style of styles ? childElements(styles, "w:style") : []) {
    const id = style.getAttribute("w:styleId");
    if (!id) continue;
    if (style.getAttribute("w:type") === "paragraph" && style.getAttribute("w:default") === "1")
      defaultParagraph = id;
    const pPr = childElement(style, "w:pPr");
    const rPr = childElement(style, "w:rPr");
    byId.set(id, {
      name: childElement(style, "w:name")?.getAttribute("w:val") ?? id,
      basedOn: childElement(style, "w:basedOn")?.getAttribute("w:val") ?? undefined,
      ...(pPr ? paragraphProps(pPr) : {}),
      ...(rPr ? runProps(rPr) : {}),
    });
  }
  const cache = new Map<string, StyleProps>();
  const resolve = (id: string | null, depth = 0): StyleProps => {
    const own = id ? byId.get(id) : undefined;
    if (!own || depth > 20) return {};
    const cached = cache.get(id!);
    if (cached) return cached;
    const inherited = resolve(own.basedOn ?? null, depth + 1);
    const merged = { ...inherited, ...defined(own), name: own.name };
    cache.set(id!, merged);
    return merged;
  };
  return { defaultParagraph, resolve: (id) => resolve(id) };
}

function paragraphProps(pPr: XmlElement): StyleProps {
  const props: StyleProps = {};
  const ind = childElement(pPr, "w:ind");
  const left = ind && (ind.getAttribute("w:left") ?? ind.getAttribute("w:start"));
  if (left) props.indent = Number(left) / 20;
  const jc = childElement(pPr, "w:jc")?.getAttribute("w:val");
  if (jc)
    props.align =
      jc === "center"
        ? "center"
        : jc === "right" || jc === "end"
          ? "end"
          : jc === "both" || jc === "distribute"
            ? "justify"
            : "start";
  const outline = childElement(pPr, "w:outlineLvl")?.getAttribute("w:val");
  if (outline !== null && outline !== undefined && Number(outline) < 9)
    props.outline = Number(outline);
  const numId =
    childElement(pPr, "w:numPr") &&
    childElement(childElement(pPr, "w:numPr")!, "w:numId")?.getAttribute("w:val");
  if (numId) props.list = numId !== "0";
  return props;
}

function runProps(rPr: XmlElement): StyleProps {
  const props: StyleProps = {};
  const italic = childElement(rPr, "w:i");
  if (italic) props.italic = toggle(italic);
  const bold = childElement(rPr, "w:b");
  if (bold) props.bold = toggle(bold);
  const vertAlign = childElement(rPr, "w:vertAlign")?.getAttribute("w:val");
  if (vertAlign) props.superscript = vertAlign === "superscript";
  // A raised baseline (half-points) is how some exports fake superscript.
  const position = childElement(rPr, "w:position")?.getAttribute("w:val");
  if (position && props.superscript === undefined) props.superscript = Number(position) > 0;
  return props;
}

// <w:i/> is on; <w:i w:val="0"/> (or false, off) turns it off again.
function toggle(el: XmlElement | undefined) {
  if (!el) return false;
  const val = el.getAttribute("w:val");
  return val === null || val === "" || !["0", "false", "off"].includes(val);
}

function defined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  // SAFETY: Object.keys of a T lists only T's own keys.
  for (const key of Object.keys(value) as (keyof T)[])
    if (value[key] !== undefined) out[key] = value[key];
  return out;
}

function readNotes(
  root: XmlElement | null,
  tag: string,
  kind: Note["kind"],
  notes: Map<string, Note>,
) {
  for (const note of root ? childElements(root, tag) : []) {
    const type = note.getAttribute("w:type");
    if (type && type !== "normal") continue; // separators and continuation notices
    const id = `${kind === "footnote" ? "fn" : "en"}:${note.getAttribute("w:id")}`;
    const text = childElements(note, "w:p")
      .map((p) =>
        descendants(p, "w:t")
          .map((t) => t.textContent)
          .join(""),
      )
      .join(" ");
    notes.set(id, { id, kind, text: text.replace(/\s+/g, " ").trim() });
  }
}

// Replies and resolved state live in commentsExtended.xml, keyed by the
// w14:paraId of each comment's last paragraph.
function readComments(commentsXml: XmlElement | null, extendedXml: XmlElement | null) {
  const comments = new Map<string, Comment>();
  if (!commentsXml) return comments;

  const idByParaId = new Map<string, string>();
  for (const c of childElements(commentsXml, "w:comment")) {
    const id = c.getAttribute("w:id")!;
    const paras = childElements(c, "w:p");
    const date = c.getAttribute("w:date");
    comments.set(id, {
      id,
      author: c.getAttribute("w:author") ?? "",
      // Word writes 1900-01-01 when personal information is stripped from the file.
      date: date && !date.startsWith("1900") ? date : null,
      text: paras
        .map((p) =>
          descendants(p, "w:t")
            .map((t) => t.textContent)
            .join(""),
        )
        .join("\n")
        .trim(),
      parentId: null,
      resolved: false,
    });
    const paraId = paras.at(-1)?.getAttribute("w14:paraId");
    if (paraId) idByParaId.set(paraId, id);
  }

  for (const ex of extendedXml ? childElements(extendedXml, "w15:commentEx") : []) {
    const comment = comments.get(idByParaId.get(ex.getAttribute("w15:paraId") ?? "") ?? "");
    if (!comment) continue;
    const parentParaId = ex.getAttribute("w15:paraIdParent");
    comment.parentId = parentParaId ? (idByParaId.get(parentParaId) ?? null) : null;
    comment.resolved = ex.getAttribute("w15:done") === "1";
  }
  return comments;
}
