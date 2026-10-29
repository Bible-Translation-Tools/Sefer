// Reads a Word (.docx) or OpenDocument (.odt) draft and renders it as USFM.
//
//   const reading = await readDocument(bytes);
//   const { usfm, report, comments } = render(reading, { book: "TIT" });
//
// Reading happens once per file; render is cheap and pure, so a host reruns it
// on every settings change to preview. The report says what was found and every
// guess made, each with the setting that turns it off.

import { readDocxWith } from "./docx.ts";
import type { Reading } from "./model.ts";
import { readOdtWith } from "./odt.ts";
import { defaultParseXml } from "./xml.ts";
import type { ParseXml } from "./xml.ts";

export interface ReadOptions {
  /** Defaults to the browser's DOMParser, or @xmldom/xmldom under Node. */
  parseXml?: ParseXml;
}

export async function readDocx(bytes: Uint8Array, options: ReadOptions = {}): Promise<Reading> {
  return readDocxWith(bytes, options.parseXml ?? (await defaultParseXml()));
}

export async function readOdt(bytes: Uint8Array, options: ReadOptions = {}): Promise<Reading> {
  return readOdtWith(bytes, options.parseXml ?? (await defaultParseXml()));
}

/** Either format, told apart by the ODF `mimetype` entry every .odt opens with. */
export async function readDocument(bytes: Uint8Array, options: ReadOptions = {}): Promise<Reading> {
  const head = String.fromCharCode(...bytes.subarray(0, 100));
  return head.includes("application/vnd.oasis.opendocument.text")
    ? readOdt(bytes, options)
    : readDocx(bytes, options);
}

export { render } from "./render.ts";
export type {
  ChapterSummary,
  CommentThread,
  Found,
  Guess,
  Keep,
  Rendered,
  Report,
  Settings,
  Skip,
  VersePoint,
} from "./render.ts";
export type {
  Comment,
  Format,
  Formatting,
  Inline,
  Note,
  Paragraph,
  Reading,
  Role,
} from "./model.ts";
export type { VerseMode } from "./verses.ts";
export type { ParseXml, XmlElement, XmlNode } from "./xml.ts";
