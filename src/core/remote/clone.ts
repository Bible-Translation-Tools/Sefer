/**
 * Cloning, as a composition of ports rather than a fifth method on `Remote`.
 *
 * A clone is not a distinct capability: it is `init` a repository, `attach` a
 * URL, then `pull`. Writing it that way means every host that answers `Git`
 * and `Remote` can clone with no extra code, and the `Remote` port stays the
 * four jobs a translator approves. That matters right now because desktop's
 * `Remote` Layer is being written against the port as it stands.
 *
 * It lives in core because the ORDER is policy, not host detail — in
 * particular that `attach` happens before any transfer, so a project on disk
 * always knows where its bytes came from even if the pull fails half way.
 */
import { Effect } from "effect";

import { Git, type GitError, type Repo } from "../git/git";
import { Remote, type Progress, type RemoteError } from "./remote";

/**
 * Creates `into` as a repository whose `origin` is `url`, and pulls it.
 *
 * Returns the `Repo` and the last progress the transfer reported, so a caller
 * can show what arrived. `into` must be the project folder itself; it is
 * created by `Git.init` if it does not exist.
 *
 * Not atomic on purpose: a failed pull leaves an initialised repository with
 * the remote attached, which is exactly the state a retry needs. A caller that
 * wants "all or nothing" deletes the folder on failure — a decision about the
 * user's disk, which core does not get to make.
 */
export const cloneRepository = (
  url: string,
  into: string,
): Effect.Effect<
  { readonly repo: Repo; readonly progress: Progress },
  RemoteError | GitError,
  Git | Remote
> =>
  Effect.gen(function* () {
    const git = yield* Git;
    const remote = yield* Remote;
    const repo = yield* git.init(into);
    yield* remote.attach(repo, url);
    const progress = yield* remote.pull(repo);
    return { repo, progress };
  });
