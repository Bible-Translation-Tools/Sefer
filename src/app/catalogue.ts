/**
 * The Catalogue: the list of projects that exist SOMEWHERE ELSE and could be
 * brought here — for each, a language and the git URL of its repository.
 *
 * It is a port in `src/app` rather than a module in `src/core` because it is
 * not policy — it is two requests against a service Sefer does not own, and
 * core may not name `fetch`. Nothing in `src/core` asks a question this answers.
 *
 * The live source is the Language API's GraphQL endpoint
 * (`VITE_SEFER_CATALOGUE_URL`; see `src/app/env.ts`), prod and dev alike. A
 * build with no URL configured falls back to `SAMPLE_CATALOGUE` so the screen
 * is real in development instead of empty — `catalogueFor` is the one place
 * that decides which, and it says which one it gave you in `source`.
 *
 * A row's git URL names its own server, and that need not be this build's
 * content host: the dev catalogue lists repositories on the production host as
 * well as the dev one. How a browser reaches either is the transport's
 * business (`src/core/remote/transport.ts`), not this file's.
 *
 * ## Two requests, one API
 *
 * The designer's mockup asks for four columns: Code, Language, Region, Date.
 * `vw_consolidated_repos` carries the first two and the repository. The same
 * API holds the rest — `vw_langnames` (region, alternate names, gateway) and
 * `content.modified_on` (the date) — so a second query asks for exactly the
 * codes and content ids the first returned. It is a second REQUEST because
 * GraphQL cannot feed one root field's answer into another's filter; it is not
 * a second service. If it fails the table still draws, without regions,
 * alternates or dates, and the browse records that it was not enriched.
 */

import { Result, Schema } from "effect";

import type { SettingsService } from "#core/host/settings";
import type { Attrs, Verdict } from "#core/observability";

import { catalogueUrlFor } from "./endpoints";

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
  /** The language's world region, from `vw_langnames`. */
  readonly region: string | undefined;
  /** ISO-8601 date the catalogue last saw the content change. */
  readonly updated: string | undefined;
  readonly type: ProjectType;
  readonly owner: string;
  readonly repo: string;
  /**
   * Where the repository lives: its git URL, on its own server. What
   * `Download` clones. Empty when the row names no repository.
   */
  readonly gitUrl: string;
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

/** One read of the catalogue. `enriched` is false when the second query failed. */
export interface CatalogueRead {
  readonly rows: readonly CatalogueEntry[];
  readonly enriched: boolean;
}

export interface CatalogueService {
  /** Which rows these are, so a screen can say "sample data" rather than lie. */
  readonly source: "live" | "sample";
  /** The endpoint, for the screen's provenance line. */
  readonly origin: string;
  readonly entries: () => Promise<CatalogueRead>;
}

/**
 * The live responses, decoded rather than asserted. Unknown keys are dropped,
 * and a nullable field is a fact about the payload, not a failure: one row
 * without a title must not lose the other six hundred.
 */
const ConsolidatedRepo = Schema.Struct({
  content_id: Schema.NullOr(Schema.String),
  language_ietf: Schema.String,
  language_name: Schema.String,
  language_english_name: Schema.String,
  repo_url: Schema.String,
  repo_name: Schema.String,
  username: Schema.String,
});

const Repos = Schema.Struct({
  data: Schema.Struct({ vw_consolidated_repos: Schema.Array(ConsolidatedRepo) }),
});

const LangName = Schema.Struct({
  lc: Schema.String,
  lr: Schema.NullOr(Schema.String),
  gw: Schema.NullOr(Schema.Boolean),
  alt: Schema.NullOr(Schema.Array(Schema.String)),
});

const Content = Schema.Struct({ id: Schema.String, modified_on: Schema.NullOr(Schema.String) });

const Facts = Schema.Struct({
  data: Schema.Struct({ vw_langnames: Schema.Array(LangName), content: Schema.Array(Content) }),
});

const decodeRepos = Schema.decodeUnknownResult(Repos);
const decodeFacts = Schema.decodeUnknownResult(Facts);

type LangNameFacts = typeof LangName.Type;

