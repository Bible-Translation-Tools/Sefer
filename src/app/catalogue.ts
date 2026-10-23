import { Result, Schema } from "effect";

import type { SettingsService } from "#core/host/settings";
import type { BookCandidate, CandidateStatus } from "#core/migrate/candidate";
import type { Attrs, Verdict } from "#core/observability";

import { catalogueUrlFor } from "./endpoints";

export type ProjectType = "translation" | "gateway";

export interface CatalogueEntry {
  readonly id: string;
  readonly code: string;
  readonly naturalName: string;
  readonly anglicizedName: string;
  readonly alternateNames: readonly string[];
  readonly region: string | undefined;
  readonly updated: string | undefined;
  readonly type: ProjectType;
  readonly owner: string;
  readonly repo: string;
  readonly gitUrl: string;
}

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

export const catalogueVerdict = (cause: unknown): Verdict => {
  if (cause instanceof CatalogueError) return cause.failure === "http" ? "unavailable" : "failed";
  return cause instanceof TypeError ? "unavailable" : "failed";
};

export const catalogueFailureAttrs = (cause: unknown): Attrs => {
  if (!(cause instanceof CatalogueError))
    return { "catalogue.failure": cause instanceof TypeError ? "network" : "unknown" };
  return {
    "catalogue.failure": cause.failure,
    ...(cause.httpStatus === undefined ? {} : { "http.status": cause.httpStatus }),
  };
};

export interface CatalogueRead {
  readonly rows: readonly CatalogueEntry[];
  readonly enriched: boolean;
}

export interface CatalogueService {
  readonly source: "live" | "sample";
  readonly origin: string;
  readonly entries: () => Promise<CatalogueRead>;
  readonly writerBooks: (language: string) => Promise<readonly BookCandidate[]>;
  readonly writerLanguages: () => Promise<readonly WriterLanguage[]>;
}

/** A text the Language API lists for download: WA's Translation Notes, or a gateway language's Bible. */
export interface ListedText {
  readonly title: string;
  readonly language: string;
  readonly languageName: string;
  readonly nationalName: string;
  readonly direction: "ltr" | "rtl";
  readonly repository: string;
  readonly url: string;
}

export interface WriterLanguage {
  readonly code: string;
  readonly naturalName: string;
  readonly anglicizedName: string;
  readonly region: string | undefined;
}

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

const WRITER_CONTENT = `{
  git_repo: { _not: { topics: { topic: { name: { _eq: "consolidated" } } } } }
  rendered_contents: {
    file_type: { _eq: "usfm" }
    scriptural_rendering_metadata: { is_whole_book: { _eq: true } }
  }
}`;

/**
 * Every language with Writer projects, names only: 1,731 languages, ~133 KB, ~1.6 s
 * (probed 2026-10-23). Each language's project count and last update
 * (`contents_aggregate`) took the same list to ~21 s, so they are not asked for;
 * the count comes once a language is picked (`writerBooks`).
 */
const WRITER_LANGUAGES_QUERY = `{
  language(where: { contents: ${WRITER_CONTENT} }) { ietf_code english_name national_name }
}`;

