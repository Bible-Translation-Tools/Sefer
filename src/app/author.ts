import { Effect, Option } from "effect";

import type { Author } from "#core/git/git";
import { Settings } from "#core/host/settings";
import { Gitea } from "#core/remote/gitea";

import { resolveEndpoints } from "./endpoints";
import { authorName } from "./syncSettings";

export const APP_AUTHOR: Author = { name: "Sefer", email: "" };

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
