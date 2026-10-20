import { Context, Data, Effect, Layer, Option, Schema } from "effect";

import { Credentials, type Credential, type CredentialsService } from "../host/credentials";

export interface Session {
  readonly host: string;
  readonly username: string;
  readonly token: string;
  readonly tokenName: string;
  readonly tokenId: string;
}

export interface RemoteRepo {
  readonly owner: string;
  readonly name: string;
  readonly fullName: string;
  readonly cloneUrl: string;
  readonly defaultBranch: string;
  readonly private: boolean;
  readonly canWrite: boolean;
  readonly parent: ForkParent | undefined;
}

export interface ForkParent {
  readonly owner: string;
  readonly name: string;
  readonly fullName: string;
  readonly cloneUrl: string;
}

export interface CreateRepoRequest {
  readonly name: string;
  readonly description?: string | undefined;
  readonly private?: boolean | undefined;
}

export type GiteaFailureReason = "Unauthorized" | "OtpRequired" | "Network" | "Refused" | "Io";

export class GiteaError extends Data.TaggedError("GiteaError")<{
  readonly reason: GiteaFailureReason;
  readonly description?: string | undefined;
}> {}

export interface HttpRequest {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { readonly get: (name: string) => string | null };
  readonly text: () => Promise<string>;
  readonly json: () => Promise<unknown>;
}

export type HttpFetch = (input: string, init?: HttpRequest) => Promise<HttpResponse>;

export interface GiteaService {
  readonly login: (args: {
    readonly host: string;
    readonly username: string;
    readonly password: string;
    readonly otp?: string | undefined;
  }) => Effect.Effect<Session, GiteaError>;
  /** The token is left alive: Gitea's token endpoints refuse token auth, so revoking needs the password. */
  readonly logout: (host: string) => Effect.Effect<void>;
  readonly session: (host: string) => Effect.Effect<Option.Option<Session>>;
  readonly listWritableRepos: (
    host: string,
    search?: string,
  ) => Effect.Effect<readonly RemoteRepo[], GiteaError>;
  readonly listOwnedRepos: (host: string) => Effect.Effect<readonly RemoteRepo[], GiteaError>;
  readonly createRepo: (
    host: string,
    request: CreateRepoRequest,
  ) => Effect.Effect<RemoteRepo, GiteaError>;
  readonly getRepo: (
    host: string,
    owner: string,
    name: string,
  ) => Effect.Effect<Option.Option<RemoteRepo>, GiteaError>;
  readonly listForks: (
    host: string,
    owner: string,
    name: string,
  ) => Effect.Effect<readonly RemoteRepo[], GiteaError>;
  readonly forkRepo: (
    host: string,
    owner: string,
    name: string,
    as?: string,
  ) => Effect.Effect<RemoteRepo, GiteaError>;
}

export class Gitea extends Context.Service<Gitea, GiteaService>()("Gitea") {}

const SESSION_TOKEN_SCOPES: readonly string[] = [
  "read:activitypub",
  "write:issue",
  "write:misc",
  "read:notification",
  "read:organization",
  "read:package",
  "write:repository",
  "write:user",
];

const PAGE_SIZE = 50;
const FORK_PAGES = 10;

// Every field is optional because Gitea's records vary by version and by endpoint.
const NumberOrString = Schema.Union([Schema.Number, Schema.String]);

const CreatedToken = Schema.Struct({
  id: NumberOrString,
  name: Schema.String,
  sha1: Schema.String,
});

const RepoOwner = Schema.Struct({
  login: Schema.optionalKey(Schema.String),
  username: Schema.optionalKey(Schema.String),
});

const RepoPermissions = Schema.Struct({
  admin: Schema.optionalKey(Schema.Boolean),
  push: Schema.optionalKey(Schema.Boolean),
});

const ParentRecord = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  full_name: Schema.optionalKey(Schema.String),
  clone_url: Schema.optionalKey(Schema.String),
  owner: Schema.optionalKey(RepoOwner),
});

const RepoRecord = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  full_name: Schema.optionalKey(Schema.String),
  clone_url: Schema.optionalKey(Schema.String),
  html_url: Schema.optionalKey(Schema.String),
  default_branch: Schema.optionalKey(Schema.String),
  private: Schema.optionalKey(Schema.Boolean),
  owner: Schema.optionalKey(RepoOwner),
  permissions: Schema.optionalKey(RepoPermissions),
  fork: Schema.optionalKey(Schema.Boolean),
  parent: Schema.optionalKey(Schema.NullOr(ParentRecord)),
});

