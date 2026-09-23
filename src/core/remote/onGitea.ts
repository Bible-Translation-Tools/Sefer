/**
 * What both `Remote` hosts share once the transport is set aside: the key a
 * credential is filed under, and `publish`'s one call into the Gitea API.
 *
 * It lives in core rather than in either host because the desktop remote must
 * not import the Web one — that would pull isomorphic-git into the desktop
 * bundle for a few lines of URL parsing — and these rules are the same on both.
 */
import { Effect, Option } from "effect";

import type { GiteaError, GiteaFailureReason, GiteaService } from "./gitea";
import { RemoteError, type RemoteFailureReason } from "./remote";

/**
 * The origin of a remote URL — the `Credentials` key.
 *
 * A token belongs to a Gitea instance, not to one repository, so two projects
 * on the same instance share a credential. A URL that will not parse is its own
 * key: wrong, but no worse than refusing to look, and `Credentials.get`
 * answering `None` is already the "no credential" path.
 */
export const hostOf = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};

/**
 * A `GiteaError` reason as a `RemoteError` reason. `OtpRequired` collapses into
 * `Unauthorized` here because a transfer has no OTP field to offer — the sign-in
 * surface is where that distinction is actionable.
 */
const reasonOf = (reason: GiteaFailureReason): RemoteFailureReason => {
  switch (reason) {
    case "Unauthorized":
    case "OtpRequired":
      return "Unauthorized";
    case "Network":
      return "Network";
    default:
      return "Rejected";
  }
};

/** A `Gitea` call seen as a `Remote` one, so `publish` has one error type. */
const fromGitea = <A>(effect: Effect.Effect<A, GiteaError>): Effect.Effect<A, RemoteError> =>
  Effect.mapError(
    effect,
    (error) =>
      new RemoteError({
        reason: reasonOf(error.reason),
        description: error.description ?? error.reason,
      }),
  );

/**
 * `owner/name` or `name` on `host` → the URL to attach.
 *
 * `host` is `null` when this build names no WACS endpoint; `unset` is the
 * sentence that says which variable would, since that differs per host.
 */
export const createOnGitea = (
  gitea: GiteaService,
  host: string | null,
  target: string,
  unset: string,
): Effect.Effect<string, RemoteError> =>
  Effect.gen(function* () {
    if (host === null) {
      return yield* Effect.fail(new RemoteError({ reason: "Unavailable", description: unset }));
    }
    const parts = target.split("/");
    const name = parts[parts.length - 1] ?? target;
    const owner = parts.length > 1 ? parts[0] : undefined;
    // Only a fully qualified `owner/name` can be looked up; a bare name is
    // a request to create one under the signed-in user.
    if (owner !== undefined) {
      const existing = yield* fromGitea(gitea.getRepo(host, owner, name));
      if (Option.isSome(existing)) return existing.value.cloneUrl;
    }
    const created = yield* fromGitea(gitea.createRepo(host, { name }));
    return created.cloneUrl;
  });
