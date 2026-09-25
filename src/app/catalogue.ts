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
 * So the live catalogue joins two more public sources, both of which answer a
 * browser (`access-control-allow-origin: *`):
 *
 *  - **langnames** (`LANGNAMES_URL`), the translationDatabase export: per
 *    language code, its region (`lr`, a continent), its alternate names
 *    (`alt`) and whether it is a gateway language (`gw`). Fetched beside the
 *    repos; if it fails the table still draws, without regions or alternates,
 *    and gateway falls back to the owner (`wa-catalog`).
 *
 * Dates are still absent. Asking the content server for each repo's
 * `updated_at` was tried and dropped: ~280 requests per page view, and the
 * server rate-limits (HTTP 429) long before the table is filled. The right
 * source is an `updated_at` on the consolidated-repos view itself, which the
 * decoder already reads.
 */

import { Result, Schema } from "effect";

import type { SettingsService } from "#core/host/settings";
import type { Attrs, Verdict } from "#core/observability";

import { languageApiUrlFrom } from "./endpoints";

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
  /** Every other name the language is known by; searched, never drawn. */
  readonly alternateNames: readonly string[];
  /** The language's continent, from langnames — see the file header. */
  readonly region: string | undefined;
  /** ISO-8601 date, absent in the live payload today. */
  readonly updated: string | undefined;
  readonly type: ProjectType;
  readonly owner: string;
  readonly repo: string;
  /** What `Download` clones. Empty when the row names no repository. */
  readonly cloneUrl: string;
}

/**
 * `http` — the Language API answered, but not with a 2xx.
 * `payload` — it answered 200 with something the decoder does not understand.
 *
 * Deliberately not called `reason` or `status`: `describe` renders those two
 * fields in place of the message, and the sentence on screen must not change
 * because telemetry learned to tell the failures apart.
 */
type CatalogueFailure = "http" | "payload";

class CatalogueError extends Error {
  override readonly name = "CatalogueError";
  constructor(
    message: string,
    readonly failure: CatalogueFailure,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}

/**
 * How a failed browse is recorded. The Language API is an outside boundary:
 * a server that answered badly, or did not answer at all (`fetch` rejects
 * with a `TypeError` when offline or refused by CORS), is `unavailable`. A
 * payload the decoder cannot read, or anything else, stays `failed` — that is
 * a contract broken, and worth the alarm.
 */
export const catalogueVerdict = (cause: unknown): Verdict => {
  if (cause instanceof CatalogueError) return cause.failure === "http" ? "unavailable" : "failed";
  return cause instanceof TypeError ? "unavailable" : "failed";
};

/** The fields a failed browse carries: which failure, and the HTTP status when there was one. */
export const catalogueFailureAttrs = (cause: unknown): Attrs => {
  if (!(cause instanceof CatalogueError))
    return { "catalogue.failure": cause instanceof TypeError ? "network" : "unknown" };
  return {
    "catalogue.failure": cause.failure,
    ...(cause.httpStatus === undefined ? {} : { "http.status": cause.httpStatus }),
  };
};

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

/** The fallback owner→type mapping, used when langnames did not answer. */
const typeOf = (owner: string): ProjectType =>
  owner.toLowerCase() === "wa-catalog" ? "gateway" : "translation";

/** The translationDatabase language export. Public, and CORS-open. */
const LANGNAMES_URL = "https://td.unfoldingword.org/exports/langnames.json";

const LangName = Schema.Struct({
  lc: Schema.String,
  lr: Schema.optionalKey(Schema.NullOr(Schema.String)),
  gw: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  alt: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
});

const decodeLangNames = Schema.decodeUnknownResult(Schema.Array(LangName));

type LangNameFacts = typeof LangName.Type;

/** langnames keyed by lower-cased code; empty when it could not be read. */
const langNames = async (): Promise<ReadonlyMap<string, LangNameFacts>> => {
  try {
    const response = await fetch(LANGNAMES_URL, { headers: { accept: "application/json" } });
    if (!response.ok) return new Map();
    const decoded = decodeLangNames(await response.json());
    if (Result.isFailure(decoded)) return new Map();
    return new Map(decoded.success.map((row) => [row.lc.toLowerCase(), row]));
  } catch {
    return new Map();
  }
};

const blankToUndefined = (value: string | null | undefined): string | undefined =>
  value === null || value === undefined || value.trim() === "" ? undefined : value;

const toEntry = (
  repo: typeof ConsolidatedRepo.Type,
  facts: LangNameFacts | undefined,
): CatalogueEntry => ({
  id: `${repo.username}/${repo.repo_name}`,
  code: repo.language_ietf,
  naturalName: repo.language_name === "" ? repo.language_english_name : repo.language_name,
  anglicizedName:
    repo.language_english_name === "" ? repo.language_name : repo.language_english_name,
  alternateNames: facts?.alt ?? [],
  region: blankToUndefined(repo.region) ?? blankToUndefined(facts?.lr),
  updated: blankToUndefined(repo.updated_at),
  type:
    facts?.gw === undefined || facts.gw === null
      ? typeOf(repo.username)
      : facts.gw
        ? "gateway"
        : "translation",
  owner: repo.username,
  repo: repo.repo_name,
  cloneUrl: repo.repo_url,
});

/**
 * The Language API implementation. One GET, no auth, no paging — the whole view
 * arrives at once, which is why the table sorts and filters in memory.
 */
const languageApiCatalogue = (origin: string): CatalogueService => ({
  source: "live",
  origin,
  entries: async () => {
    const [response, names] = await Promise.all([
      fetch(origin, { headers: { accept: "application/json" } }),
      langNames(),
    ]);
    if (!response.ok)
      throw new CatalogueError(`Language API error: ${response.status}`, "http", response.status);
    const decoded = decodeRepos(await response.json());
    if (Result.isFailure(decoded))
      throw new CatalogueError(
        `Language API payload not understood: ${decoded.failure.message}`,
        "payload",
      );
    return decoded.success.vw_consolidated_repos.map((repo) =>
      toEntry(repo, names.get(repo.language_ietf.toLowerCase())),
    );
  },
});

/**
 * Twelve rows that carry every column the mockup draws, so the screen can be
 * built and looked at without a network. They are SAMPLE data and the table
 * says so; nothing here is downloadable, because none of these URLs is real.
 */
const SAMPLE_CATALOGUE: readonly CatalogueEntry[] = [
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
  alternateNames: [],
}));

const sampleCatalogue = (): CatalogueService => ({
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
export const catalogueFor = (settings: SettingsService): CatalogueService => {
  const url = languageApiUrlFrom(settings);
  return url === null ? sampleCatalogue() : languageApiCatalogue(url);
};
