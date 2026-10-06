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

/** One suggestion, as the steward's list and its author's popover show it. */
export interface Suggestion {
  readonly number: number;
  readonly title: string;
  /** The account that suggested it. */
  readonly author: string;
  /** ISO-8601, when it last moved. */
  readonly updatedAt: string;
  /** The branch it suggests, on its author's copy. */
  readonly branch: string;
  /** The commit it suggests, when Gitea said. */
  readonly head: string | undefined;
  /**
   * Gitea's own word. `merged` is only true when Gitea merged it or was told
   * it was; a suggestion brought in by Sefer's Review is a decision commit
   * Gitea may not recognise, so "was it taken" is asked of git, by its `head`.
   */
  readonly state: "open" | "merged" | "closed";
}

interface SuggestRequest {
  /** The suggester's account, whose copy holds `branch`. */
  readonly from: string;
  readonly branch: string;
  /** The shared project's branch it is suggested into. */
  readonly base: string;
  readonly title: string;
  readonly body: string;
}

interface SuggestionsService {
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
  /** Suggestion `number` on `owner/name`, or `undefined` when there is none. */
  readonly one: (
    host: string,
    owner: string,
    name: string,
    number: number,
  ) => Effect.Effect<Suggestion | undefined, GiteaError>;
  /** The suggestions `author` made to `owner/name`, open or not, newest first. */
  readonly from: (
    host: string,
    owner: string,
    name: string,
    author: string,
  ) => Effect.Effect<readonly Suggestion[], GiteaError>;
  /**
   * The last thing anybody but `author` said on suggestion `number` — the
   * editor's note on a declined one — or `undefined` when nobody did.
   */
  readonly noteOn: (
    host: string,
    owner: string,
    name: string,
    number: number,
    author: string,
  ) => Effect.Effect<string | undefined, GiteaError>;
  /**
   * Marks a suggestion brought in by `commit` — Gitea's "manually merged" —
   * or, where the repository does not allow that, closes it with a note
   * saying it was brought in, so its author is not left waiting.
   */
  readonly accept: (
    host: string,
    owner: string,
    name: string,
    number: number,
    commit: string,
    /** What the reviewer wrote when bringing it in — its author reads it. */
    note: string,
  ) => Effect.Effect<void, GiteaError>;
  /**
   * Closes a suggestion without bringing it in, leaving `note` on it when
   * given: an editor declining it, or its author withdrawing it.
   */
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
  state: Schema.optionalKey(Schema.String),
  merged: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  title: Schema.optionalKey(Schema.String),
  updated_at: Schema.optionalKey(Schema.String),
  user: Schema.optionalKey(Schema.Struct({ login: Schema.optionalKey(Schema.String) })),
  head: Schema.optionalKey(
    Schema.Struct({
      ref: Schema.optionalKey(Schema.String),
      sha: Schema.optionalKey(Schema.String),
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

const CommentRecord = Schema.Struct({
  body: Schema.optionalKey(Schema.String),
  user: Schema.optionalKey(Schema.Struct({ login: Schema.optionalKey(Schema.String) })),
});

const decodePull = Schema.decodeUnknownResult(PullRecord);
const decodePulls = Schema.decodeUnknownResult(Schema.Array(PullRecord));
const decodeComments = Schema.decodeUnknownResult(Schema.Array(CommentRecord));

type PullValue = typeof PullRecord.Type;

const suggestionOf = (record: PullValue): Suggestion => ({
  number: record.number,
  title: record.title ?? "",
  author: record.user?.login ?? record.head?.repo?.owner?.login ?? "",
  updatedAt: record.updated_at ?? "",
  branch: record.head?.ref ?? "",
  head: record.head?.sha,
  state: record.merged === true ? "merged" : record.state === "closed" ? "closed" : "open",
});

/** The same login, as Gitea compares them: without regard to case. */
const sameLogin = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * The line Sefer ends a brought-in suggestion's note with — how its author
 * tells "taken" from "declined" on a repository that does not allow marking a
 * pull request "manually merged", where both end merely closed. Git cannot
 * say: one copy's branch backs every suggestion its person makes, and Gitea
 * reports that branch's CURRENT tip as the head of each, closed or not.
 */
export const BROUGHT_IN = "Brought in with Sefer.";

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
        if (!response.ok) {
          // Gitea's reason travels with the status: a bare "403" cannot tell
          // a missing token scope from a permission from a proxy refusal.
          const text = yield* Effect.orElseSucceed(
            Effect.tryPromise(() => response.text()),
            () => "",
          );
          if (response.status === 401 || response.status === 403)
            return yield* Effect.fail(failed("Unauthorized", `${response.status} ${text}`.trim()));
          return yield* Effect.fail(failed("Refused", `${response.status} ${text}`.trim()));
        }
        return yield* Effect.tryPromise({
          try: () => response.json(),
          catch: () => failed("Io", "Gitea's answer was not JSON"),
        });
      });

    const list = (
      host: string,
      owner: string,
      name: string,
      state: "open" | "all",
    ): Effect.Effect<readonly Suggestion[], GiteaError> =>
      Effect.gen(function* () {
        const held = yield* session(host);
        const body = yield* answer(
          yield* request(
            held,
            repoPath(host, owner, name, `/pulls?state=${state}&sort=recentupdate&limit=50`),
          ),
        );
        const decoded = decodePulls(body);
        if (decoded._tag === "Failure")
          return yield* Effect.fail(failed("Io", "Gitea's pull request list did not decode"));
        return decoded.success.map(suggestionOf);
      });

    const open: SuggestionsService["open"] = (host, owner, name) => list(host, owner, name, "open");

    const comment = (
      held: Session,
      host: string,
      owner: string,
      name: string,
      number: number,
      body: string,
    ) =>
      Effect.asVoid(
        Effect.mapError(
          Effect.flatMap(
            request(held, repoPath(host, owner, name, `/issues/${number}/comments`), {
              method: "POST",
              body: { body },
            }),
            answer,
          ),
          // A sign-in from before notes needed `write:issue` (gitea.ts) carries
          // a token Gitea refuses a comment to. Say the fix, not the status.
          (error: GiteaError): GiteaError =>
            error.reason === "Unauthorized"
              ? failed(
                  "Unauthorized",
                  "this sign-in cannot leave notes yet: sign out and in again, then try once more",
                )
              : error,
        ),
      );

    return {
      canWrite: (host, owner, name) =>
        Effect.map(gitea.getRepo(host, owner, name), (repo) =>
          Option.match(repo, { onNone: () => false, onSome: (found) => found.canWrite }),
        ),

      open,

      one: (host, owner, name, number) =>
        Effect.gen(function* () {
          const held = yield* session(host);
          const response = yield* request(held, repoPath(host, owner, name, `/pulls/${number}`));
          if (response.status === 404) return undefined;
          const decoded = decodePull(yield* answer(response));
          return decoded._tag === "Failure" ? undefined : suggestionOf(decoded.success);
        }),

      from: (host, owner, name, author) =>
        Effect.map(list(host, owner, name, "all"), (all) =>
          all.filter((held) => sameLogin(held.author, author)),
        ),

      noteOn: (host, owner, name, number, author) =>
        Effect.gen(function* () {
          const held = yield* session(host);
          const decoded = decodeComments(
            yield* answer(
              yield* request(held, repoPath(host, owner, name, `/issues/${number}/comments`)),
            ),
          );
          return decoded._tag === "Failure"
            ? undefined
            : decoded.success.findLast(
                (entry) => !sameLogin(entry.user?.login ?? author, author) && entry.body !== "",
              )?.body;
        }),

      accept: (host, owner, name, number, commit, note) =>
        Effect.gen(function* () {
          const held = yield* session(host);
          const marked = yield* Effect.result(
            Effect.flatMap(
              request(held, repoPath(host, owner, name, `/pulls/${number}/merge`), {
                method: "POST",
                body: { Do: "manually-merged", MergeCommitID: commit },
              }),
              answer,
            ),
          );
          // Where the repository does not allow "manually merged", it is closed
          // instead — and either way the reviewer's own words go on it.
          if (marked._tag === "Failure")
            yield* answer(
              yield* request(held, repoPath(host, owner, name, `/pulls/${number}`), {
                method: "PATCH",
                body: { state: "closed" },
              }),
            );
          yield* comment(
            held,
            host,
            owner,
            name,
            number,
            note.trim() === "" ? BROUGHT_IN : `${note.trim()}\n\n${BROUGHT_IN}`,
          );
        }),

      suggest: (host, owner, name, suggestion) =>
        Effect.gen(function* () {
          const already = (yield* open(host, owner, name)).find(
            (held) => sameLogin(held.author, suggestion.from) && held.branch === suggestion.branch,
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
          // Closed first, then the note: a close that is refused leaves
          // nothing behind, so trying again does not post the note twice.
          const closed = decodePull(
            yield* answer(
              yield* request(held, repoPath(host, owner, name, `/pulls/${number}`), {
                method: "PATCH",
                body: { state: "closed" },
              }),
            ),
          );
          // Gitea answers 200 to a PATCH that changed nothing (an edit that
          // arrived without its body), so the answer itself has to say closed.
          if (closed._tag === "Failure" || closed.success.state !== "closed")
            return yield* Effect.fail(
              failed("Refused", `suggestion ${number} is still open after asking to close it`),
            );
          if (note.trim() !== "") yield* comment(held, host, owner, name, number, note);
        }),
    } satisfies SuggestionsService;
  });

/** Registered once, beside `Gitea`, over the same transport. */
export const SuggestionsLive = (options: {
  readonly fetch: HttpFetch;
}): Layer.Layer<Suggestions, never, Gitea> => Layer.effect(Suggestions, make(options.fetch));
