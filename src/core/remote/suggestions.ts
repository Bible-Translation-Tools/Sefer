/**
 * Suggested changes: Gitea's pull requests, as the few questions the
 * suggested-changes flow asks.
 *
 * A translator who cannot write to the shared project sends to their own copy
 * (a fork) and SUGGESTS those changes — one open pull request from that copy's
 * branch, which follows the copy as more is sent. Someone who can write to the
 * shared project sees the open suggestions and brings them in, or declines
 * them. "Pull request" is Gitea's word and this module's; the screen says
 * "suggested changes".
 *
 * A service of its own beside `Gitea`, and deliberately so: the whole flow is
 * one topology among several (a team whose members are all writers never
 * needs it), and it comes out by removing this service's one registration and
 * its one caller. It reads the session `Gitea` keeps, so there is no second
 * sign-in.
 */
import { Context, Effect, Layer, Option, Schema } from "effect";

import { Gitea, GiteaError, type HttpFetch, type HttpResponse, type Session } from "./gitea";

/** One open suggestion, as the steward's list shows it. */
export interface Suggestion {
  readonly number: number;
  readonly title: string;
  /** The account that suggested it. */
  readonly author: string;
  /** ISO-8601, when it last moved. */
  readonly updatedAt: string;
  /** The branch it suggests, on its author's copy. */
  readonly branch: string;
}

export interface SuggestRequest {
  /** The suggester's account, whose copy holds `branch`. */
  readonly from: string;
  readonly branch: string;
  /** The shared project's branch it is suggested into. */
  readonly base: string;
  readonly title: string;
  readonly body: string;
}

export interface SuggestionsService {
  /** Can the signed-in account write to `owner/name`? */
  readonly canWrite: (
    host: string,
    owner: string,
    name: string,
  ) => Effect.Effect<boolean, GiteaError>;
  /** The open suggestions to `owner/name`, newest first. */
  readonly open: (
    host: string,
    owner: string,
    name: string,
  ) => Effect.Effect<readonly Suggestion[], GiteaError>;
  /**
   * Opens a suggestion, or answers the one already open from the same
   * account and branch: one open suggestion per person, which a later send
   * to their copy updates by itself.
   */
  readonly suggest: (
    host: string,
    owner: string,
    name: string,
    request: SuggestRequest,
  ) => Effect.Effect<Suggestion, GiteaError>;
  /** Closes a suggestion without bringing it in, leaving `note` on it when given. */
  readonly decline: (
    host: string,
    owner: string,
    name: string,
    number: number,
    note: string,
  ) => Effect.Effect<void, GiteaError>;
}

export class Suggestions extends Context.Service<Suggestions, SuggestionsService>()(
  "Suggestions",
) {}

const PullRecord = Schema.Struct({
  number: Schema.Number,
  title: Schema.optionalKey(Schema.String),
  updated_at: Schema.optionalKey(Schema.String),
  user: Schema.optionalKey(Schema.Struct({ login: Schema.optionalKey(Schema.String) })),
  head: Schema.optionalKey(
    Schema.Struct({
      ref: Schema.optionalKey(Schema.String),
      repo: Schema.optionalKey(
        Schema.NullOr(
          Schema.Struct({
            owner: Schema.optionalKey(Schema.Struct({ login: Schema.optionalKey(Schema.String) })),
          }),
        ),
      ),
    }),
  ),
});

const decodePull = Schema.decodeUnknownResult(PullRecord);
const decodePulls = Schema.decodeUnknownResult(Schema.Array(PullRecord));

type PullValue = typeof PullRecord.Type;

const suggestionOf = (record: PullValue): Suggestion => ({
  number: record.number,
  title: record.title ?? "",
  author: record.user?.login ?? record.head?.repo?.owner?.login ?? "",
  updatedAt: record.updated_at ?? "",
  branch: record.head?.ref ?? "",
});

const failed = (reason: GiteaError["reason"], description: string): GiteaError =>
  new GiteaError({ reason, description });