const WriterLanguages = Schema.Struct({
  data: Schema.Struct({
    language: Schema.Array(
      Schema.Struct({
        ietf_code: Schema.String,
        english_name: Schema.NullOr(Schema.String),
        national_name: Schema.NullOr(Schema.String),
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

/**
 * WA-Catalog's own repositories of one resource type, with each language's
 * names. `gatewaysOnly` keeps the official gateway languages: the source texts
 * a project may read from are those and nothing else, not the dozen other
 * English ULBs a search for "English" turns up (the PO, 2026-10-22).
 */
const listedQuery = (type: string, gatewaysOnly: boolean): string => `{
  content(where: {
    resource_type: { _eq: "${type}" }
    git_repo: { username: { _eq: "WA-Catalog" } }${
      gatewaysOnly ? "\n    language: { wa_language_metadata: { is_gateway: { _eq: true } } }" : ""
    }
  }) {
    language { ietf_code english_name national_name direction }
    git_repo { username repo_name repo_url }
  }
}`;

const Listed = Schema.Struct({
  data: Schema.Struct({
    content: Schema.Array(
      Schema.Struct({
        language: Schema.NullOr(
          Schema.Struct({
            ietf_code: Schema.String,
            english_name: Schema.NullOr(Schema.String),
            national_name: Schema.NullOr(Schema.String),
            direction: Schema.NullOr(Schema.String),
          }),
        ),
        git_repo: Schema.NullOr(
          Schema.Struct({
            username: Schema.String,
            repo_name: Schema.String,
            repo_url: Schema.String,
          }),
        ),
      }),
    ),
  }),
});

const decodeListed = Schema.decodeUnknownResult(Listed);

const STATUSES: readonly CandidateStatus[] = ["Primary", "Active", "Inactive"];

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

const typeOf = (owner: string): ProjectType =>
  owner.toLowerCase() === "wa-catalog" ? "gateway" : "translation";

const entryType = (
  repo: typeof ConsolidatedRepo.Type,
  facts: LangNameFacts | undefined,
): ProjectType => {
  if (facts?.gw === undefined || facts.gw === null) return typeOf(repo.username);
  return facts.gw ? "gateway" : "translation";
};

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
  type: entryType(repo, facts),
  owner: repo.username,
  repo: repo.repo_name,
  gitUrl: repo.repo_url,
});

const writerBooksOf = async (origin: string, language: string) => {
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
};

const writerLanguagesOf = async (origin: string) => {
  const decoded = decodeWriterLanguages(await graphql(origin, WRITER_LANGUAGES_QUERY));
  if (Result.isFailure(decoded))
    throw new CatalogueError(
      `Language API payload not understood: ${decoded.failure.message}`,
      "payload",
    );
  const languages = decoded.success.data.language;
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
    };
  });
};

const entriesOf = async (origin: string) => {
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
};

const languageApiCatalogue = (origin: string): CatalogueService => ({
  source: "live",
  origin,
  writerBooks: (language) => writerBooksOf(origin, language),
  writerLanguages: () => writerLanguagesOf(origin),
  entries: () => entriesOf(origin),
});

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
  gitUrl: "",
  alternateNames: [],
}));

const sampleCatalogue = (): CatalogueService => ({
  source: "sample",
  origin: "sample data",
  entries: () => Promise.resolve({ rows: SAMPLE_CATALOGUE, enriched: true }),
  writerBooks: () => Promise.resolve([]),
  writerLanguages: () => Promise.resolve([]),
});

const LANGUAGE_API = "https://api.bibleineverylanguage.org/v1/graphql";

const listed = async (
  type: string,
  gatewaysOnly: boolean,
  titleOf: (repo: string) => string,
): Promise<readonly ListedText[]> => {
  const decoded = decodeListed(await graphql(LANGUAGE_API, listedQuery(type, gatewaysOnly)));
  if (Result.isFailure(decoded))
    throw new CatalogueError(
      `Language API payload not understood: ${decoded.failure.message}`,
      "payload",
    );
  const rows = decoded.success.data.content.flatMap((row): ListedText[] => {
    if (row.language === null || row.git_repo === null || row.git_repo.repo_url === "") return [];
    const english = row.language.english_name ?? "";
    const national = row.language.national_name ?? "";
    return [
      {
        title: titleOf(row.git_repo.repo_name),
        language: row.language.ietf_code,
        languageName: english === "" ? national : english,
        nationalName: national,
        direction: row.language.direction === "rtl" ? "rtl" : "ltr",
        repository: `${row.git_repo.username}/${row.git_repo.repo_name}`,
        url: row.git_repo.repo_url,
      },
    ];
  });
  return rows.sort((a, b) =>
    (a.languageName || a.language).localeCompare(b.languageName || b.language),
  );
};

export const listTranslationNotes = (): Promise<readonly ListedText[]> =>
  listed("tn", false, () => "Translation Notes");

/**
 * The gateway languages' Bibles in WA's catalogue, titled by the repository's
 * last part: "ULB" mostly, "OPV" and "NMV" for Persian, which has no ULB.
 */
export const listSourceTexts = (): Promise<readonly ListedText[]> =>
  listed("ulb", true, (repo) => (/_([^_]+)$/u.exec(repo)?.[1] ?? repo).toUpperCase());

export const catalogueFor = (settings: SettingsService): CatalogueService => {
  const url = catalogueUrlFor(settings);
  return url === null ? sampleCatalogue() : languageApiCatalogue(url);
};
