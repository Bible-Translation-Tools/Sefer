import { Effect, FileSystem, Option } from "effect";

import { parentPath } from "../fileSystem/path";
import type { Repo } from "../git/git";
import { COPY_REMOTE, type RemoteService } from "../remote/remote";
import { noteRemotes } from "./projectIndex";
import { sourceKey } from "./shareLink";

const TRACKED = ["origin", COPY_REMOTE] as const;

/** The `sourceKey` of each remote a repository tracks: origin, and the person's own copy. */
export const remotesOf = (remote: RemoteService, repo: Repo): Effect.Effect<readonly string[]> =>
  Effect.map(
    Effect.forEach(TRACKED, (name) =>
      Effect.orElseSucceed(remote.urlOf(repo, name), () => Option.none<string>()),
    ),
    (urls) =>
      urls.flatMap((url) => {
        const key = Option.isSome(url) ? sourceKey(url.value) : undefined;
        return key === undefined ? [] : [key];
      }),
  );

/**
 * The Remote, keeping the projects index true: every change to a project's
 * remotes (attaching the shared project, making or adopting the person's own
 * copy, publishing) rewrites that project's `remotes` in the index beside
 * it. Every such change goes through here, so no screen has to remember to.
 */
export const indexingRemotes = (
  remote: RemoteService,
  fileSystem: FileSystem.FileSystem,
): RemoteService => {
  const noted = (repo: Repo): Effect.Effect<void> =>
    Effect.ignore(
      Effect.flatMap(remotesOf(remote, repo), (keys) =>
        noteRemotes(fileSystem, parentPath(repo.root), repo.root, keys),
      ),
    );
  return {
    ...remote,
    attach: (repo, url) => Effect.tap(remote.attach(repo, url), () => noted(repo)),
    attachAs: (repo, name, url) => Effect.tap(remote.attachAs(repo, name, url), () => noted(repo)),
    publish: (repo, target) => Effect.tap(remote.publish(repo, target), () => noted(repo)),
  };
};
