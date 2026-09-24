/**
 * Cloning: `Remote.clone`, as the one Effect the landing screens run.
 *
 * It used to be `init`, `attach`, then `pull`, on the argument that a clone is
 * no distinct capability. It is one: an `init` has already chosen a branch
 * (`main`) before the server has been asked, so a repository on `master`
 * could not arrive, and a pull into that unborn branch had nothing to merge
 * into. A real clone asks the server which branch HEAD names and checks that
 * out, which is what `git clone` does and what both hosts' libraries do.
 */
import { Effect } from "effect";

import type { Repo } from "../git/git";
import { Remote, type Progress, type RemoteError } from "./remote";

/**
 * Clones `url` into `into`, the project folder itself.
 *
 * Returns the `Repo` and the last progress the transfer reported, so a caller
 * can show what arrived. Not atomic: a failed clone may leave a partial folder,
 * and deleting it is a decision about the user's disk, which core does not get
 * to make.
 */
export const cloneRepository = (
  url: string,
  into: string,
): Effect.Effect<{ readonly repo: Repo; readonly progress: Progress }, RemoteError, Remote> =>
  Effect.gen(function* () {
    const remote = yield* Remote;
    return yield* remote.clone(url, into);
  });
