import { Option, Result, Schema } from "effect";

const UpstreamSchema = Schema.Struct({
  books: Schema.Array(Schema.String),
  via: Schema.Literal("git"),
  url: Schema.String,
  commit: Schema.String,
  takenAt: Schema.String,
});

export type Upstream = typeof UpstreamSchema.Type;

const File = Schema.Struct({ v: Schema.Literal(1), upstreams: Schema.Array(UpstreamSchema) });

const decodeFile = Schema.decodeUnknownResult(File);

export const UPSTREAMS_FILE = ".upstreams.json";

export const upstreamsText = (upstreams: readonly Upstream[]): string =>
  `${JSON.stringify({ v: 1, upstreams }, null, 2)}\n`;

export const readUpstreams = (text: string): Option.Option<readonly Upstream[]> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return Option.none();
  }
  const decoded = decodeFile(parsed);
  return Result.isFailure(decoded) ? Option.none() : Option.some(decoded.success.upstreams);
};
