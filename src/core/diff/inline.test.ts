import { describe, expect, it } from "vitest";

import { hasInlineChange, inlineDiff, sideOf } from "./inline";

/** The two columns a renderer would print, as plain strings. */
const columns = (before: string, after: string): readonly [string, string] => {
  const segments = inlineDiff(before, after);
  return [
    sideOf(segments, "before")
      .map((part) => part.text)
      .join(""),
    sideOf(segments, "after")
      .map((part) => part.text)
      .join(""),
  ];
};

describe("inlineDiff", () => {
  it("reports no change for identical text", () => {
    const segments = inlineDiff("\\v 1 In the beginning", "\\v 1 In the beginning");
    expect(hasInlineChange(segments)).toBe(false);
  });

  it("rebuilds both sides exactly", () => {
    const before = "\\v 14 And he saw a great multitude, and was moved with compassion";
    const after = "\\v 14 And he saw a great crowd, and was moved with compassion.";
    expect(columns(before, after)).toEqual([before, after]);
  });

  it("marks only the word that changed", () => {
    const segments = inlineDiff("a great multitude here", "a great crowd here");
    const removed = segments
      .filter((part) => part.kind === "remove")
      .map((part) => part.text)
      .join("");
    const added = segments
      .filter((part) => part.kind === "add")
      .map((part) => part.text)
      .join("");
    // The shared "e"/space of the surrounding words stays shared, so the marks
    // are inside the one word rather than over the whole line.
    expect(removed.length).toBeLessThan("multitude".length + 3);
    expect(added.length).toBeLessThan("crowd".length + 3);
    expect(columns("a great multitude here", "a great crowd here")).toEqual([
      "a great multitude here",
      "a great crowd here",
    ]);
  });

  it("is a pure insertion when one side is empty", () => {
    expect(inlineDiff("", "new")).toEqual([{ kind: "add", text: "new" }]);
    expect(inlineDiff("old", "")).toEqual([{ kind: "remove", text: "old" }]);
    expect(inlineDiff("", "")).toEqual([]);
  });

  it("falls back to a wholesale swap past the size cap", () => {
    const before = "a".repeat(5000);
    const after = "b".repeat(5000);
    expect(inlineDiff(before, after)).toEqual([
      { kind: "remove", text: before },
      { kind: "add", text: after },
    ]);
  });

  it("keeps a long shared prefix and suffix out of the table", () => {
    const shared = "\\v 1 ".concat("word ".repeat(3000));
    expect(columns(`${shared}alpha`, `${shared}omega`)).toEqual([
      `${shared}alpha`,
      `${shared}omega`,
    ]);
  });
});
