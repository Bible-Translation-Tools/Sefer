/**
 * Gitea — the account half of remote sync (slice 26), separated from transfer.
 *
 * `Remote` moves objects; this service is everything that happens over Gitea's
 * REST API *before* a transfer is possible: signing in, and answering "which
 * repositories may I push to, and does this one exist yet?". WACS (Wycliffe
 * Associates Content Service) is a Gitea instance, so the v1 app's flow is the
 * one translators already have accounts for and this is a faithful port of it:
 *   POST /api/v1/users/{user}/tokens with HTTP Basic auth (plus `X-Gitea-OTP`
 *   when the account has two-factor on) mints a *scoped* token, and the
 *   password is never held past that one call.
 *
 * Two deliberate constraints:
 *
 * - Core may not touch the `fetch` global, so the transport arrives as the
 *   `HttpFetch` port and `GiteaLive` is the only thing that needs a host. The
 *   port is spelled structurally rather than with the DOM's `Request`/`Response`
 *   so this file stays free of host lib types; `globalThis.fetch.bind(globalThis)`
 *   satisfies it as-is.
 * - The session lives in the host `Credentials` service and nowhere else. A
 *   token is a secret: it never reaches a project file, and the extra
 *   bookkeeping (`tokenName`, `tokenId`) rides on the same `Credential` record
 *   so a host that persists one persists all of it, atomically, or none.
 *
 * The base URL is the caller's — `src/app/env.ts` reads it from
 * `VITE_SEFER_WACS_WEB_URL` / `VITE_SEFER_WACS_DESKTOP_URL`, the same endpoint
 * transfers use. No hostname appears in this file, and none should.
 */
import { Context, Data, Effect, Layer, Option, Schema } from "effect";

import { Credentials, type Credential, type CredentialsService } from "../host/credentials";

/**
 * A signed-in Gitea account. `host` is the base URL the token belongs to, and
 * is also the `Credentials` key — one session per instance, because a token
 * minted on one Gitea means nothing on another.
 */
export interface Session {
  readonly host: string;
  readonly username: string;
  readonly token: string;
  readonly tokenName: string;
  readonly tokenId: string;
}

/**
 * One repository as this service reports it. Narrower than Gitea's record on
 * purpose: these are the fields an attach/publish flow decides with.
 *
 * `canWrite` is computed from the permissions Gitea returns, not guessed from
 * ownership — a translator's usual repository is one they collaborate on.
 */
export interface RemoteRepo {
  readonly owner: string;
  readonly name: string;
  readonly fullName: string;
  /** The smart-HTTP URL to attach as `origin`. */
  readonly cloneUrl: string;
  readonly defaultBranch: string;
  readonly private: boolean;
  readonly canWrite: boolean;
}

export interface CreateRepoRequest {
  readonly name: string;
  readonly description?: string | undefined;
  readonly private?: boolean | undefined;
}

/**
 * `Unauthorized` — the password, or the token, was rejected.
 * `OtpRequired` — the credentials were right and the account wants its
 * second factor; the only reason worth re-showing the form for.
 * `Network` — the request never got an answer: offline, DNS, CORS, dead proxy.
 * `Refused` — Gitea answered and said no (a name already taken, no access).
 * `Io` — Gitea answered with something this reader cannot decode.
 */
export type GiteaFailureReason = "Unauthorized" | "OtpRequired" | "Network" | "Refused" | "Io";

export class GiteaError extends Data.TaggedError("GiteaError")<{
  readonly reason: GiteaFailureReason;
  readonly description?: string | undefined;
}> {}

/** The subset of `RequestInit` this service sends. */
export interface HttpRequest {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** The subset of `Response` this service reads. */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { readonly get: (name: string) => string | null };
  readonly text: () => Promise<string>;
  readonly json: () => Promise<unknown>;
}

/**
 * The transport, as a port. Core cannot reach `fetch`; the platform passes
 * `globalThis.fetch.bind(globalThis)`, and a test passes a function.
 */
export type HttpFetch = (input: string, init?: HttpRequest) => Promise<HttpResponse>;

