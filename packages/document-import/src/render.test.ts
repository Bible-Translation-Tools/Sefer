import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { readDocument, render } from "./index.ts";
import type { Inline, Paragraph, Reading } from "./index.ts";

const fixture = (name: string) =>
  readDocument(new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url))));

describe("the Titus fixtures", () => {
  test("Word, Word with a raised baseline, and Writer all give the same USFM", async () => {
    const [master, docx, odt] = await Promise.all(
      ["master-titus.docx", "titus.docx", "titus.odt"].map(fixture),
    );
    const out = render(master, { book: "TIT" });
    expect(out.report.detected).toBe("superscript");
    expect(out.report.chapters.map((c) => [c.chapter, c.verses, c.missing.length])).toEqual([
      [1, 16, 0],
      [2, 15, 0],
      [3, 15, 0],
    ]);
    expect(render(docx, { book: "TIT" }).usfm).toBe(out.usfm);
    expect(render(odt, { book: "TIT" }).usfm).toBe(out.usfm);
  });

  test("the document's own paragraphs are kept, and the title line is not dropped", async () => {
    const { usfm } = render(await fixture("master-titus.docx"), { book: "TIT" });
    const chapterOne = usfm.slice(0, usfm.indexOf("\\c 2"));
    const paragraphStarts = [...chapterOne.matchAll(/\\p\n\\v (\d+)/g)].map((m) => Number(m[1]));
    expect(paragraphStarts).toEqual([1, 4, 5, 10]);
    expect(usfm.startsWith("\\id TIT\n\\rem MASTER:\n\\c 1\n")).toBe(true);
  });

  test("a comment lands on the same words from Word and from Writer", async () => {
    const [docx, odt] = await Promise.all(["titus.docx", "titus.odt"].map(fixture));
    const anchor = (r: Reading) =>
      render(r).comments.map(({ ref, start, end, anchorText }) => ({
        ref,
        start,
        end,
        anchorText,
      }));
    expect(anchor(docx)).toEqual([
      {
        ref: "1:1",
        start: { ref: "1:1", offset: 23 },
        end: { ref: "1:1", offset: 40 },
        anchorText: "and an apostle of",
      },
    ]);
    expect(anchor(odt)).toEqual(anchor(docx));
  });
});

const text = (value: string, superscript = false): Inline => ({
  kind: "text",
  text: value,
  superscript,
  italic: false,
  bold: false,
});
const para = (...inlines: Inline[]): Paragraph => ({
  style: null,
  role: null,
  level: 0,
  indent: 0,
  align: null,
  list: false,
  table: false,
  inlines,
});
const reading = (...paragraphs: Paragraph[]): Reading => ({
  format: "docx",
  paragraphs,
  notes: new Map(),
  comments: new Map(),
  trackedChanges: 0,
});
const verses = (usfm: string) => [...usfm.matchAll(/\\(c|v) (\S+)/g)].map((m) => `${m[1]}${m[2]}`);

describe("what counts as a verse number", () => {
  test("only the next number, written the document's way; quantities and out-of-order numbers stay text", () => {
    const out = render(
      reading(
        para(
          text("1", true),
          text("The army was 1,000 men "),
          text("2", true),
          text("and 3 sons. "),
          text("9", true),
          text("Late. "),
          text("3-4", true),
          text("Bridged."),
        ),
        para(text("1", true), text("Again.")),
      ),
      { versification: () => 5 },
    );
    expect(verses(out.usfm)).toEqual(["c1", "v1", "v2", "v3-4", "c2", "v1"]);
    expect(out.usfm).toContain("The army was 1,000 men");
    expect(out.usfm).toContain("9Late.");
    expect(out.report.skipped).toEqual([{ ref: "1:2", number: "9", reason: "versification" }]);
  });

  test("plain numbers at the start of a line, and v1 or verse 2, are each detected", () => {
    const lineStart = render(
      reading(para(text("Chapter 2")), para(text("1 One, 3 days.")), para(text("2 Two."))),
    );
    expect(lineStart.report.detected).toBe("lineStart");
    expect(verses(lineStart.usfm)).toEqual(["c2", "v1", "v2"]);
    const marked = render(reading(para(text("v1 One. verse 2 Two. v 3 Three in 4 parts."))));
    expect(marked.report.detected).toBe("marked");
    expect(verses(marked.usfm)).toEqual(["c1", "v1", "v2", "v3"]);
  });
});
