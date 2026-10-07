/**
 * Who a commit Sefer makes is by: one answer, in one place.
 *
 * The signed-in account's username first; then the name this device was
 * given, asked for once the first time a version is recorded; and only for
 * Sefer's own bookkeeping — an import's arrival — "Sefer" when there is
 * neither. The email is empty rather than invented: git allows an empty
 * author email, and a made-up address is worse than none.
 */
import { Effect, Option } from "effect";

import type { Author } from "#core/git/git";
import { Settings } from "#core/host/settings";
import { Gitea } from "#core/remote/gitea";

import { resolveEndpoints } from "./endpoints";
import { authorName } from "./syncSettings";

/** Sefer's own name, for a commit no person made: an import's arrival. */
export const APP_AUTHOR: Author = { name: "Sefer", email: "" };

/**
 * The person recording, when there is one to name: the session's username,
 * else this device's name. `None` means ask before recording.
 */
export const personAuthor = (): Effect.Effect<Option.Option<Author>, never, Gitea | Settings> =>
  Effect.gen(function* () {
    const settings = yield* Settings;
    const gitea = yield* Gitea;
    const host = resolveEndpoints(settings).contentHost;
    const session = host === null ? Option.none() : yield* gitea.session(host);
    if (Option.isSome(session)) return Option.some({ name: session.value.username, email: "" });
    const name = authorName(settings);
    return name === "" ? Option.none() : Option.some({ name, email: "" });
  });