export interface GiteaService {
  /**
   * Exchanges a password for a scoped API token and records the session.
   *
   * The password is used for exactly one request and never stored. Fails
   * `OtpRequired` when the account has two-factor enabled and `otp` was absent
   * or wrong — the caller shows the OTP field and calls again.
   */
  readonly login: (args: {
    readonly host: string;
    readonly username: string;
    readonly password: string;
    readonly otp?: string | undefined;
  }) => Effect.Effect<Session, GiteaError>;
  /**
   * Forgets the session for `host`. The token itself is left alive on the
   * server: revoking it needs the password again (Gitea's token endpoints
   * refuse token auth), and prompting for a password in order to log *out*
   * is worse than a named token the user can see and delete in Gitea.
   */
  readonly logout: (host: string) => Effect.Effect<void>;
  readonly session: (host: string) => Effect.Effect<Option.Option<Session>>;
  /** Repositories the signed-in user can push to, owned or collaborated on. */
  readonly listWritableRepos: (host: string) => Effect.Effect<readonly RemoteRepo[], GiteaError>;
  /** Repositories the signed-in user owns, writable or not. */
  readonly listOwnedRepos: (host: string) => Effect.Effect<readonly RemoteRepo[], GiteaError>;
  /** Creates the repository under the signed-in user. `Refused` if it exists. */
  readonly createRepo: (
    host: string,
    request: CreateRepoRequest,
  ) => Effect.Effect<RemoteRepo, GiteaError>;
  /** `None` when there is no such repository — not an error. */
  readonly getRepo: (
    host: string,
    owner: string,
    name: string,
  ) => Effect.Effect<Option.Option<RemoteRepo>, GiteaError>;
  /** Forks `owner/name` into the signed-in user's account. */
  readonly forkRepo: (
    host: string,
    owner: string,
    name: string,
  ) => Effect.Effect<RemoteRepo, GiteaError>;
}

export class Gitea extends Context.Service<Gitea, GiteaService>()("Gitea") {}

/**
 * The scopes the token is minted with, copied from v1 so an account signed in
 * from either app carries the same authority. `write:repository` is the one
 * that matters for sync; the reads are what the project and account screens
 * need. A token is never minted with more than this — notably not `write:admin`.
 */
export const SESSION_TOKEN_SCOPES: readonly string[] = [
  "read:activitypub",
  "read:issue",
  "write:misc",
  "read:notification",
  "read:organization",
  "read:package",
  "write:repository",
  "write:user",
];

/** How many repositories one page of a listing asks for. */
const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

// Every field is optional because Gitea's records vary by version and by
// endpoint, and a missing `topics` array must not cost the user their repo
// list. `Schema` rather than hand-written narrowing so no assertion is needed.
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

const RepoRecord = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  full_name: Schema.optionalKey(Schema.String),
  clone_url: Schema.optionalKey(Schema.String),
  html_url: Schema.optionalKey(Schema.String),
  default_branch: Schema.optionalKey(Schema.String),
  private: Schema.optionalKey(Schema.Boolean),
  owner: Schema.optionalKey(RepoOwner),
  permissions: Schema.optionalKey(RepoPermissions),
});

// `/api/v1/repos/search` wraps its rows in `{ data }`; `/api/v1/user/repos`
// returns a bare array. Two decoders tried in turn rather than one union,
// because a union of "array or struct" narrows badly on the way out and the
// callers must not have to know which endpoint they came from.
const RepoArray = Schema.Array(RepoRecord);
const RepoSearch = Schema.Struct({ data: Schema.optionalKey(Schema.Array(RepoRecord)) });

const CurrentUser = Schema.Struct({ id: NumberOrString });

const decodeCreatedToken = Schema.decodeUnknownResult(CreatedToken);
const decodeRepoRecord = Schema.decodeUnknownResult(RepoRecord);
const decodeRepoArray = Schema.decodeUnknownResult(RepoArray);
const decodeRepoSearch = Schema.decodeUnknownResult(RepoSearch);
const decodeCurrentUser = Schema.decodeUnknownResult(CurrentUser);

type RepoRecordValue = typeof RepoRecord.Type;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const failed = (reason: GiteaFailureReason, description: string): GiteaError =>
  new GiteaError({ reason, description });

/** Trailing slashes off, so `host` is a stable `Credentials` key. */
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

