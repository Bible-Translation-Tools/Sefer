import { Effect } from "effect";

import { Git } from "#core/git/git";
import type { Project } from "#core/project/project";
import { Remote } from "#core/remote/remote";

import { collaboration } from "../../collaboration";
import type { Shell } from "../../ProjectContext";
import { syncWatch } from "../../syncWatch";
import { metadataOf } from "../workspace/project";

export const suggestedName = (project: Project): string => {
  const metadata = metadataOf(project);
  const language = metadata?.language.tag ?? "";
  const resource = metadata?.id ?? "";
  const folder = project.root.slice(project.root.lastIndexOf("/") + 1);
  let named = resource !== "" ? resource : folder;
  if (language !== "" && resource !== "" && !resource.includes(language))
    named = `${language}_${resource}`;
  return named.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-");
};

/** Makes the project on WACS under the signed-in account, sends this device's versions there, and refreshes what the cloud menu knows. */
export const putOnline = (
  services: Shell["services"],
  project: Project,
  staticName: string,
): Promise<void> =>
  services
    .run(
      Effect.gen(function* () {
        const git = yield* Git;
        const remote = yield* Remote;
        yield* remote.publish(yield* git.init(project.root), staticName);
      }),
    )
    .finally(() => {
      void syncWatch.refresh(services, project).catch(() => undefined);
      void collaboration.refresh(services, project);
    });
