/**
 * The Catalogue: the list of projects that exist SOMEWHERE ELSE and could be
 * brought here.
 *
 * It is a port in `src/app` rather than a module in `src/core` because it is
 * not policy — it is one HTTP GET against a service Sefer does not own, and
 * core may not name `fetch`. Nothing in `src/core` asks a question this answers.
 *
 * The live source is the Language API's consolidated-repos view, the same one
 * the React prototype browses (`VITE_SEFER_LANGUAGE_API_URL`; see
 * `src/app/env.ts`). A build with no URL configured falls back to
 * `SAMPLE_CATALOGUE` so the screen is real in development instead of empty —
 * `catalogueFor` is the one place that decides which, and it says which one it
 * gave you in `source`.
 *
 * ## What the live payload does and does not carry
 *
 * The designer's mockup asks for four columns: Code, Language, Region, Date.
 * The consolidated-repos payload carries the first two (`language_ietf`,
 * `language_english_name`/`language_name`) and carries NEITHER a region NOR a
 * date. So `region` and `updated` are optional here and the table prints an
 * em dash for a row that has none: inventing a region would be worse than a
 * blank column, and the day the API grows the fields this decoder reads them.
 * The sample rows carry all four, which is what makes the dev screen look like
 * the mockup.
 *
 * `type` is derived, not declared: the Language API has no translation/gateway
 * flag, and the one signal in the payload is the owner — `wa-catalog` is the
 * curated gateway set, everyone else is a translation team. That mapping is
 * stated here so the filter's meaning is readable rather than inferred from a
 * comparison buried in a component.
 */

import { Result, Schema } from "effect";

import { env } from "./env";

export type ProjectType = "translation" | "gateway";

/** One row of the Find Project table. */
export interface CatalogueEntry {
  /** Stable key: `<owner>/<repo>`. */
  readonly id: string;
  /** BCP-47 tag, the "Code" column. */
  readonly code: string;
  /** The language's name in the language itself. */
  readonly naturalName: string;
  /** The language's name in English. */
  readonly anglicizedName: string;
  /** Absent in the live payload today — see the file header. */
  readonly region: string | undefined;
  /** ISO-8601 date, absent in the live payload today. */
  readonly updated: string | undefined;
  readonly type: ProjectType;
  readonly owner: string;
  readonly repo: string;
  /** What `Download` clones. Empty when the row names no repository. */
  readonly cloneUrl: string;
}

export class CatalogueError extends Error {
  override readonly name = "CatalogueError";
}

export interface CatalogueService {
  /** Which rows these are, so a screen can say "sample data" rather than lie. */
  readonly source: "live" | "sample";
  /** The endpoint, for the screen's provenance line. */
  readonly origin: string;
  readonly entries: () => Promise<readonly CatalogueEntry[]>;
}

/**
 * The live response, decoded rather than asserted. Unknown keys are dropped and
 * the optional ones are `optionalKey` because a missing field is a fact about
 * the payload, not a failure: one row without a title must not lose the other
 * six thousand.
 */
