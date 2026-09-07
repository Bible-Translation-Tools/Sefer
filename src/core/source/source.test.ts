import { Result } from "effect";
import { describe, expect, test } from "vitest";

import { apply, decode, encode, type Change, type Source } from "./source";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const decoded = (input: Uint8Array): Source => {
  const result = decode(input);
  if (Result.isFailure(result)) throw new Error(`decode refused: ${result.failure.reason}`);
  return result.success;
};

const applied = (source: Source, change: Change): Source => {
  const result = apply(source, change);
  if (Result.isFailure(result)) throw new Error(`apply refused: ${result.failure.reason}`);
  return result.success;
};

const changeRefusal = (source: Source, change: Change): string => {
  const result = apply(source, change);
  if (Result.isSuccess(result)) throw new Error("apply accepted a change it should have refused");
  return result.failure.reason;
};

const refusal = (input: Uint8Array): string => {
  const result = decode(input);
  if (Result.isSuccess(result)) throw new Error("decode accepted bytes it should have refused");
  return result.failure.reason;
};

describe("decode", () => {
  test("normalises uniform CRLF to LF and stamps the canonical text", () => {
    const source = decoded(bytes("\\id PHM\r\n\\p\r\n"));

    expect(source.text).toBe("\\id PHM\n\\p\n");
    expect(source.stamp).toEqual({ revision: 0, length: source.text.length });
  });

  test("refuses a byte order mark, mixed newlines, and invalid UTF-8", () => {
    expect(refusal(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("ByteOrderMark");
    expect(refusal(bytes("one\r\ntwo\nthree"))).toBe("MixedNewlines");
    expect(refusal(new Uint8Array([0x61, 0xc3, 0x28]))).toBe("InvalidUtf8");
  });
});

describe("apply", () => {
  test("advances the revision and updates the length", () => {
    const first = decoded(bytes("\\id PHM\nPaul\n"));
    const second = applied(first, { from: 8, to: 12, insert: "Timothy" });

    expect(second.text).toBe("\\id PHM\nTimothy\n");
    expect(second.stamp.revision).toBe(first.stamp.revision + 1);
    expect(second.stamp.length).toBe(second.text.length);
  });

  test("round trips through encode as canonical LF bytes", () => {
    const source = applied(decoded(bytes("\\id PHM\r\nPaul\r\n")), {
      from: 8,
      to: 12,
      insert: "Timothy",
    });

    expect(new TextDecoder().decode(encode(source))).toBe("\\id PHM\nTimothy\n");
  });
});

describe("apply admission", () => {
  test("refuses an inverted or out-of-bounds range, a split surrogate pair, and a carriage return", () => {
    const source = decoded(bytes("\\id PHM\nPaul\n"));
    const emoji = decoded(bytes("a\u{1F600}b"));

    expect(changeRefusal(source, { from: 5, to: 2, insert: "" })).toBe("RangeOutOfBounds");
    expect(changeRefusal(source, { from: 0, to: source.text.length + 1, insert: "" })).toBe(
      "RangeOutOfBounds",
    );
    // "a" then the two units of the emoji: offset 2 sits between them.
    expect(changeRefusal(emoji, { from: 2, to: 2, insert: "!" })).toBe("SplitsSurrogatePair");
    expect(changeRefusal(source, { from: 0, to: 0, insert: "\r\n" })).toBe("CarriageReturn");
  });

  test("admits an astral insert and round trips it through encode unchanged", () => {
    const source = applied(decoded(bytes("\\id PHM\nPaul\n")), {
      from: 12,
      to: 12,
      insert: " \u{1F4D6}",
    });

    expect(new TextDecoder().decode(encode(source))).toBe("\\id PHM\nPaul \u{1F4D6}\n");
    expect(source.stamp.length).toBe(source.text.length);
  });
});