const repoPath = (host: string, owner: string, name: string, rest = ""): string =>
  `${host.trim().replace(/\/+$/u, "")}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}${rest}`;

const make = (fetch: HttpFetch) =>
  Effect.gen(function* () {
    const gitea = yield* Gitea;

    const session = (host: string): Effect.Effect<Session, GiteaError> =>
      Effect.flatMap(gitea.session(host), (held) =>
        Option.isNone(held)
          ? Effect.fail(failed("Unauthorized", `not signed in to ${host}`))
          : Effect.succeed(held.value),
      );

    const request = (
      held: Session,
      url: string,
      init: { readonly method?: string; readonly body?: unknown } = {},
    ): Effect.Effect<HttpResponse, GiteaError> =>
      Effect.tryPromise({
        try: () =>
          fetch(url, {
            ...(init.method === undefined ? {} : { method: init.method }),
            headers: {
              Authorization: `token ${held.token}`,
              Accept: "application/json",
              ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
          }),
        catch: (cause) => failed("Network", String(cause)),
      });

    const answer = (response: HttpResponse): Effect.Effect<unknown, GiteaError> =>
      Effect.gen(function* () {
        if (response.status === 401 || response.status === 403)
          return yield* Effect.fail(failed("Unauthorized", `${response.status}`));
        if (!response.ok) {
          const text = yield* Effect.orElseSucceed(
            Effect.tryPromise(() => response.text()),
            () => "",
          );
          return yield* Effect.fail(failed("Refused", `${response.status} ${text}`.trim()));
        }
        return yield* Effect.tryPromise({
          try: () => response.json(),
          catch: () => failed("Io", "Gitea's answer was not JSON"),
        });
      });

    const open: SuggestionsService["open"] = (host, owner, name) =>
      Effect.gen(function* () {
        const held = yield* session(host);
        const body = yield* answer(
          yield* request(held, repoPath(host, owner, name, "/pulls?state=open&sort=recentupdate")),
        );
        const decoded = decodePulls(body);
        if (decoded._tag === "Failure")
          return yield* Effect.fail(failed("Io", "Gitea's pull request list did not decode"));
        return decoded.success.map(suggestionOf);
      });

    return {
      canWrite: (host, owner, name) =>
        Effect.map(gitea.getRepo(host, owner, name), (repo) =>
          Option.match(repo, { onNone: () => false, onSome: (found) => found.canWrite }),
        ),

      open,

      suggest: (host, owner, name, suggestion) =>
        Effect.gen(function* () {
          const already = (yield* open(host, owner, name)).find(
            (held) => held.author === suggestion.from && held.branch === suggestion.branch,
          );
          if (already !== undefined) return already;
          const held = yield* session(host);
          const body = yield* answer(
            yield* request(held, repoPath(host, owner, name, "/pulls"), {
              method: "POST",
              body: {
                head: `${suggestion.from}:${suggestion.branch}`,
                base: suggestion.base,
                title: suggestion.title,
                body: suggestion.body,
              },
            }),
          );
          const decoded = decodePull(body);
          if (decoded._tag === "Failure")
            return yield* Effect.fail(failed("Io", "Gitea's pull request did not decode"));
          return suggestionOf(decoded.success);
        }),

      decline: (host, owner, name, number, note) =>
        Effect.gen(function* () {
          const held = yield* session(host);
          if (note.trim() !== "")
            yield* answer(
              yield* request(held, repoPath(host, owner, name, `/issues/${number}/comments`), {
                method: "POST",
                body: { body: note },
              }),
            );
          yield* answer(
            yield* request(held, repoPath(host, owner, name, `/pulls/${number}`), {
              method: "PATCH",
              body: { state: "closed" },
            }),
          );
        }),
    } satisfies SuggestionsService;
  });

/** Registered once, beside `Gitea`, over the same transport. */
export const SuggestionsLive = (options: {
  readonly fetch: HttpFetch;
}): Layer.Layer<Suggestions, never, Gitea> => Layer.effect(Suggestions, make(options.fetch));