const RepoArray = Schema.Array(RepoRecord);
const RepoSearch = Schema.Struct({ data: Schema.optionalKey(Schema.Array(RepoRecord)) });

const CurrentUser = Schema.Struct({ id: NumberOrString });

const decodeCreatedToken = Schema.decodeUnknownResult(CreatedToken);
const decodeRepoRecord = Schema.decodeUnknownResult(RepoRecord);
const decodeRepoArray = Schema.decodeUnknownResult(RepoArray);
const decodeRepoSearch = Schema.decodeUnknownResult(RepoSearch);
const decodeCurrentUser = Schema.decodeUnknownResult(CurrentUser);

type RepoRecordValue = typeof RepoRecord.Type;

const failed = (reason: GiteaFailureReason, description: string): GiteaError =>
  new GiteaError({ reason, description });

const normaliseHost = (host: string): string => host.trim().replace(/\/+$/u, "");

const url = (host: string, path: string, query?: Readonly<Record<string, string>>): string => {
  const search =
    query === undefined
      ? ""
      : `?${Object.entries(query)
          .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
          .join("&")}`;
  return `${normaliseHost(host)}${path}${search}`;
};

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const base64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const firstByte = bytes[index] ?? 0;
    const secondByte = bytes[index + 1] ?? 0;
    const thirdByte = bytes[index + 2] ?? 0;
    const remaining = bytes.length - index;
    out += ALPHABET[firstByte >> 2] ?? "";
    out += ALPHABET[((firstByte & 0x03) << 4) | (secondByte >> 4)] ?? "";
    out += remaining > 1 ? (ALPHABET[((secondByte & 0x0f) << 2) | (thirdByte >> 6)] ?? "") : "=";
    out += remaining > 2 ? (ALPHABET[thirdByte & 0x3f] ?? "") : "=";
  }
  return out;
};

/**
 * Gitea signals "your password was fine, now the second factor" with a 401
 * that mentions OTP — as a response header on some versions and only in the
 * body on others. Both are checked, because getting this wrong tells a
 * two-factor user their password is wrong.
 */
const otpWanted = (response: HttpResponse, body: string): boolean =>
  response.headers.get("x-gitea-otp") !== null || /otp|one[- ]time|two[- ]factor/iu.test(body);

/**
 * `20260915T124233` — the moment the token was minted, to the second. Gitea
 * refuses a token whose NAME already exists (`400 access token name has been
 * used already`).
 */
const stamp = (at: Date = new Date()): string => {
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  return [
    pad(at.getUTCFullYear(), 4),
    pad(at.getUTCMonth() + 1),
    pad(at.getUTCDate()),
    "T",
    pad(at.getUTCHours()),
    pad(at.getUTCMinutes()),
    pad(at.getUTCSeconds()),
  ].join("");
};

const suffix = (): string =>
  Math.floor(Math.random() * 0x10000)
    .toString(36)
    .padStart(4, "0");

const bodyOf = (response: HttpResponse): Effect.Effect<string> =>
  Effect.orElseSucceed(
    Effect.tryPromise(() => response.text()),
    () => "",
  );

