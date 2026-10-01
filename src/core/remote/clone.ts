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
import { Effect, FileSystem, Option } from "effect";

import { Git, type Repo } from "../git/git";
import { excludeSeferFolder } from "../git/intake";
import { Observability } from "../observability";
import { appendArrival } from "../project/provenance";
import { Remote, type CloneOptions, type Progress, type RemoteError } from "./remote";

/**
 * Clones `url` into `into`, the project folder itself.
 *
 * `catalogueId` is the Find row's `owner/repo`, when the clone started there.
 * `options.history` is how much history to take now; left unsaid it is the
 * newest version, and a host that backfills (desktop) brings the rest behind
 * the clone without holding it up. A reference text says `latest`, and gets
 * the newest version only.
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
  Remote | Git | FileSystem.FileSystem
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
    // Where the host fills the history in behind the clone, and the caller
    // left the choice to it, that starts now and the clone returns at once.
    if (options?.history === undefined && remote.backfills)
      yield* Effect.forkDetach(backfill(cloned.repo));
    return cloned;
  });

/** Commits per step of a background backfill: one short turn of the lane each. */
const BACKFILL_STEP = 200;

/**
 * The rest of a newest-version clone's history, a step at a time, until the
 * repository is whole.
 *
 * A step at a time because each one holds the repository's exclusive lane:
 * one long fetch would make a Record a version wait behind the whole
 * download on a slow connection, where a step costs it one short turn. It
 * stops quietly when the repository is whole, when a step brings nothing,
 * when one fails (offline, the project closed), and History offers the rest.
 */
const backfill = (repo: Repo) =>
  Effect.gen(function* () {
    const git = yield* Git;
    const remote = yield* Remote;
    const observability = Option.getOrUndefined(yield* Effect.serviceOption(Observability));
    const operation = observability?.operation("history.deepen", {
      "history.more": "background",
    });
    let steps = 0;
    let loaded = 0;
    while (yield* Effect.orElseSucceed(git.shallow(repo), () => false)) {
      const step = yield* Effect.result(remote.deepen(repo, BACKFILL_STEP));
      if (step._tag === "Failure") {
        operation?.end("declined", { "history.steps": steps, "history.loaded": loaded });
        return;
      }
      steps += 1;
      loaded += step.success.loaded;
      if (step.success.loaded === 0) break;
    }
    operation?.end("passed", { "history.steps": steps, "history.loaded": loaded });
  });
