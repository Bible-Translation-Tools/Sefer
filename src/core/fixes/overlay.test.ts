/**
 * Match formatting, against the real engine and a real book.
 *
 * The riskiest thing about `overlayBook` is not its arithmetic — it barely has
 * any — but whether the door is THERE. The overlay functions are probed off the
 * wasm module by name, so an artifact that is not the pinned tag fails at the
 * call and nowhere earlier; that is exactly the failure this proves is not the
 * one we have. The rest of the file is the two claims a translator relies on:
 * the target ends up with the source's paragraphing, and its WORDS are
 * untouched.
 */

import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import { NodeGalleyLive } from "#platform/node/galley";

import { makeBook, type Book } from "../book/book";
import { Galley, type GalleyService } from "../galley";
import { decode } from "../source/source";
import { applyOverlay, overlayBook } from "./fixes";

/**
 * A Book over a literal, with no filesystem. `openBook` is the ordinary door
 * and wants a path; these two texts are the fixture, so they are decoded
 * straight into `makeBook` — which is also what proves the canonical-form pass
 * ran, since `decode` is the only thing that produces a `Source`.
 */
const bookOf = (text: string): Book => {
  const source = decode(new TextEncoder().encode(text));
  if (Result.isFailure(source)) throw new Error(source.failure.reason);
  return makeBook("PHM.usfm", source.success);
};

const BS = "\\";

/** The target: one paragraph, four verses, no poetry at all. */
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

/**
 * The source: the same four verses, differently laid out — verse 2 opens a
 * poetry line and verse 4 opens a new paragraph. Different words on purpose,
 * because match formatting carries the SHAPE and must not carry the text.
 */
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

/** The block markers a text holds, in order — what "formatting" means here. */
const shapeOf = (text: string): readonly string[] =>
  [...text.matchAll(/^\\([a-z]+\d*)/gmu)]
    .map((m) => m[1])
    .filter((marker) => marker !== "id" && marker !== "c" && marker !== "v");

/** Every word of scripture in the text, so a test can say "unchanged". */
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
    // A `Result` failure here is the artifact, not the arithmetic: the message
    // is the engine's own, and it is what the toolbar would put on screen.
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
    // The target keeps ITS words — match formatting is not a translation.
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
