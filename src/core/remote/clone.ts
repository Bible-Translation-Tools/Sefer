/**
 * Cloning: `Remote.clone`, as the one Effect the landing screens run.
 *
 * It used to be `init`, `attach`, then `pull`, on the argument that a clone is
 * no distinct capability. It is one: an `init` has already chosen a branch
 * (`main`) before the server has been asked, so a repository on `master`
 * could not arrive, and a pull into that unborn branch had nothing to merge
 * into. A real clone asks the server which branch HEAD names and checks that
 * out, which is what `git clone` does and what both hosts' libraries do.
 *
 * A successful clone then records its arrival in `.sefer/provenance.json`,
 * with the URL as the caller gave it rather than the endpoint it went through.
 * After the clone, not before: git refuses to clone into a folder that is not
 * empty, and a record of a clone that failed would be a false one.
 */
import { Effect, FileSystem } from "effect";

import type { Repo } from "../git/git";
import { excludeSeferFolder } from "../git/intake";
import { appendArrival } from "../project/provenance";
import { Remote, type CloneOptions, type Progress, type RemoteError } from "./remote";

/**
 * Clones `url` into `into`, the project folder itself.
 *
 * `catalogueId` is the Find row's `owner/repo`, when the clone started there.
 * `options.history` is how much history to take now; left unsaid, the host
 * chooses (`CloneHistory`). A reference text asks for `latest`.
 *
 * Returns the `Repo` and the last progress the transfer reported, so a caller
 * can show what arrived. Not atomic: a failed clone may leave a partial folder,
 * and deleting it is a decision about the user's disk, which core does not get
 * to make.
 */
export const cloneRepository = (
  url: string,
  into: string,
  catalogueId?: string,
  options?: CloneOptions,
): Effect.Effect<
  { readonly repo: Repo; readonly progress: Progress },
  RemoteError,
  Remote | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const remote = yield* Remote;
    const fileSystem = yield* FileSystem.FileSystem;
    const cloned = yield* remote.clone(url, into, options);
    // This device's corner stays out of the repository from the first
    // moment, before provenance writes into it. A clone's HEAD is its
    // arrival, so there is nothing to commit.
    yield* Effect.ignore(excludeSeferFolder(fileSystem, into));
    // A clone that arrived but could not be recorded is still a clone: the
    // project is on disk and works, and its row simply says "from" nothing.
    yield* Effect.ignore(
      appendArrival(fileSystem, into, {
        via: "remote",
        url,
        ...(catalogueId === undefined ? {} : { catalogueId }),
      }),
    );
    return cloned;
  });
