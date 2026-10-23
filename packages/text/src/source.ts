import { Data, Result } from "effect";

export interface SourceStamp {
  readonly revision: number;
  readonly length: number;
}

/**
 * How the file was written on disk, remembered so that Sefer can write it back
 * the same way.
 *
 * It is deliberately NOT part of the stamp and never part of any comparison:
 * the text a Book holds is always canonical (LF, no mark), and every identity
 * question — dirty, baseline, diff, external change — is asked of that text.
 * The form is a property of the BYTES, carried alongside so that `encode` can
 * reproduce them. Two Sources with the same text and different forms are the
 * same text.
 *
 * `eol` is the file's DOMINANT line ending, not a promise that the file was
 * uniform. A file that mixes styles is read as its majority and written back
 * uniform in that majority the first time it is saved.
 */
export interface SourceForm {
  readonly eol: "lf" | "crlf";
  /** Did the file begin with a UTF-8 byte order mark? */
  readonly bom: boolean;
}

export interface Source {
  readonly text: string;
  readonly stamp: SourceStamp;
  /** The disk form these bytes came in, and the one `encode` writes back. */
  readonly form: SourceForm;
}

export interface Change {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export type DecodeRefusal = "InvalidUtf8";

export class SourceDecodeError extends Data.TaggedError("SourceDecodeError")<{
  readonly reason: DecodeRefusal;
  readonly description: string;
}> {}

export type ChangeRefusal = "RangeOutOfBounds" | "SplitsSurrogatePair" | "CarriageReturn";

export class SourceChangeError extends Data.TaggedError("SourceChangeError")<{
  readonly reason: ChangeRefusal;
  readonly description: string;
}> {}

const sourceAt = (text: string, revision: number, form: SourceForm): Source => ({
  text,
  stamp: { revision, length: text.length },
  form,
});

const refuse = (reason: DecodeRefusal, description: string): SourceDecodeError =>
  new SourceDecodeError({ reason, description });

const BOM_BYTES = new Uint8Array([0xef, 0xbb, 0xbf]);

const hasByteOrderMark = (bytes: Uint8Array): boolean =>
  bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

/**
 * The file's dominant line ending.
 *
 * CRLF and bare LF each get a vote and the majority wins; a tie — including a
 * file with no line ending at all — is LF, because LF is what Sefer writes
 * when it has nothing to go on. A bare CR (classic Mac) is normalised to LF on
 * the way in and does not vote: nothing Sefer can be asked to preserve in 2026
 * is worth a third case in `encode`.
 */
export const dominantEol = (text: string): SourceForm["eol"] => {
  let crlf = 0;
  let lineFeeds = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 0x0a) continue;
    if (text.charCodeAt(index - 1) === 0x0d) crlf += 1;
    else lineFeeds += 1;
  }
  return crlf > lineFeeds ? "crlf" : "lf";
};

/**
 * Reads one file into canonical text plus the form it arrived in.
 *
 * The only refusal left is `InvalidUtf8`: bytes that are not UTF-8 are not
 * scripture Sefer can edit, and replacing them with U+FFFD would silently
 * corrupt a file it cannot read. A byte order mark and a mixed-newline file
 * are both ACCEPTED and remembered — see `SourceForm`.
 */
export const decode = (bytes: Uint8Array): Result.Result<Source, SourceDecodeError> => {
  const bom = hasByteOrderMark(bytes);
  const body = bom ? bytes.subarray(BOM_BYTES.length) : bytes;

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return Result.fail(refuse("InvalidUtf8", "the bytes are not valid UTF-8"));
  }

  return Result.succeed(
    sourceAt(decoded.replace(/\r\n?/g, "\n"), 0, { eol: dominantEol(decoded), bom }),
  );
};

/**
 * Offsets between a text as a file holds it and the canonical text `decode`
 * makes of it.
 *
 * A host that computed offsets on the RAW text — a server's findings, counted
 * in UTF-16 into the file with its `\r\n` and maybe its byte order mark — has
 * offsets that drift by one per line from what the editor shows. Every API
 * offset in the editor is canonical (LF, no mark), so a raw offset goes
 * through `toCanonical` first, and a canonical one through `toRaw` on its way
 * back. A lone `\r` becomes `\n` in place and moves nothing; a dropped `\r`
 * of `\r\n`, or the mark, is a character the canonical text does not have.
 */
export interface OffsetMap {
  /** The canonical offset for a raw one. A raw offset on a dropped `\r` lands on its `\n`. */
  toCanonical(raw: number): number;
  /** The raw offset for a canonical one: on the `\n` of a `\r\n`, never on its `\r`. */
  toRaw(canonical: number): number;
}

export const offsetMap = (raw: string): OffsetMap => {
  const dropped: number[] = [];
  if (raw.charCodeAt(0) === 0xfeff) dropped.push(0);
  for (let at = raw.indexOf("\r\n"); at !== -1; at = raw.indexOf("\r\n", at + 2)) dropped.push(at);
  const before = (offset: number): number => {
    let lo = 0;
    let hi = dropped.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((dropped[mid] ?? 0) < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return {
    toCanonical: (offset) => offset - before(offset),
    toRaw: (offset) => {
      let lo = 0;
      let hi = dropped.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((dropped[mid] ?? 0) - mid <= offset) lo = mid + 1;
        else hi = mid;
      }
      return offset + lo;
    },
  };
};

/** Canonical LF text written back in the form the file arrived in. */
export const encode = (source: Source): Uint8Array => {
  const text = source.form.eol === "crlf" ? source.text.replace(/\n/g, "\r\n") : source.text;
  const body = new TextEncoder().encode(text);
  if (!source.form.bom) return body;
  const out = new Uint8Array(BOM_BYTES.length + body.length);
  out.set(BOM_BYTES, 0);
  out.set(body, BOM_BYTES.length);
  return out;
};

const refuseChange = (reason: ChangeRefusal, description: string): SourceChangeError =>
  new SourceChangeError({ reason, description });

const splitsSurrogatePair = (text: string, index: number): boolean => {
  if (index <= 0 || index >= text.length) return false;
  const before = text.charCodeAt(index - 1);
  const at = text.charCodeAt(index);
  return before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff;
};

export const applyChange = (
  source: Source,
  change: Change,
): Result.Result<Source, SourceChangeError> => {
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
      source.form,
    ),
  );
};
