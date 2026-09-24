/**
 * The Citation parser, as a table: what somebody writes, and the Addresses it
 * means. The one test file the build-out rule allows in Sefer (Will,
 * 2026-09-24), because most of the application stands on this answer.
 *
 * Addresses are written in their U23003 spelling (`addressCode`) so each row
 * reads as the specification it is.
 */

import { describe, expect, test } from "vitest";

import { addressCode } from "./address";
import { parseCitation, type CitationOptions } from "./citation";
import { nameCatalogue } from "./names";

const SPANISH: Readonly<Record<string, readonly string[]>> = {
  LUK: ["Lucas"],
  EXO: ["Éxodo"],
  MAT: ["Mateo"],
};

const catalogue = nameCatalogue({
  named: (id) => SPANISH[id] ?? [],
  abbreviations: (id) => (id === "MAT" ? ["Mt", "Matt"] : []),
  intro: ["introducción"],
});

const NAVIGATION: CitationOptions = { grammar: "navigation" };
const PROSE: CitationOptions = { grammar: "prose" };

const read = (text: string, options: CitationOptions = NAVIGATION): readonly string[] | string => {
  const citation = parseCitation(text, catalogue, options);
  return citation.ok ? citation.addresses.map(addressCode) : citation.problem;
};

describe("one place", () => {
  test.each([
    ["Luke", ["LUK"]],
    ["luke 3", ["LUK 3"]],
    ["LUK 3:1", ["LUK 3:1"]],
    ["luk 3.1", ["LUK 3:1"]],
    ["Lucas 3:1", ["LUK 3:1"]],
    ["1 John 2:3", ["1JN 2:3"]],
    ["1john 2:3", ["1JN 2:3"]],
    ["2 Sam 3", ["2SA 3"]],
    ["Éxodo 20", ["EXO 20"]],
    ["exodo 20", ["EXO 20"]],
    ["  Luke   3 : 1  ", ["LUK 3:1"]],
    ["Mt 5:3", ["MAT 5:3"]],
  ])("%s", (text, expected) => {
    expect(read(text)).toEqual(expected);
  });
});

describe("ranges", () => {
  test.each([
    ["Luke 1:1-2", ["LUK 1:1-2"]],
    ["Luke 1:1–2", ["LUK 1:1-2"]],
    ["Luke 1:1—2", ["LUK 1:1-2"]],
    ["Mat 2-4", ["MAT 2-4"]],
    ["Mat 1:20-2:3", ["MAT 1:20-2:3"]],
    // A bare chapter at the start of a range stands for its first verse.
    ["Mat 2-3:4", ["MAT 2:1-3:4"]],
  ])("%s", (text, expected) => {
    expect(read(text)).toEqual(expected);
  });
});

describe("lists: book and chapter carry forward", () => {
  test.each([
    ["Mat 1:1,3", ["MAT 1:1", "MAT 1:3"]],
    // Kept as written: a consumer can coalesce, and cannot un-merge.
    ["Mat 1:1,2", ["MAT 1:1", "MAT 1:2"]],
    ["Mat 1:5-23", ["MAT 1:5-23"]],
    ["Mat 1:1,3; 2:4-6; Mrk 3:1", ["MAT 1:1", "MAT 1:3", "MAT 2:4-6", "MRK 3:1"]],
    // After `;` a bare number is a chapter again.
    ["Mat 1:1; 3", ["MAT 1:1", "MAT 3"]],
    ["Mat 1:20-2:3, 5", ["MAT 1:20-2:3", "MAT 2:5"]],
    ["Mat 5, 7", ["MAT 5", "MAT 7"]],
  ])("%s", (text, expected) => {
    expect(read(text, PROSE)).toEqual(expected);
  });
});