/**
 * Base64 without a host global, because core has neither `btoa` nor `Buffer`
 * it may name. Credentials are ASCII in the overwhelming case but a UTF-8
 * password must still encode correctly, so the string is encoded to bytes
 * first and the bytes are what get grouped.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const base64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const remaining = bytes.length - index;
    out += ALPHABET[a >> 2] ?? "";
    out += ALPHABET[((a & 0x03) << 4) | (b >> 4)] ?? "";
    out += remaining > 1 ? (ALPHABET[((b & 0x0f) << 2) | (c >> 6)] ?? "") : "=";
    out += remaining > 2 ? (ALPHABET[c & 0x3f] ?? "") : "=";
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
 * `20260915T124233` — the moment the token was minted, to the second.
 *
 * Gitea refuses a token whose NAME already exists (`400 access token name has
 * been used already`), so this granularity is not cosmetic: a name good only
 * to the day meant that signing in twice from one device on one day — after a
 * page reload, most obviously — failed with a message about a token the person
 * had never heard of and could not act on.
 *
 * Built by hand rather than with a locale formatter: core has no `Intl`
 * contract and the string must be identical on every host, since a person
 * comparing two devices' token lists is reading it as an identifier.
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

/** Four characters that make a name nothing can already hold. Not a secret. */
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

  /** Non-ok becomes the right reason, with Gitea's own message as detail. */
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

  /** The token for `host`, or `Unauthorized` — every read needs one. */
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
          ? // A credential without the token bookkeeping did not come from
            // `login`, so it is not a Gitea session and must not be reported
            // as one.
            Option.none()
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

        // The token name carries where it was minted and when, so a user
        // looking at their Gitea token list can tell one device from another
        // and revoke just that one. To the SECOND, not to the day: Gitea
        // refuses a duplicate name with `400 access token name has been used
        // already`, and a day-granular name meant the second sign-in from one
        // device — after a reload, say — could not sign in at all.
        const tokenName = `sefer-${options.platform}-${stamp()}`;
        let response = yield* mint(tokenName);

        // The recovery, for a name that somehow collides anyway (two windows
        // in the same second, or a stale token from a build that used the old
        // day-granular name). We hold the password for exactly this call,
        // which is the only moment Gitea's token endpoints — which refuse
        // token auth — can be reached at all: delete the token wearing OUR
        // name and try once more, and if the instance will not allow that,
        // mint under a name nothing can already hold.
        //
        // The body is read ONCE and carried, because a response body can only
        // be consumed once and `refuse` below needs it to say what went wrong.
        if (response.status === 400) {
          const body = yield* bodyOf(response);
          if (!/used already/iu.test(body))
            return yield* Effect.fail(failed("Refused", `400 ${body}`.trim()));
          const removed = yield* request(`${tokensUrl}/${encodeURIComponent(tokenName)}`, {
            method: "DELETE",
            headers: { Authorization: basic, Accept: "application/json" },
          });
          response = yield* mint(removed.ok ? tokenName : `${tokenName}-${suffix()}`);
        }

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
        // The password is out of scope from here; only the token is kept, and
        // only where the host decided credentials may live.
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

    listWritableRepos: (host) =>
      Effect.map(search(host, {}), (repos) => repos.filter((repo) => repo.canWrite)),

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
            private: create.private ?? true,
            // Sefer pushes an existing project's history; an auto-initialised
            // repository would give the first push a commit to conflict with.
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

    forkRepo: (host, owner, name) =>
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
            // An empty body forks into the authenticated user's account and
            // keeps the upstream name.
            body: "{}",
          },
        );
        if (!response.ok) return yield* refuse(response);
        return yield* one(session, response);
      }),
  };
};

/**
 * The one Layer. `fetch` is the host's transport and `platform` names this
 * build in the token it mints (`sefer-web-2026-09-08`), which is the only
 * string a translator will ever see from Sefer inside Gitea.
 */
export const GiteaLive = (options: {
  readonly fetch: HttpFetch;
  readonly platform: string;
}): Layer.Layer<Gitea, never, Credentials> =>
  Layer.effect(
    Gitea,
    // The credential store is read once, as a value: every method of the port
    // is `Effect<_, _>` with no requirements, so nothing downstream of Gitea
    // has to know a `Credentials` service was involved at all.
    Effect.map(Credentials, (credentials) => makeGitea({ ...options, credentials })),
  );
