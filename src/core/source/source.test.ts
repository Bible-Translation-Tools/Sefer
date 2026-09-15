import { Result } from "effect";
import { describe, expect, test } from "vitest";

import { apply, decode, dominantEol, encode, type Change, type Source } from "./source";

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

  test("refuses invalid UTF-8, and nothing else", () => {
    expect(refusal(new Uint8Array([0x61, 0xc3, 0x28]))).toBe("InvalidUtf8");
    // A mark and a mixed file are read and remembered, not refused: the only
    // thing Sefer cannot do with bytes is fail to read them.
    expect(decoded(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])).text).toBe("a");
    expect(decoded(bytes("one\r\ntwo\nthree")).text).toBe("one\ntwo\nthree");
  });
});

describe("the disk form", () => {
  test("reads a uniform LF file as LF with no mark", () => {
    expect(decoded(bytes("\\id PHM\nPaul\n")).form).toEqual({ eol: "lf", bom: false });
  });

  test("reads a uniform CRLF file as CRLF", () => {
    expect(decoded(bytes("\\id PHM\r\nPaul\r\n")).form).toEqual({ eol: "crlf", bom: false });
  });

  test("reads a mixed file as its majority, either way", () => {
    // Two CRLF against one LF, and the reverse: the majority decides, and the
    // file becomes uniform in that form the first time it is written.
    expect(dominantEol("a\r\nb\r\nc\nd")).toBe("crlf");
    expect(dominantEol("a\r\nb\nc\nd")).toBe("lf");
    expect(decoded(bytes("a\r\nb\r\nc\nd")).form.eol).toBe("crlf");
  });

  test("a tie and a file with no line ending at all are LF", () => {
    expect(dominantEol("a\r\nb\nc")).toBe("lf");
    expect(dominantEol("\\id PHM")).toBe("lf");
  });

  test("remembers a byte order mark without keeping it in the text", () => {
    const source = decoded(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes("\\id PHM\n")]));

    expect(source.text).toBe("\\id PHM\n");
    expect(source.form).toEqual({ eol: "lf", bom: true });
  });

  test("survives an apply: the form belongs to the bytes, not to the edit", () => {
    const first = decoded(bytes("\\id PHM\r\nPaul\r\n"));
    const second = applied(first, { from: 8, to: 12, insert: "Timothy" });

    expect(second.form).toEqual(first.form);
  });
});

describe("encode writes back the form it read", () => {
  const roundTrip = (input: Uint8Array): Uint8Array => encode(decoded(input));

  test("LF, CRLF and a mark all round trip byte for byte", () => {
    const lf = bytes("\\id PHM\nPaul\n");
    const crlf = bytes("\\id PHM\r\nPaul\r\n");
    const marked = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes("\\id PHM\r\nPaul\r\n")]);

    expect(roundTrip(lf)).toEqual(lf);
    expect(roundTrip(crlf)).toEqual(crlf);
    expect(roundTrip(marked)).toEqual(marked);
  });

  test("a mixed file comes back uniform in its majority", () => {
    const mixed = bytes("a\r\nb\r\nc\nd\r\n");

    expect(new TextDecoder().decode(roundTrip(mixed))).toBe("a\r\nb\r\nc\r\nd\r\n");
  });

  test("an edited CRLF book is written back as CRLF", () => {
    const source = applied(decoded(bytes("\\id PHM\r\nPaul\r\n")), {
      from: 8,
      to: 12,
      insert: "Timothy",
    });

    expect(new TextDecoder().decode(encode(source))).toBe("\\id PHM\r\nTimothy\r\n");
    // The text itself never carries the carriage returns: only the bytes do.
    expect(source.text).toBe("\\id PHM\nTimothy\n");
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

  test("round trips through encode as UTF-8 in the file's own form", () => {
    const source = applied(decoded(bytes("\\id PHM\nPaul\n")), {
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
