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

export const apply = (source: Source, change: Change): Source =>
  sourceAt(
    `${source.text.slice(0, change.from)}${change.insert}${source.text.slice(change.to)}`,
    source.stamp.revision + 1,
  );
