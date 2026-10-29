// Generated-input verification of render's two promises; see
// agents/skills/verify-document-import/SKILL.md. Run:
//   node --test packages/document-import/src/faithful.verify.ts
// RUNS=20000 for a longer run, SEED=<n> to replay a failure.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Inline, Note, Paragraph, Reading } from "./model.ts";
import { render } from "./render.ts";
import type { Settings } from "./render.ts";

// Words are built only from letters that no verse marker, chapter number or
// USFM marker consumes: no e, r, s or v ("verse", "v1"), no digits, no '.' or '-'.
// Filtering both sides down to this alphabet leaves exactly the translator's text.
const ALPHABET = "abcdfghijklmnopqtuwxyz";
const KEPT = new Set([...ALPHABET, ...ALPHABET.toUpperCase(), ";", "!", "?", "é", "ñ"]);
const letters = (s: string) => [...s].filter((c) => KEPT.has(c)).join("");
const stripMarkers = (usfm: string) => usfm.replace(/\\[a-z]+\d*\*?/g, " ");

const runs = Number(process.env.RUNS ?? 3000);
const firstSeed = Number(process.env.SEED ?? 1);

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)];
  return { next, int, pick };
}

type Rng = ReturnType<typeof rng>;

interface Case {
  reading: Reading;
  settings: Settings;
  /** The translator's text in order: every text run and kept note body, without chapter labels. */
  expected: string;
}

function word(r: Rng) {
  let w = "";
  for (let i = 0, n = 1 + r.int(7); i < n; i++) w += r.pick([...ALPHABET, "é", "ñ"]);
  return r.next() < 0.1 ? w.toUpperCase() : w;
}

function number(r: Rng) {
  const n = 1 + r.int(r.next() < 0.8 ? 20 : 999);
  return r.pick([
    `${n}`,
    `${n}.`,
    `${n}-${n + 1}`,
    `${n},000`,
    `${n} 000`,
    `v${n}`,
    `verse ${n}`,
    `v ${n}`,
  ]);
}

function generate(seed: number): Case {
  const r = rng(seed);
  const notes = new Map<string, Note>();
  const paragraphs: Paragraph[] = [];
  let expected = "";
  let comment = 0;
  const notesKept = true;

  for (let p = 0, count = 1 + r.int(14); p < count; p++) {
    const roll = r.next();
    if (roll < 0.08) {
      // A chapter label: not the translator's text, so not expected.
      const label =
        r.pick(["Chapter", "chapter", "CHAPTER"]) + (r.next() < 0.7 ? ` ${1 + r.int(5)}` : "");
      paragraphs.push(paragraph(r, [text(label)]));
      continue;
    }
    const inlines: Inline[] = [];
    for (let i = 0, n = r.int(14); i < n; i++) {
      const kind = r.next();
      if (kind < 0.45) {
        const t = `${r.pick(["", " "])}${word(r)}${r.pick(["", " ", ",", "; ", "! "])}`;
        inlines.push(text(t, false, r.next() < 0.15, r.next() < 0.1));
        expected += t;
      } else if (kind < 0.6) {
        inlines.push(text(number(r), r.next() < 0.5));
      } else if (kind < 0.7) {
        // A number sharing its run with the words around it, as typed: "1 Paul", "and 3 sons".
        const before = r.next() < 0.5 ? `${word(r)} ` : "";
        const after = `${r.pick([" ", "", "\t"])}${word(r)}${r.pick(["", " "])}`;
        inlines.push(text(`${before}${number(r)}${after}`, false, r.next() < 0.1));
        expected += before + after;
      } else if (kind < 0.78) {
        inlines.push(text(r.pick([" ", "\t", "  "]), r.next() < 0.5));
      } else if (kind < 0.85) {
        inlines.push({ kind: "break" });
      } else if (kind < 0.92) {
        const id = `fn:${notes.size}`;
        const body = `${word(r)} ${word(r)}`;
        notes.set(id, { id, kind: "footnote", text: body });
        inlines.push({ kind: "note", id });
        if (notesKept) expected += body;
      } else {
        const id = `${comment++}`;
        inlines.push({ kind: "commentStart", id }, { kind: "commentEnd", id });
      }
    }
    paragraphs.push(paragraph(r, inlines));
  }

  const settings: Settings = {
    verses: r.pick(["auto", "superscript", "marked", "lineStart", "perLine", "any"] as const),
    poetry: r.pick(["keep", "unwrap"] as const),
    headings: r.pick(["keep", "rem"] as const),
    front: r.pick(["rem", "mt"] as const),
    notes: "keep",
    italic: r.pick(["keep", "unwrap"] as const),
    bold: r.pick(["keep", "unwrap"] as const),
    lists: r.pick(["keep", "unwrap"] as const),
    styleMarkers: r.pick(["keep", "unwrap"] as const),
    ...(r.next() < 0.3 ? { versification: () => 3 + r.int(20) } : {}),
    ...(r.next() < 0.2 ? { markers: { q2: "q1", p: "m" } } : {}),
  };
  return {
    reading: { format: "docx", paragraphs, notes, comments: new Map(), trackedChanges: 0 },
    settings,
    expected,
  };
}