const makeGitea = (options: {
  readonly fetch: HttpFetch;
  readonly platform: string;
  readonly credentials: CredentialsService;
}): GiteaService => {
  const request = (target: string, init?: HttpRequest): Effect.Effect<HttpResponse, GiteaError> =>
    Effect.tryPromise({
      try: () => options.fetch(target, init),
      // A rejected fetch is the only failure the transport itself reports, and
      // in a browser it covers offline, DNS, and a CORS refusal alike. None of
      // them are "your credentials are wrong", so none may be reported as such.
      catch: (error) => failed("Network", error instanceof Error ? error.message : String(error)),
    });

  const refuse = (response: HttpResponse): Effect.Effect<never, GiteaError> =>
    Effect.gen(function* () {
      const body = yield* bodyOf(response);
      if (response.status === 401) {
        return yield* Effect.fail(
          failed(otpWanted(response, body) ? "OtpRequired" : "Unauthorized", body),
        );
      }
      if (response.status === 403) return yield* Effect.fail(failed("Unauthorized", body));
      return yield* Effect.fail(failed("Refused", `${response.status} ${body}`.trim()));
    });

  const json = (response: HttpResponse): Effect.Effect<unknown, GiteaError> =>
    Effect.tryPromise({
      try: () => response.json(),
      catch: () => failed("Io", "Gitea's answer was not JSON"),
    });

  const authorised = (host: string): Effect.Effect<Session, GiteaError> =>
    Effect.gen(function* () {
      const held = yield* readSession(host);
      if (Option.isNone(held)) {
        return yield* Effect.fail(failed("Unauthorized", `not signed in to ${host}`));
      }
      return held.value;
    });

  const readSession = (host: string): Effect.Effect<Option.Option<Session>> =>
    Effect.gen(function* () {
      const key = normaliseHost(host);
      const held = yield* options.credentials.get(key);
      return Option.flatMap(held, (credential: Credential) =>
        credential.tokenName === undefined || credential.tokenId === undefined
          ? Option.none()
          : Option.some({
              host: key,
              username: credential.username,
              token: credential.token,
              tokenName: credential.tokenName,
              tokenId: credential.tokenId,
            }),
      );
    });

  const tokenHeaders = (session: Session): Readonly<Record<string, string>> => ({
    Authorization: `token ${session.token}`,
    Accept: "application/json",
  });

  const parentOf = (record: RepoRecordValue): ForkParent | undefined => {
    const parent = record.parent;
    if (record.fork !== true || parent === undefined || parent === null) return undefined;
    const owner = parent.owner?.username ?? parent.owner?.login;
    if (owner === undefined || parent.name === undefined || parent.clone_url === undefined)
      return undefined;
    return {
      owner,
      name: parent.name,
      fullName: parent.full_name ?? `${owner}/${parent.name}`,
      cloneUrl: parent.clone_url,
    };
  };

  const repoOf = (record: RepoRecordValue, fallbackOwner: string): RemoteRepo => {
    const owner = record.owner?.username ?? record.owner?.login ?? fallbackOwner;
    const name = record.name ?? "";
    return {
      owner,
      name,
      fullName: record.full_name ?? `${owner}/${name}`,
      cloneUrl: record.clone_url ?? "",
      defaultBranch: record.default_branch ?? "main",
      private: record.private ?? false,
      canWrite: (record.permissions?.push ?? false) || (record.permissions?.admin ?? false),
      parent: parentOf(record),
    };
  };

  const records = (payload: unknown): Effect.Effect<readonly RepoRecordValue[], GiteaError> => {
    const bare = decodeRepoArray(payload);
    if (bare._tag === "Success") return Effect.succeed(bare.success);
    const wrapped = decodeRepoSearch(payload);
    if (wrapped._tag === "Success") return Effect.succeed(wrapped.success.data ?? []);
    return Effect.fail(failed("Io", "Gitea's repository list did not decode"));
  };

  /**
   * Gitea's `/repos/search` is instance-wide unless it is scoped to a user id,
   * and an unscoped first page almost never contains the caller's own
   * repositories — the list then reads as empty for someone who owns several.
   * So every listing resolves `/user` first and passes `uid`. This is v1's
   * hard-won detail, not defensiveness.
   */
  const currentUserId = (session: Session): Effect.Effect<string, GiteaError> =>
    Effect.gen(function* () {
      const response = yield* request(url(session.host, "/api/v1/user"), {
        headers: tokenHeaders(session),
      });
      if (!response.ok) return yield* refuse(response);
      const decoded = decodeCurrentUser(yield* json(response));
      if (decoded._tag === "Failure") {
        return yield* Effect.fail(failed("Io", "Gitea did not identify the current user"));
      }
      return String(decoded.success.id);
    });

  const search = (
    host: string,
    query: Readonly<Record<string, string>>,
  ): Effect.Effect<readonly RemoteRepo[], GiteaError> =>
    Effect.gen(function* () {
      const session = yield* authorised(host);
      const uid = yield* currentUserId(session);
      const response = yield* request(
        url(session.host, "/api/v1/repos/search", {
          page: "1",
          limit: String(PAGE_SIZE),
          private: "true",
          uid,
          ...query,
        }),
        { headers: tokenHeaders(session) },
      );
      if (!response.ok) return yield* refuse(response);
      const rows = yield* records(yield* json(response));
      return rows.map((record) => repoOf(record, session.username));
    });

  const one = (session: Session, response: HttpResponse): Effect.Effect<RemoteRepo, GiteaError> =>
    Effect.gen(function* () {
      const decoded = decodeRepoRecord(yield* json(response));
      if (decoded._tag === "Failure") {
        return yield* Effect.fail(failed("Io", "Gitea's repository record did not decode"));
      }
      return repoOf(decoded.success, session.username);
    });

  return {
    login: ({ host, username, password, otp }) =>
      Effect.gen(function* () {
        const key = normaliseHost(host);
        const basic = `Basic ${base64(`${username}:${password}`)}`;
        const tokensUrl = url(key, `/api/v1/users/${encodeURIComponent(username)}/tokens`);
        const headers = {
          Authorization: basic,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(otp === undefined || otp === "" ? {} : { "X-Gitea-OTP": otp }),
        };

        const mint = (name: string): Effect.Effect<HttpResponse, GiteaError> =>
          request(tokensUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({ name, scopes: [...SESSION_TOKEN_SCOPES] }),
          });

        const mintWithRecovery = (tokenName: string): Effect.Effect<HttpResponse, GiteaError> =>
          Effect.gen(function* () {
            const response = yield* mint(tokenName);
            if (response.status !== 400) return response;
            const body = yield* bodyOf(response);
            if (!/used already/iu.test(body))
              return yield* Effect.fail(failed("Refused", `400 ${body}`.trim()));
            const removed = yield* request(`${tokensUrl}/${encodeURIComponent(tokenName)}`, {
              method: "DELETE",
              headers: { Authorization: basic, Accept: "application/json" },
            });
            return yield* mint(removed.ok ? tokenName : `${tokenName}-${suffix()}`);
          });

        const response = yield* mintWithRecovery(`sefer-${options.platform}-${stamp()}`);

        if (!response.ok) return yield* refuse(response);
        const decoded = decodeCreatedToken(yield* json(response));
        if (decoded._tag === "Failure") {
          return yield* Effect.fail(failed("Io", "Gitea did not return a usable token"));
        }
        const created = decoded.success;
        const session: Session = {
          host: key,
          username,
          token: created.sha1,
          tokenName: created.name,
          tokenId: String(created.id),
        };
        yield* options.credentials.set(key, {
          username: session.username,
          token: session.token,
          tokenName: session.tokenName,
          tokenId: session.tokenId,
        });
        return session;
      }),

    logout: (host) => options.credentials.clear(normaliseHost(host)),

    session: readSession,

    listWritableRepos: (host, text) =>
      Effect.map(
        search(host, text === undefined || text.trim() === "" ? {} : { q: text.trim() }),
        (repos) => repos.filter((repo) => repo.canWrite),
      ),

    listOwnedRepos: (host) => search(host, { exclusive: "true" }),

    createRepo: (host, create) =>
      Effect.gen(function* () {
        const session = yield* authorised(host);
        const response = yield* request(url(session.host, "/api/v1/user/repos"), {
          method: "POST",
          headers: { ...tokenHeaders(session), "Content-Type": "application/json" },
          body: JSON.stringify({
            name: create.name,
            description: create.description ?? "",
            private: create.private ?? false,
            auto_init: false,
          }),
        });
        if (!response.ok) return yield* refuse(response);
        return yield* one(session, response);
      }),

    getRepo: (host, owner, name) =>
      Effect.gen(function* () {
        const session = yield* authorised(host);
        const response = yield* request(
          url(
            session.host,
            `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
          ),
          { headers: tokenHeaders(session) },
        );
        if (response.status === 404) return Option.none<RemoteRepo>();
        if (!response.ok) return yield* refuse(response);
        return Option.some(yield* one(session, response));
      }),

    listForks: (host, owner, name) =>
      Effect.gen(function* () {
        const session = yield* authorised(host);
        const found: RemoteRepo[] = [];
        for (let page = 1; page <= FORK_PAGES; page += 1) {
          const response = yield* request(
            url(
              session.host,
              `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/forks`,
              { page: String(page), limit: String(PAGE_SIZE) },
            ),
            { headers: tokenHeaders(session) },
          );
          if (!response.ok) return yield* refuse(response);
          const rows = yield* records(yield* json(response));
          for (const record of rows) found.push(repoOf(record, session.username));
          if (rows.length < PAGE_SIZE) break;
        }
        return found;
      }),

    forkRepo: (host, owner, name, as) =>
      Effect.gen(function* () {
        const session = yield* authorised(host);
        const response = yield* request(
          url(
            session.host,
            `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/forks`,
          ),
          {
            method: "POST",
            headers: { ...tokenHeaders(session), "Content-Type": "application/json" },
            body: JSON.stringify(as === undefined ? {} : { name: as }),
          },
        );
        if (!response.ok) return yield* refuse(response);
        return yield* one(session, response);
      }),
  };
};

export const GiteaLive = (options: {
  readonly fetch: HttpFetch;
  readonly platform: string;
}): Layer.Layer<Gitea, never, Credentials> =>
  Layer.effect(
    Gitea,
    Effect.map(Credentials, (credentials) => makeGitea({ ...options, credentials })),
  );
