#!/usr/bin/env node
// document-import <file.docx|file.odt> [--book TIT] [--verses auto|superscript|marked|lineStart|perLine|any]
//   [--poetry keep|unwrap] [--headings keep|rem|drop] [--front rem|mt|drop] [--notes keep|drop]
//   [--italic keep|unwrap] [--bold keep|unwrap] [--lists keep|unwrap] [--style-markers keep|unwrap]
//   [--chapter-words chapter,capítulo] [--out file.usfm] [--json]
// Writes the USFM to --out or stdout; with --json, prints { usfm, report, comments } instead.
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { readDocument, render } from "./index.ts";
import type { Settings } from "./index.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    book: { type: "string" },
    verses: { type: "string" },
    poetry: { type: "string" },
    headings: { type: "string" },
    front: { type: "string" },
    notes: { type: "string" },
    italic: { type: "string" },
    bold: { type: "string" },
    lists: { type: "string" },
    "style-markers": { type: "string" },
    "chapter-words": { type: "string" },
    out: { type: "string" },
    json: { type: "boolean" },
  },
});

const [input] = positionals;
if (!input) {
  console.error(
    "usage: document-import <file.docx|file.odt> [--book TIT] [--verses mode] [--out file.usfm] [--json]",
  );
  process.exit(1);
}

function choice<T extends string>(flag: keyof typeof values, allowed: readonly T[]): T | undefined {
  const value = values[flag];
  if (value === undefined) return undefined;
  const found = allowed.find((a) => a === value);
  if (found === undefined) {
    console.error(`--${flag} must be one of: ${allowed.join(", ")}`);
    process.exit(1);
  }
  return found;
}

const keep = ["keep", "unwrap"] as const;
const settings: Settings = {};
const set = <K extends keyof Settings>(key: K, value: Settings[K] | undefined) => {
  if (value !== undefined) settings[key] = value;
};
set("book", values.book);
set(
  "verses",
  choice("verses", ["auto", "superscript", "marked", "lineStart", "perLine", "any"] as const),
);
set("poetry", choice("poetry", keep));
set("headings", choice("headings", ["keep", "rem", "drop"] as const));
set("front", choice("front", ["rem", "mt", "drop"] as const));
set("notes", choice("notes", ["keep", "drop"] as const));
set("italic", choice("italic", keep));
set("bold", choice("bold", keep));
set("lists", choice("lists", keep));
set("styleMarkers", choice("style-markers", keep));
set("chapterWords", values["chapter-words"]?.split(","));

const reading = await readDocument(new Uint8Array(readFileSync(input)));
const rendered = render(reading, settings);
if (values.json) {
  console.log(JSON.stringify(rendered, null, 2));
} else if (values.out) {
  writeFileSync(values.out, rendered.usfm);
  console.error(
    `${values.out}: ${rendered.report.chapters.map((c) => `${c.chapter}:${c.verses}`).join(" ")} (${rendered.report.verses})`,
  );
} else {
  process.stdout.write(rendered.usfm);
}
