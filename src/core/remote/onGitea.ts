import { Effect, Option } from "effect";

import type { GiteaError, GiteaFailureReason, GiteaService } from "./gitea";
import { RemoteError, type RemoteFailureReason } from "./remote";

export const hostOf = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};

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

const fromGitea = <A>(effect: Effect.Effect<A, GiteaError>): Effect.Effect<A, RemoteError> =>
  Effect.mapError(
    effect,
    (error) =>
      new RemoteError({
        reason: reasonOf(error.reason),
        description: error.description ?? error.reason,
      }),
  );

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
    if (owner !== undefined) {
      const existing = yield* fromGitea(gitea.getRepo(host, owner, name));
      if (Option.isSome(existing)) return existing.value.cloneUrl;
    }
    const created = yield* fromGitea(gitea.createRepo(host, { name }));
    return created.cloneUrl;
  });