describe("segments are coordinates", () => {
  test.each([
    ["John 3:16a", ["JHN 3:16a"]],
    ["John 3:16a-17", ["JHN 3:16a-17"]],
    ["John 3:16-16b", ["JHN 3:16-16b"]],
  ])("%s", (text, expected) => {
    expect(read(text)).toEqual(expected);
  });

  test("a later segment of the same verse comes after an earlier one", () => {
    expect(read("John 3:16b-16a")).toBe("backwards");
  });

  test("a chapter carries no segment", () => {
    expect(read("John 3a")).toBe("malformed");
  });
});

describe("the introduction is its own kind, however it was written", () => {
  test.each([["Luke intro"], ["Luke introduction"], ["Lucas introducción"], ["LUK 0"]])(
    "%s",
    (text) => {
      expect(read(text)).toEqual(["LUK 0"]);
    },
  );

  test("verse 0 of the introduction is not a place", () => {
    expect(read("LUK 0:1")).toBe("zero");
  });
});

describe("navigation reads loosely", () => {
  test("with no `:` or `.` anywhere, the first comma separates chapter from verse", () => {
    expect(read("luk 3,1")).toEqual(["LUK 3:1"]);
    expect(read("luk 3,1-4")).toEqual(["LUK 3:1-4"]);
  });

  test("with a `:` present, a comma is a list", () => {
    expect(read("Mat 1:1,3")).toEqual(["MAT 1:1", "MAT 1:3"]);
  });

  test("a prefix names the first book in canon order", () => {
    expect(read("phil")).toEqual(["PHP"]);
    expect(read("mar 3")).toEqual(["MRK 3"]);
  });

  test("a prefix prefers a book the project holds", () => {
    const held = new Set(["PHM"]);
    expect(parseCitation("phil", catalogue, { grammar: "navigation", held })).toMatchObject({
      ok: true,
      addresses: [{ kind: "book", book: "PHM" }],
    });
  });

  test("an exact name beats another book's prefix", () => {
    // "jude" is a prefix of Judges, which comes first in the canon; the
    // exact name must still win.
    expect(read("jude")).toEqual(["JUD"]);
    expect(read("John")).toEqual(["JHN"]);
  });
});

describe("prose reads strictly", () => {
  test("a prefix is not a book", () => {
    expect(read("phil 2:3", PROSE)).toBe("unknown-book");
  });

  test("a registered abbreviation is", () => {
    expect(read("Matt 5:3", PROSE)).toEqual(["MAT 5:3"]);
  });

  test("a comma is always a list", () => {
    expect(read("Mat 3,1", PROSE)).toEqual(["MAT 3", "MAT 1"]);
  });
});

describe("a book the project lacks is still a citation", () => {
  test("Romans parses; resolution is what answers that it is missing", () => {
    const held = new Set(["LUK"]);
    expect(parseCitation("Romans 8:28", catalogue, { grammar: "navigation", held })).toMatchObject({
      ok: true,
      addresses: [{ kind: "verses", book: "ROM" }],
    });
  });
});

describe("invalid is not a citation at all", () => {
  test.each([
    ["", "empty"],
    ["   ", "empty"],
    ["Hezekiah 3", "unknown-book"],
    ["3:16", "no-book"],
    ["Luke 3:0", "zero"],
    ["Luke 0-3", "zero"],
    ["Luke 3:5-2", "backwards"],
    ["Luke 5-2", "backwards"],
    ["Luke 3:", "malformed"],
    ["Luke 3:1,", "malformed"],
    ["Luke 3:1 and 4", "malformed"],
    ["Luke 3::1", "malformed"],
    ["Luke 3:1;", "malformed"],
    ["Luke intro 3", "malformed"],
  ])("%j is %s", (text, problem) => {
    expect(read(text)).toBe(problem);
  });

  test("an unknown book says which words it could not read", () => {
    expect(parseCitation("Hezekiah 3", catalogue, NAVIGATION)).toMatchObject({
      ok: false,
      word: "Hezekiah",
    });
  });
});
