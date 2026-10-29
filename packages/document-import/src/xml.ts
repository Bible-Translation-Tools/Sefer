import { strFromU8, unzipSync } from "fflate";

// The few DOM members the readers use, so the browser's DOMParser and
// @xmldom/xmldom both satisfy it.
export interface XmlNode {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly nodeValue: string | null;
  readonly textContent: string | null;
  readonly childNodes: ArrayLike<XmlNode>;
  readonly parentNode: XmlNode | null;
}

export interface XmlElement extends XmlNode {
  getAttribute(name: string): string | null;
  getElementsByTagName(name: string): ArrayLike<XmlElement>;
}

/** Parses one XML part and returns its document element; throws on malformed XML. */
export type ParseXml = (text: string) => XmlElement;

interface DomParserLike {
  parseFromString(text: string, type: string): { documentElement: XmlElement | null };
}

// The browser (and the Tauri webview) parse XML natively. Node has no DOMParser,
// so it loads @xmldom/xmldom on demand; the specifier is a variable so a bundler
// never pulls it into a browser build.
export async function defaultParseXml(): Promise<ParseXml> {
  // SAFETY: DOMParser is optional here, and checked before use.
  let Parser = (globalThis as { DOMParser?: new () => DomParserLike }).DOMParser;
  if (!Parser) {
    const specifier = "@xmldom/xmldom";
    // SAFETY: @xmldom/xmldom exports a DOMParser whose documents satisfy XmlElement.
    const xmldom = (await import(/* @vite-ignore */ specifier)) as {
      DOMParser: new () => DomParserLike;
    };
    Parser = xmldom.DOMParser;
  }
  const parser = new Parser();
  return (text) => {
    const root = parser.parseFromString(text, "application/xml").documentElement;
    if (
      !root ||
      root.nodeName === "parsererror" ||
      root.getElementsByTagName("parsererror").length > 0
    ) {
      throw new Error("The document contains malformed XML.");
    }
    return root;
  };
}

// Office files are zips of XML parts; returns a lookup that parses a part on demand.
export function openPackage(bytes: Uint8Array, parse: ParseXml) {
  const files = unzipSync(bytes);
  return {
    has: (path: string) => path in files,
    text: (path: string) => (files[path] ? strFromU8(files[path]) : null),
    xml: (path: string): XmlElement | null => (files[path] ? parse(strFromU8(files[path])) : null),
  };
}

export function childElements(el: XmlNode, name?: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i];
    if (node.nodeType === 1 && (!name || node.nodeName === name)) {
      // SAFETY: nodeType 1 is an element.
      out.push(node as XmlElement);
    }
  }
  return out;
}

export function childElement(el: XmlNode, name: string): XmlElement | undefined {
  return childElements(el, name)[0];
}

export function descendants(el: XmlElement, name: string): XmlElement[] {
  return Array.from(el.getElementsByTagName(name));
}
