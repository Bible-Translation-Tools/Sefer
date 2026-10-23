import { Effect, FileSystem, Option } from "effect";

import { Git, type Repo } from "../git/git";
import { excludeSeferFolder } from "../git/intake";
import { Observability } from "../observability";
import { appendArrival } from "../project/provenance";
import { Remote, type CloneOptions, type Progress, type RemoteError } from "./remote";

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
    yield* Effect.ignore(excludeSeferFolder(fileSystem, into));
    yield* Effect.ignore(
      appendArrival(fileSystem, into, {
        via: "remote",
        url,
        ...(catalogueId === undefined ? {} : { catalogueId }),
      }),
    );
    if (options?.history === undefined && remote.backfills)
      yield* Effect.forkDetach(backfill(cloned.repo));
    return cloned;
  });

const BACKFILL_STEP = 200;

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
