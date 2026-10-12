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
import type { BookCandidate, CandidateStatus } from "#core/migrate/candidate";
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
  /**
   * One language's single-book repositories — Writer projects — as book
   * candidates, one per whole-book USFM rendering. The consolidated
   * repository is left out: it is what a migration makes.
   */
  readonly writerBooks: (language: string) => Promise<readonly BookCandidate[]>;
  /**
   * The languages with Writer projects whose code or name contains `search`,
   * one row each. The search runs on the server: every language at once is
   * thousands of rows, so the screen asks only once two letters are typed.
   */
  readonly writerLanguages: (search: string) => Promise<readonly WriterLanguage[]>;
}

/** One language with single-book Writer projects on WACS. */
export interface WriterLanguage {
  readonly code: string;
  readonly naturalName: string;
  readonly anglicizedName: string;
  readonly region: string | undefined;
  /** How many Writer projects (one book each, almost always). */
  readonly projects: number;
  /** The newest change across them. */
  readonly updated: string | undefined;
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

/** One `content` row of a language's single-book repositories. */
const WriterContent = Schema.Struct({
  modified_on: Schema.NullOr(Schema.String),
  resource_type: Schema.NullOr(Schema.String),
  wa_content_metadata: Schema.NullOr(Schema.Struct({ status: Schema.NullOr(Schema.String) })),
  git_repo: Schema.NullOr(Schema.Struct({ username: Schema.String, repo_url: Schema.String })),
  rendered_contents: Schema.Array(
    Schema.Struct({
      scriptural_rendering_metadata: Schema.NullOr(
        Schema.Struct({ book_slug: Schema.NullOr(Schema.String) }),
      ),
    }),
  ),
});

const WriterBooks = Schema.Struct({
  data: Schema.Struct({ content: Schema.Array(WriterContent) }),
});

const decodeWriterBooks = Schema.decodeUnknownResult(WriterBooks);

/**
 * The renderings are filtered INSIDE the query, so one small answer (38 KB
 * for all of `bwc`, probed 2026-10-02) carries each repository's book.
 */
const WRITER_BOOKS_QUERY = `query ($lang: String!) {
  content(where: {
    language: { ietf_code: { _eq: $lang } }
    git_repo: { _not: { topics: { topic: { name: { _eq: "consolidated" } } } } }
  }) {
    modified_on resource_type
    wa_content_metadata { status }
    git_repo { username repo_url }
    rendered_contents(where: {
      file_type: { _eq: "usfm" }
      scriptural_rendering_metadata: { is_whole_book: { _eq: true } }
    }) { scriptural_rendering_metadata { book_slug } }
  }
}`;

/** What a Writer project is, as a `content` filter: one whole-book USFM, not consolidated. */
const WRITER_CONTENT = `{
  git_repo: { _not: { topics: { topic: { name: { _eq: "consolidated" } } } } }
  rendered_contents: {
    file_type: { _eq: "usfm" }
    scriptural_rendering_metadata: { is_whole_book: { _eq: true } }
  }
}`;

/**
 * Counted on the server (`contents_aggregate`): the rows themselves are 37,000
 * for a one-letter search, and only the count and the newest date are drawn.
 * Alternate names are searched too, as the WACS table does.
 */
const WRITER_LANGUAGES_QUERY = `query ($s: String!) {
  language(where: { _and: [
    { _or: [
      { ietf_code: { _ilike: $s } }
      { english_name: { _ilike: $s } }
      { national_name: { _ilike: $s } }
      { language_alternate_names: { name: { _ilike: $s } } }
    ] }
    { contents: ${WRITER_CONTENT} }
  ] }) {
    ietf_code english_name national_name
    contents_aggregate(where: ${WRITER_CONTENT}) { aggregate { count max { modified_on } } }
  }
}`;

const WriterLanguages = Schema.Struct({
  data: Schema.Struct({
    language: Schema.Array(
      Schema.Struct({
        ietf_code: Schema.String,
        english_name: Schema.NullOr(Schema.String),
        national_name: Schema.NullOr(Schema.String),
        contents_aggregate: Schema.Struct({
          aggregate: Schema.NullOr(
            Schema.Struct({
              count: Schema.Number,
              max: Schema.NullOr(Schema.Struct({ modified_on: Schema.NullOr(Schema.String) })),
            }),
          ),
        }),
      }),
    ),
  }),
});

const decodeWriterLanguages = Schema.decodeUnknownResult(WriterLanguages);

const REGIONS_QUERY = `query ($codes: [String!]) { vw_langnames(where: { lc: { _in: $codes } }) { lc lr } }`;

const Regions = Schema.Struct({
  data: Schema.Struct({
    vw_langnames: Schema.Array(
      Schema.Struct({ lc: Schema.String, lr: Schema.NullOr(Schema.String) }),
    ),
  }),
});

const decodeRegions = Schema.decodeUnknownResult(Regions);

const STATUSES: readonly CandidateStatus[] = ["Primary", "Active", "Inactive"];

/**
 * `resource_type` is noisy (empty for some `reg` repositories), so the
 * repository's own name decides when it ends `_text_<resource>`.
 */
const resourceOf = (repo: string, declared: string | null): string =>
  /_text_([a-z0-9-]+)$/i.exec(repo)?.[1]?.toLowerCase() ??
  (declared === null || declared.trim() === "" ? "reg" : declared.trim().toLowerCase());

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
  writerBooks: async (language) => {
    const decoded = decodeWriterBooks(
      await graphql(origin, WRITER_BOOKS_QUERY, { lang: language.trim() }),
    );
    if (Result.isFailure(decoded))
      throw new CatalogueError(
        `Language API payload not understood: ${decoded.failure.message}`,
        "payload",
      );
    return decoded.success.data.content.flatMap((row): BookCandidate[] => {
      if (row.git_repo === null) return [];
      const url = row.git_repo.repo_url;
      const repo = url.replace(/\/+$/, "").split("/").at(-1) ?? "";
      const status = STATUSES.find((each) => each === row.wa_content_metadata?.status);
      return row.rendered_contents.flatMap((rendering) => {
        const book = rendering.scriptural_rendering_metadata?.book_slug?.toUpperCase();
        if (book === undefined || book === "") return [];
        return [
          {
            id: `remote:${url}:${book}`,
            book,
            language: language.trim().toLowerCase(),
            resource: resourceOf(repo, row.resource_type),
            origin: { kind: "remote", owner: row.git_repo?.username ?? "", repo, url },
            hints: {
              ...(status === undefined ? {} : { status }),
              ...(row.modified_on === null ? {} : { modified: row.modified_on }),
            },
          },
        ];
      });
    });
  },
  writerLanguages: async (search) => {
    const decoded = decodeWriterLanguages(
      await graphql(origin, WRITER_LANGUAGES_QUERY, { s: `%${search.trim()}%` }),
    );
    if (Result.isFailure(decoded))
      throw new CatalogueError(
        `Language API payload not understood: ${decoded.failure.message}`,
        "payload",
      );
    const languages = decoded.success.data.language;
    // Regions are a second request, as for the WACS table; without them the
    // rows still draw.
    const regions = await graphql(origin, REGIONS_QUERY, {
      codes: languages.map((language) => language.ietf_code),
    })
      .then((body) => decodeRegions(body))
      .catch(() => undefined);
    const regionOf = new Map(
      regions !== undefined && Result.isSuccess(regions)
        ? regions.success.data.vw_langnames.map((row) => [row.lc.toLowerCase(), row.lr])
        : [],
    );
    return languages.map((language) => {
      const english = language.english_name ?? "";
      const natural = language.national_name ?? "";
      return {
        code: language.ietf_code,
        naturalName: natural === "" ? english : natural,
        anglicizedName: english === "" ? natural : english,
        region: blankToUndefined(regionOf.get(language.ietf_code.toLowerCase())),
        projects: language.contents_aggregate.aggregate?.count ?? 0,
        updated: blankToUndefined(language.contents_aggregate.aggregate?.max?.modified_on),
      };
    });
  },
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
  // Sample rows clone nothing, so they offer no books either.
  writerBooks: () => Promise.resolve([]),
  writerLanguages: () => Promise.resolve([]),
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

/**
 * One text per gateway language, A–Z by English name: what the reference
 * column offers to download. WA publishes them under `wa-catalog`; where it
 * has several in one language, the ULB is the one a translator reads from.
 */
/** Reference material to download, where the catalogue lists none. */
export interface HelpText {
  /** What the menu says: "Translation Notes". */
  readonly title: string;
  /** Its language's tag. */
  readonly language: string;
  /** Where it is on the content host, `Owner/repo`. */
  readonly repository: string;
}

/**
 * The helps Sefer can read, by repository, because the Language API's view
 * has no rows for them (plan §6, "Catalogue gap"): a second source, stated
 * here and nowhere else, until the API lists them. WA's canonical `en_tn`,
 * not `en_tn_condensed`.
 */
export const HELP_TEXTS: readonly HelpText[] = [
  { title: "Translation Notes", language: "en", repository: "WycliffeAssociates/en_tn" },
];

export const gatewayTexts = (rows: readonly CatalogueEntry[]): readonly CatalogueEntry[] => {
  const ulb = (entry: CatalogueEntry): boolean => /_ulb$/iu.test(entry.repo);
  const best = new Map<string, CatalogueEntry>();
  for (const row of rows) {
    if (row.type !== "gateway" || row.owner.toLowerCase() !== "wa-catalog" || row.gitUrl === "")
      continue;
    const held = best.get(row.code);
    if (held === undefined || (!ulb(held) && ulb(row))) best.set(row.code, row);
  }
  return [...best.values()].sort((a, b) =>
    (a.anglicizedName || a.naturalName).localeCompare(b.anglicizedName || b.naturalName),
  );
};
