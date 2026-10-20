import { makeBook, type Book } from "@sefer/text/book";
import { decode } from "@sefer/text/source";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import { NodeGalleyLive } from "#platform/node/galley";

import { Galley, type GalleyService } from "../galley";
import { applyOverlay, overlayBook } from "./fixes";

const bookOf = (text: string): Book => {
  const source = decode(new TextEncoder().encode(text));
  if (Result.isFailure(source)) throw new Error(source.failure.reason);
  return makeBook("PHM.usfm", source.success);
};

const BS = "\\";

const TARGET = [
  `${BS}id PHM`,
  `${BS}c 1`,
  `${BS}p`,
  `${BS}v 1 Paul a prisoner of Christ Jesus`,
  `${BS}v 2 and to the church in thy house`,
  `${BS}v 3 Grace to you and peace`,
  `${BS}v 4 I thank my God always`,
  "",
].join("\n");

const SOURCE = [
  `${BS}id PHM`,
  `${BS}c 1`,
  `${BS}p`,
  `${BS}v 1 Paulus a bondman of the Anointed`,
  `${BS}q1`,
  `${BS}v 2 and unto the assembly at thy dwelling`,
  `${BS}v 3 Favour unto you and rest`,
  `${BS}p`,
  `${BS}v 4 I give thanks unto my God at all times`,
  "",
].join("\n");

const withGalley = <A>(use: (galley: GalleyService) => A): Promise<A> =>
  Effect.runPromise(Effect.provide(Galley.useSync(use), NodeGalleyLive));

const shapeOf = (text: string): readonly string[] =>
  [...text.matchAll(/^\\([a-z]+\d*)/gmu)]
    .map((m) => m[1])
    .filter((marker) => marker !== "id" && marker !== "c" && marker !== "v");

const wordsOf = (text: string): string =>
  text
    .split("\n")
    .map((line) => line.replace(/^\\[a-z]+\d*\s*/u, "").replace(/^\d+\s*/u, ""))
    .join(" ")
    .replaceAll(/\s+/gu, " ")
    .trim();

describe("match formatting", () => {
  it("has the door at all", async () => {
    const found = await withGalley((galley) => overlayBook(galley, bookOf(TARGET), SOURCE));
    expect(Result.isFailure(found) ? found.failure.description : "ok").toBe("ok");
  });

  it("carries the source's block shape onto the target", async () => {
    const after = await withGalley((galley) => {
      const book = bookOf(TARGET);
      const previewed = overlayBook(galley, book, SOURCE);
      if (Result.isFailure(previewed)) return previewed.failure.description;
      expect(previewed.success.empty).toBe(false);
      const applied = applyOverlay(previewed.success, book);
      if (Result.isFailure(applied)) return applied.failure.description;
      return book.source().text;
    });
    expect(shapeOf(after)).toEqual(shapeOf(SOURCE));
  });

  it("changes the paragraphing and not one word", async () => {
    const after = await withGalley((galley) => {
      const book = bookOf(TARGET);
      const previewed = overlayBook(galley, book, SOURCE);
      if (Result.isFailure(previewed)) return TARGET;
      applyOverlay(previewed.success, book);
      return book.source().text;
    });
    expect(wordsOf(after)).toBe(wordsOf(TARGET));
  });

  it("is one revision, so Undo is the preview", async () => {
    const jump = await withGalley((galley) => {
      const book = bookOf(TARGET);
      const before = book.source().stamp.revision;
      const previewed = overlayBook(galley, book, SOURCE);
      if (Result.isFailure(previewed)) return -1;
      applyOverlay(previewed.success, book);
      return book.source().stamp.revision - before;
    });
    expect(jump).toBe(1);
  });

  it("reports empty rather than writing when the shapes already agree", async () => {
    const empty = await withGalley((galley) => {
      const previewed = overlayBook(galley, bookOf(SOURCE), SOURCE);
      return Result.isFailure(previewed) ? undefined : previewed.success.empty;
    });
    expect(empty).toBe(true);
  });
});
