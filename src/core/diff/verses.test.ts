import { describe, expect, it } from "vitest";

import { alignVerses, byChapter, referenceOf, type VerseSpan } from "./verses";

/**
 * A tiny stand-in for what the engine's table of contents gives: one span per
 * `\v` line, plus the chapter's opening. The real extraction lives in
 * `src/app/ui/panels/verses.ts`, which needs the wasm engine; the alignment
 * below needs only the spans, which is the point of the split.
 */
const spansOf = (text: string): readonly VerseSpan[] => {
  const spans: VerseSpan[] = [];
  let chapter = 0;
  let at = 0;
  for (const line of text.split("\n")) {
    const length = line.length + 1;
    const chapterMatch = /^\\c (\d+)/u.exec(line);
    const verseMatch = /^\\v (\d+)/u.exec(line);
    if (chapterMatch !== null) {
      chapter = Number(chapterMatch[1]);
      spans.push({ chapter, verse: 0, lastVerse: 0, from: at, to: at + length });
    } else if (verseMatch !== null) {
      const verse = Number(verseMatch[1]);
      spans.push({ chapter, verse, lastVerse: verse, from: at, to: at + length });
    } else {
      const last = spans.at(-1);
      if (last === undefined)
        spans.push({ chapter: 0, verse: 0, lastVerse: 0, from: at, to: at + length });
      else spans[spans.length - 1] = { ...last, to: at + length };
    }
    at += length;
  }
  return spans;
};

const align = (before: string, after: string) =>
  alignVerses(before, spansOf(before), after, spansOf(after));

const DISK = ["\\c 1", "\\v 1 alpha", "\\v 2 beta", "\\v 3 gamma", ""].join("\n");

describe("referenceOf", () => {
  it("names a verse, a bridge, a chapter and the front matter", () => {
    expect(referenceOf({ chapter: 5, verse: 14, lastVerse: 14 })).toBe("5:14");
    expect(referenceOf({ chapter: 5, verse: 14, lastVerse: 16 })).toBe("5:14-16");
    expect(referenceOf({ chapter: 5, verse: 0, lastVerse: 0 })).toBe("5");
    expect(referenceOf({ chapter: 0, verse: 0, lastVerse: 0 })).toBe("front");
  });
});

describe("alignVerses", () => {
  it("reports nothing changed when the two texts agree", () => {
    const rows = align(DISK, DISK);
    expect(rows.every((row) => row.kind === "same")).toBe(true);
  });

  it("marks only the verse that moved", () => {
    const working = DISK.replace("\\v 2 beta", "\\v 2 BETA");
    const rows = align(DISK, working);
    const changed = rows.filter((row) => row.kind !== "same");
    expect(changed).toHaveLength(1);
    expect(changed[0]?.reference).toBe("1:2");
    expect(changed[0]?.baseline).toBe("\\v 2 beta\n");
    expect(changed[0]?.working).toBe("\\v 2 BETA\n");
  });

  it("stays level when a verse is added", () => {
    const working = DISK.replace("\\v 3 gamma", "\\v 3 gamma\n\\v 4 delta");
    const rows = align(DISK, working);
    expect(rows.map((row) => row.reference)).toEqual(["1", "1:1", "1:2", "1:3", "1:4"]);
    expect(rows.filter((row) => row.kind !== "same").map((row) => row.kind)).toEqual(["added"]);
  });

  it("keeps a removed verse in its old place, with an empty working side", () => {
    const working = DISK.replace("\\v 2 beta\n", "");
    const rows = align(DISK, working);
    const removed = rows.find((row) => row.kind === "removed");
    expect(removed?.reference).toBe("1:2");
    expect(removed?.working).toBe("");
    expect(removed?.baseline).toBe("\\v 2 beta\n");
    // Reinserted where it was: at the end of the verse that still precedes it.
    expect(removed?.from).toBe(removed?.to);
    expect(rows.map((row) => row.reference)).toEqual(["1", "1:1", "1:2", "1:3"]);
  });

  it("gives every working row offsets that index the working text", () => {
    const working = DISK.replace("\\v 2 beta", "\\v 2 BETA changed");
    for (const row of align(DISK, working)) {
      if (row.kind === "removed") continue;
      expect(working.slice(row.from, row.to)).toBe(row.working);
    }
  });

  it("groups by chapter and counts the changes in each", () => {
    const disk = ["\\c 1", "\\v 1 a", "\\c 2", "\\v 1 b", ""].join("\n");
    const working = disk.replace("\\v 1 b", "\\v 1 B");
    const chapters = byChapter(align(disk, working));
    expect(chapters.map((chapter) => [chapter.chapter, chapter.changed])).toEqual([
      [1, 0],
      [2, 1],
    ]);
  });
});
