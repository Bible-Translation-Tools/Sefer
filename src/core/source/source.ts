import { Data, Result } from "effect";

export interface SourceStamp {
  readonly revision: number;
  readonly length: number;
}

export interface Source {
  readonly text: string;
  readonly stamp: SourceStamp;
}

export interface Change {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export type DecodeRefusal = "InvalidUtf8" | "ByteOrderMark" | "MixedNewlines";

export class SourceDecodeError extends Data.TaggedError("SourceDecodeError")<{
  readonly reason: DecodeRefusal;
  readonly description: string;
}> {}

export type ChangeRefusal = "RangeOutOfBounds" | "SplitsSurrogatePair" | "CarriageReturn";

export class SourceChangeError extends Data.TaggedError("SourceChangeError")<{
  readonly reason: ChangeRefusal;
  readonly description: string;
}> {}

const sourceAt = (text: string, revision: number): Source => ({
  text,
  stamp: { revision, length: text.length },
});

const refuse = (reason: DecodeRefusal, description: string): SourceDecodeError =>
  new SourceDecodeError({ reason, description });

const hasByteOrderMark = (bytes: Uint8Array): boolean =>
  bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

const newlineStyleCount = (text: string): number => {
  let crlf = false;
  let cr = false;
  let lf = false;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit === 0x0d) {
      if (text.charCodeAt(index + 1) === 0x0a) {
        crlf = true;
        index += 1;
      } else cr = true;
    } else if (unit === 0x0a) lf = true;
  }
  return Number(crlf) + Number(cr) + Number(lf);
};

export const decode = (bytes: Uint8Array): Result.Result<Source, SourceDecodeError> => {
  if (hasByteOrderMark(bytes))
    return Result.fail(refuse("ByteOrderMark", "the file begins with a UTF-8 byte order mark"));

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return Result.fail(refuse("InvalidUtf8", "the bytes are not valid UTF-8"));
  }

  if (newlineStyleCount(decoded) > 1)
    return Result.fail(refuse("MixedNewlines", "the file mixes CRLF, CR and LF line endings"));

  return Result.succeed(sourceAt(decoded.replace(/\r\n?/g, "\n"), 0));
};

export const encode = (source: Source): Uint8Array => new TextEncoder().encode(source.text);

const refuseChange = (reason: ChangeRefusal, description: string): SourceChangeError =>
  new SourceChangeError({ reason, description });

const splitsSurrogatePair = (text: string, index: number): boolean => {
  if (index <= 0 || index >= text.length) return false;
  const before = text.charCodeAt(index - 1);
  const at = text.charCodeAt(index);
  return before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff;
};

export const apply = (source: Source, change: Change): Result.Result<Source, SourceChangeError> => {
  const { from, to, insert } = change;

  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    from > to ||
    to > source.text.length
  )
    return Result.fail(
      refuseChange(
        "RangeOutOfBounds",
        `[${from}, ${to}) is not a range inside text of length ${source.text.length}`,
      ),
    );

  if (splitsSurrogatePair(source.text, from) || splitsSurrogatePair(source.text, to))
    return Result.fail(
      refuseChange("SplitsSurrogatePair", `[${from}, ${to}) lands inside a surrogate pair`),
    );

  if (insert.includes("\r"))
    return Result.fail(
      refuseChange("CarriageReturn", "the inserted text contains a carriage return"),
    );

  return Result.succeed(
    sourceAt(
      `${source.text.slice(0, from)}${insert}${source.text.slice(to)}`,
      source.stamp.revision + 1,
    ),
  );
};