function text(value: string, superscript = false, italic = false, bold = false): Inline {
  return { kind: "text", text: value, superscript, italic, bold };
}

function paragraph(r: Rng, inlines: Inline[]): Paragraph {
  const role = r.pick([null, null, null, null, "heading", "title", "quote"] as const);
  return {
    style: r.pick([null, null, "Normal", "q2", "s1 - Heading", "p", "li"]),
    role,
    level: role ? 1 + r.int(3) : 0,
    indent: r.pick([0, 0, 0, 36, 72, 108]),
    align: r.pick([null, null, "center", "justify"] as const),
    list: r.next() < 0.1,
    table: r.next() < 0.05,
    inlines,
  };
}

// Within one chapter, verse numbers only go up; no verse comes before the first chapter.
function verseOrder(usfm: string): string | null {
  let chapter: number | null = null;
  let last = 0;
  for (const m of usfm.matchAll(/\\(c|v) (\d+)(?:-(\d+))?/g)) {
    const from = Number(m[2]);
    if (m[1] === "c") {
      chapter = from;
      last = 0;
      continue;
    }
    if (chapter === null) return `\\v ${m[2]} before any \\c`;
    if (from <= last) return `\\v ${from} after verse ${last} in chapter ${chapter}`;
    last = Number(m[3] ?? from);
  }
  return null;
}

function replay(seed: number, c: Case) {
  return `seed ${seed} (SEED=${seed} RUNS=1 to replay)\nsettings ${JSON.stringify(c.settings)}\nreading ${JSON.stringify(c.reading.paragraphs.map((p) => p.inlines))}`;
}

test("render keeps every letter of the text, in order, none twice", () => {
  for (let seed = firstSeed; seed < firstSeed + runs; seed++) {
    const c = generate(seed);
    const { usfm } = render(c.reading, c.settings);
    const got = letters(stripMarkers(usfm));
    const want = letters(c.expected);
    if (got !== want) {
      let at = 0;
      while (at < got.length && got[at] === want[at]) at++;
      assert.fail(
        `letters differ at ${at}: wanted "${want.slice(at, at + 20)}", got "${got.slice(at, at + 20)}"\n${replay(seed, c)}\n${usfm}`,
      );
    }
  }
});

test("verse numbers only go up within a chapter", () => {
  for (let seed = firstSeed; seed < firstSeed + runs; seed++) {
    const c = generate(seed);
    const { usfm } = render(c.reading, c.settings);
    const problem = verseOrder(usfm);
    if (problem) assert.fail(`${problem}\n${replay(seed, c)}\n${usfm}`);
  }
});
