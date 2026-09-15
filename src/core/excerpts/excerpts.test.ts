/**
 * The projection's two claims a screen depends on and cannot check for itself:
 *
 *  - every output character keeps the source offset it came from, so a hit
 *    found in source coordinates highlights the right characters of the
 *    reading; and
 *  - the verse anchors the projection drops come back as their own marks, at
 *    the offset the verse's first character sits at.
 *
 * Run over the real engine and the committed fixture, because the thing under
 * test is arithmetic over Onion's token stream and its table of contents — a
 * hand-built `Analysis` would be a test of the fake.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { NodeGalleyLive } from "../../platform/node/galley";
import { toLf, type Analysis } from "../galley";
import { Galley } from "../galley/galley";
import { excerptsOf, project, quote, type BookText } from "./excerpts";

const PHILEMON = toLf(
  readFileSync(
    fileURLToPath(new URL("../../../fixtures/small-nt/58-PHM.usfm", import.meta.url)),
    "utf8",
  ),
).text;

const analyzed = (): Promise<Analysis> =>
  Effect.runPromise(
    Effect.provide(
      Galley.useSync((galley) => galley.analyze(PHILEMON)),
      NodeGalleyLive,
    ),
  );

const book = (analysis: Analysis): BookText => ({
  bookId: "PHM",
  text: PHILEMON,
  analysis,
});

describe("the excerpt projection", () => {
  it("keeps one source offset per projected character", async () => {
    const analysis = await analyzed();
    const projection = project(analysis, 0, analysis.docLen);
    expect(projection.src.length).toBe(projection.text.length);
    // Every mapped offset points at the character it stands for, except the
    // separating spaces the projection invents for dropped markup.
    for (let index = 0; index < projection.text.length; index += 1) {
      const at = projection.src[index]!;
      if (projection.text[index] === " ") continue;
      expect(PHILEMON[at]).toBe(projection.text[index]);
    }
  });

  it("marks each verse at the first character of its reading", async () => {
    const analysis = await analyzed();
    const projection = project(analysis, 0, analysis.docLen);
    const first = projection.verses[0];
    expect(first).toBeDefined();
    expect(first!.label).toBe("1");
    expect(projection.text.slice(first!.at)).toMatch(/^Paul, a prisoner/);
    // In order, once each, and every one at a real offset.
    const labels = projection.verses.map((verse) => verse.label);
    expect(labels.slice(0, 5)).toEqual(["1", "2", "3", "4", "5"]);
    expect(new Set(labels).size).toBe(labels.length);
    for (let index = 1; index < projection.verses.length; index += 1)
      expect(projection.verses[index]!.at).toBeGreaterThan(projection.verses[index - 1]!.at);
  });

  it("gives an excerpt the verse numbers of exactly its own span", async () => {
    const analysis = await analyzed();
    const at = PHILEMON.indexOf("May grace be to you");
    const [excerpt] = excerptsOf(book(analysis), [
      { bookId: "PHM", from: at, to: at + "May grace".length },
    ]);
    expect(excerpt).toBeDefined();
    // Verse 3, with 2 above and 4 below — the default one either side, clamped
    // to the chapter.
    expect(excerpt!.sid).toBe("PHM 1:3");
    expect(excerpt!.verses.map((verse) => verse.label)).toEqual(["2", "3", "4"]);
    const three = excerpt!.verses[1]!;
    expect(excerpt!.text.slice(three.at)).toMatch(/^May grace be to you/);
    // The highlight is still on the right characters of the reading.
    expect(excerpt!.marks.length).toBe(1);
    const mark = excerpt!.marks[0]!;
    expect(excerpt!.text.slice(mark.from, mark.to)).toBe("May grace");
  });

  it("carries the raw slice of its own span, indexable by source offset", async () => {
    const analysis = await analyzed();
    const at = PHILEMON.indexOf("May grace be to you");
    const [excerpt] = excerptsOf(book(analysis), [
      { bookId: "PHM", from: at, to: at + "May grace".length },
    ]);
    expect(excerpt).toBeDefined();
    // The markup the reading drops is all still here, which is the point.
    expect(excerpt!.source).toBe(PHILEMON.slice(excerpt!.span.from, excerpt!.span.to));
    expect(excerpt!.source).toContain("\\v 3 ");
    // A USFM-mode card highlights by subtraction and nothing else.
    const hit = excerpt!.hits[0]!;
    const from = hit.from - excerpt!.span.from;
    expect(excerpt!.source.slice(from, from + "May grace".length)).toBe("May grace");
  });
});

describe("quote", () => {
  it("projects the site and marks the convicted character", async () => {
    const analysis = await analyzed();
    const at = PHILEMON.indexOf("May grace be to you") + 3;
    const quoted = quote(analysis, at, at + 1);
    expect(quoted.projected).toBe(true);
    expect(quoted.hit).toBe(" ");
    expect(quoted.before.endsWith("May")).toBe(true);
    expect(quoted.after.startsWith("grace")).toBe(true);
  });

  it("falls back to the raw slice when the span is markup the reading drops", async () => {
    const analysis = await analyzed();
    // Inside the `\p` marker name: the projection has no character for it.
    const at = PHILEMON.indexOf("\\p\n\\v 3") + 1;
    const quoted = quote(analysis, at, at + 1);
    expect(quoted.projected).toBe(false);
    expect(quoted.hit).toBe("p");
  });
});