const ConsolidatedRepo = Schema.Struct({
  language_ietf: Schema.String,
  language_name: Schema.String,
  language_english_name: Schema.String,
  repo_url: Schema.String,
  repo_name: Schema.String,
  username: Schema.String,
  title: Schema.optionalKey(Schema.NullOr(Schema.String)),
  // Not in the payload today; read when it appears.
  region: Schema.optionalKey(Schema.NullOr(Schema.String)),
  updated_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const ConsolidatedRepos = Schema.Struct({
  vw_consolidated_repos: Schema.Array(ConsolidatedRepo),
});

const decodeRepos = Schema.decodeUnknownResult(ConsolidatedRepos);

/** The one place the owner→type mapping lives. See the file header. */
const typeOf = (owner: string): ProjectType =>
  owner.toLowerCase() === "wa-catalog" ? "gateway" : "translation";

const blankToUndefined = (value: string | null | undefined): string | undefined =>
  value === null || value === undefined || value.trim() === "" ? undefined : value;

const toEntry = (repo: typeof ConsolidatedRepo.Type): CatalogueEntry => ({
  id: `${repo.username}/${repo.repo_name}`,
  code: repo.language_ietf,
  naturalName: repo.language_name === "" ? repo.language_english_name : repo.language_name,
  anglicizedName:
    repo.language_english_name === "" ? repo.language_name : repo.language_english_name,
  region: blankToUndefined(repo.region),
  updated: blankToUndefined(repo.updated_at),
  type: typeOf(repo.username),
  owner: repo.username,
  repo: repo.repo_name,
  cloneUrl: repo.repo_url,
});

/**
 * The Language API implementation. One GET, no auth, no paging — the whole view
 * arrives at once, which is why the table sorts and filters in memory.
 */
export const languageApiCatalogue = (origin: string): CatalogueService => ({
  source: "live",
  origin,
  entries: async () => {
    const response = await fetch(origin, { headers: { accept: "application/json" } });
    if (!response.ok) throw new CatalogueError(`Language API error: ${response.status}`);
    const decoded = decodeRepos(await response.json());
    if (Result.isFailure(decoded))
      throw new CatalogueError(`Language API payload not understood: ${decoded.failure.message}`);
    return decoded.success.vw_consolidated_repos.map(toEntry);
  },
});

/**
 * Twelve rows that carry every column the mockup draws, so the screen can be
 * built and looked at without a network. They are SAMPLE data and the table
 * says so; nothing here is downloadable, because none of these URLs is real.
 */
export const SAMPLE_CATALOGUE: readonly CatalogueEntry[] = [
  ["en", "English", "English", "Americas", "2026-08-30", "wa-catalog", "en_ulb"],
  [
    "es-419",
    "Español Latinoamericano",
    "Latin American Spanish",
    "Americas",
    "2026-08-12",
    "wa-catalog",
    "es-419_gst",
  ],
  ["fr", "Français", "French", "Europe", "2026-07-28", "wa-catalog", "fr_ulb"],
  ["sw", "Kiswahili", "Swahili", "Africa", "2026-09-02", "wa-catalog", "sw_ulb"],
  ["hi", "हिन्दी", "Hindi", "South Asia", "2026-06-19", "wa-catalog", "hi_ulb"],
  ["id", "Bahasa Indonesia", "Indonesian", "Asia Pacific", "2026-05-30", "wa-catalog", "id_ayt"],
  ["bem", "Ichibemba", "Bemba", "Africa", "2026-09-09", "zambia-team", "bem_reg"],
  ["axd", "Yabaana", "Yabaana", "Asia Pacific", "2026-04-11", "png-team", "axd_reg"],
  ["ta", "தமிழ்", "Tamil", "South Asia", "2026-08-01", "india-team", "ta_reg"],
  ["ar", "العربية", "Arabic", "Middle East", "2026-07-05", "wa-catalog", "ar_ulb"],
  [
    "pt-BR",
    "Português do Brasil",
    "Brazilian Portuguese",
    "Americas",
    "2026-03-22",
    "brasil-team",
    "pt-br_reg",
  ],
  ["my", "မြန်မာဘာသာ", "Burmese", "Asia Pacific", "2026-02-14", "myanmar-team", "my_reg"],
].map(([code, naturalName, anglicizedName, region, updated, owner, repo]) => ({
  id: `${owner}/${repo}`,
  code,
  naturalName,
  anglicizedName,
  region,
  updated,
  type: typeOf(owner),
  owner,
  repo,
  // Deliberately empty: a sample row must not offer a download that would
  // clone a repository that does not exist.
  cloneUrl: "",
}));

export const sampleCatalogue = (): CatalogueService => ({
  source: "sample",
  origin: "sample data",
  entries: () => Promise.resolve(SAMPLE_CATALOGUE),
});

/**
 * The flag: a build that was given a Language API URL browses the real
 * catalogue, and a build that was not shows the sample so the screen is still
 * a screen. There is no third state — an unreachable API surfaces as the
 * table's own error line, not as a silent swap to samples.
 */
export const catalogueFor = (): CatalogueService =>
  env.languageApiUrl === null ? sampleCatalogue() : languageApiCatalogue(env.languageApiUrl);