const REPOS_QUERY = `{ vw_consolidated_repos {
  content_id language_ietf language_name language_english_name repo_url repo_name username
} }`;

const FACTS_QUERY = `query ($codes: [String!], $ids: [String!]) {
  vw_langnames(where: { lc: { _in: $codes } }) { lc lr gw alt }
  content(where: { id: { _in: $ids } }) { id modified_on }
}`;

/** One GraphQL POST. A non-2xx is `http`; GraphQL's own `errors` are `payload`. */
const graphql = async (
  origin: string,
  query: string,
  variables?: Readonly<Record<string, unknown>>,
): Promise<unknown> => {
  const response = await fetch(origin, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });
  if (!response.ok)
    throw new CatalogueError(`Language API error: ${response.status}`, "http", response.status);
  return response.json();
};

/** The fallback owner→type mapping, used when langnames did not answer. */
const typeOf = (owner: string): ProjectType =>
  owner.toLowerCase() === "wa-catalog" ? "gateway" : "translation";

const blankToUndefined = (value: string | null | undefined): string | undefined =>
  value === null || value === undefined || value.trim() === "" ? undefined : value;

const toEntry = (
  repo: typeof ConsolidatedRepo.Type,
  facts: LangNameFacts | undefined,
  updated: string | undefined,
): CatalogueEntry => ({
  id: `${repo.username}/${repo.repo_name}`,
  code: repo.language_ietf,
  naturalName: repo.language_name === "" ? repo.language_english_name : repo.language_name,
  anglicizedName:
    repo.language_english_name === "" ? repo.language_name : repo.language_english_name,
  alternateNames: facts?.alt ?? [],
  region: blankToUndefined(facts?.lr),
  updated,
  type:
    facts?.gw === undefined || facts.gw === null
      ? typeOf(repo.username)
      : facts.gw
        ? "gateway"
        : "translation",
  owner: repo.username,
  repo: repo.repo_name,
  gitUrl: repo.repo_url,
});

/**
 * The Language API implementation: the repositories, then the facts about
 * exactly those. No auth, no paging — the whole view arrives at once, which is
 * why the table sorts and filters in memory.
 */
const languageApiCatalogue = (origin: string): CatalogueService => ({
  source: "live",
  origin,
  entries: async () => {
    const decoded = decodeRepos(await graphql(origin, REPOS_QUERY));
    if (Result.isFailure(decoded))
      throw new CatalogueError(
        `Language API payload not understood: ${decoded.failure.message}`,
        "payload",
      );
    const repos = decoded.success.data.vw_consolidated_repos;

    const facts = await graphql(origin, FACTS_QUERY, {
      codes: [...new Set(repos.map((repo) => repo.language_ietf))],
      ids: repos.flatMap((repo) => (repo.content_id === null ? [] : [repo.content_id])),
    })
      .then((body) => decodeFacts(body))
      .catch(() => undefined);
    const known = facts !== undefined && Result.isSuccess(facts) ? facts.success.data : undefined;
    const names = new Map(known?.vw_langnames.map((row) => [row.lc.toLowerCase(), row]));
    const dates = new Map(known?.content.map((row) => [row.id, row.modified_on]));

    return {
      rows: repos.map((repo) =>
        toEntry(
          repo,
          names.get(repo.language_ietf.toLowerCase()),
          blankToUndefined(repo.content_id === null ? undefined : dates.get(repo.content_id)),
        ),
      ),
      enriched: known !== undefined,
    };
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
  gitUrl: "",
  alternateNames: [],
}));

const sampleCatalogue = (): CatalogueService => ({
  source: "sample",
  origin: "sample data",
  entries: () => Promise.resolve({ rows: SAMPLE_CATALOGUE, enriched: true }),
});

/**
 * The flag: a build that was given a catalogue URL browses the real
 * catalogue, and a build that was not shows the sample so the screen is still
 * a screen. There is no third state — an unreachable API surfaces as the
 * table's own error line, not as a silent swap to samples.
 */
export const catalogueFor = (settings: SettingsService): CatalogueService => {
  const url = catalogueUrlFor(settings);
  return url === null ? sampleCatalogue() : languageApiCatalogue(url);
};
