import { Data, Result } from "effect";

export interface SourceStamp {
  readonly revision: number;
  readonly length: number;
  readonly hash: string;
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

const hex16 = (limb: number): string => limb.toString(16).padStart(4, "0");

/**
 * FNV-1a 64 over UTF-16 code units, carried in four 16-bit limbs so every
 * partial product stays exact in a double. Onion's header hash (xxh3-64) may
 * replace this at the engine boundary later; nothing here tries to match it.
 */
export const hashText = (text: string): string => {
  let h0 = 0x2325;
  let h1 = 0x8422;
  let h2 = 0x9ce4;
  let h3 = 0xcbf2;
  for (let index = 0; index < text.length; index += 1) {
    h0 ^= text.charCodeAt(index);
    const p0 = h0 * 0x1b3;
    const p1 = h1 * 0x1b3 + (p0 >>> 16);
    const p2 = h2 * 0x1b3 + h0 * 0x100 + (p1 >>> 16);
    const p3 = h3 * 0x1b3 + h1 * 0x100 + (p2 >>> 16);
    h0 = p0 & 0xffff;
    h1 = p1 & 0xffff;
    h2 = p2 & 0xffff;
    h3 = p3 & 0xffff;
  }
  return `${hex16(h3)}${hex16(h2)}${hex16(h1)}${hex16(h0)}`;
};

const sourceAt = (text: string, revision: number): Source => ({
  text,
  stamp: { revision, length: text.length, hash: hashText(text) },
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

export const describes = (stamp: SourceStamp, text: string): boolean =>
  stamp.length === text.length && stamp.hash === hashText(text);
