import { makeBook } from "@wycliffeassociates/sefer-text/book";
import * as TextResult from "@wycliffeassociates/sefer-text/result";
import { decode } from "@wycliffeassociates/sefer-text/source";
import { Result } from "effect";
import { describe, expect, test } from "vitest";

import { find, foldAccents, replaceInBook } from "./search";

const bookOf = (text: string) => {
  const source = decode(new TextEncoder().encode(text));
  if (TextResult.isFailure(source)) throw new Error("fixture does not decode");
  return makeBook("57-TIT.usfm", source.success);
};

const spans = (text: string, needle: string, ignoreAccents = true) => {
  const found = find([bookOf(text)], { text: needle, ignoreAccents });
  if (Result.isFailure(found)) throw new Error(found.failure.description);
  return found.success.map((hit) => text.slice(hit.from, hit.to));
};

describe("foldAccents", () => {
  test("drops marks and maps every folded unit back to the original", () => {
    const { folded, at } = foldAccents("Jesús");
    expect(folded).toBe("Jesus");
    expect([...at]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test("a decomposed mark folds away and stays with its letter", () => {
    const { folded, at } = foldAccents("Jesús");
    expect(folded).toBe("Jesus");
    expect([...at]).toEqual([0, 1, 2, 3, 5, 6]);
  });

  test("leaves characters without marks alone, Hangul included", () => {
    expect(foldAccents("한국 \u{1F600}").folded).toBe("한국 \u{1F600}");
  });
});

describe("find ignoring accents", () => {
  const text = "\\id TIT\n\\v 1 jesus, Jesus, Jesús y Jesús.\n";

  test("jesus finds every spelling, case and accent folded", () => {
    expect(spans(text, "jesus")).toEqual(["jesus", "Jesus", "Jesús", "Jesús"]);
  });

  test("an accented query finds the bare word too", () => {
    expect(spans(text, "jesús")).toHaveLength(4);
  });

  test("precomposed and decomposed é match each other", () => {
    expect(spans("café café", "café")).toEqual(["café", "café"]);
    expect(spans("café café", "café")).toEqual(["café", "café"]);
  });

  test("a match ending on a decomposed letter keeps its mark", () => {
    expect(spans("café!", "cafe")).toEqual(["café"]);
  });

  test("with accents matched, only the exact spelling is found", () => {
    expect(spans(text, "jesus", false)).toEqual(["jesus", "Jesus"]);
  });

  test("replace writes over the accented spans and nothing else", () => {
    const book = bookOf(text);
    const found = find([book], { text: "jesus", ignoreAccents: true });
    if (Result.isFailure(found)) throw new Error(found.failure.description);
    const receipt = replaceInBook(book, found.success, "Cristo");
    expect(receipt._tag).toBe("Success");
    expect(book.source().text).toBe("\\id TIT\n\\v 1 Cristo, Cristo, Cristo y Cristo.\n");
  });
});
