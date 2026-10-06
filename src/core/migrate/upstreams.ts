/**
 * `.upstreams.json`: which Writer project each book of this project follows.
 *
 * An Upstream is a git remote something here was obtained from and is checked
 * against. It is PULL-ONLY: never the Shared project, never a git remote of
 * this repository (a project has two at most, `origin` and `copy`), and
 * never merged — new work from it arrives through the importer and Review's
 * decisions.
 *
 * Committed at the project root, because a teammate needs to know that
 * 1 John follows mary_chishimba's Writer project. Not in `.sefer/` (this
 * device's corner, kept out of every commit) and not in the Burrito, whose
 * relationships relate whole burritos. Checking it is a later step; this
 * build records.
 */

import { Option, Result, Schema } from "effect";

const UpstreamSchema = Schema.Struct({
  books: Schema.Array(Schema.String),
  via: Schema.Literal("git"),
  url: Schema.String,
  /** The last upstream commit whose work we took. */
  commit: Schema.String,
  /** When we took it, ISO date. */
  takenAt: Schema.String,
});

export type Upstream = typeof UpstreamSchema.Type;

const File = Schema.Struct({ v: Schema.Literal(1), upstreams: Schema.Array(UpstreamSchema) });

const decodeFile = Schema.decodeUnknownResult(File);

export const UPSTREAMS_FILE = ".upstreams.json";

export const upstreamsText = (upstreams: readonly Upstream[]): string =>
  `${JSON.stringify({ v: 1, upstreams }, null, 2)}\n`;

/**
 * The upstreams a file records. A file that does not decode — edited by hand,
 * merged badly — means "none known", and nothing is checked: the safe failure.
 */
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
