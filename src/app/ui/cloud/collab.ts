import { m } from "#app/paraglide/messages";
import type { Project } from "#core/project/project";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
import type { Services } from "../../services";
import { workInOwnCopy, workInShared } from "../../suggestions";
import { syncWatch } from "../../syncWatch";
import { toasts } from "../primitives";

export type Chose = "done" | "standalone" | "failed";

export const chooseOwnCopy = async (services: Services, project: Project): Promise<Chose> => {
  try {
    const outcome = await workInOwnCopy(services, project);
    switch (outcome.kind) {
      case "copy":
        toasts.success({
          title: m.cloud_youre_working_in_your_own_copy(),
          message:
            outcome.renamed === true
              ? m.cloud_you_already_had_a_project({ copy: outcome.copy })
              : m.cloud_your_changes_go_to_copy({
                  copy: outcome.copy,
                }),
        });
        break;
      case "rerooted":
        toasts.success({
          title: m.cloud_this_project_is_your_copy({ shared: outcome.shared }),
          message: m.cloud_your_changes_stay_in_your(),
        });
        break;
      case "standalone":
        return "standalone";
    }
    return "done";
  } catch (cause) {
    toasts.error({ title: m.cloud_could_not_set_up_your(), message: describe(cause) });
    return "failed";
  } finally {
    await Promise.all([
      collaboration.refresh(services, project),
      syncWatch.refresh(services, project).catch(() => undefined),
    ]);
  }
};

export const chooseShared = async (services: Services, project: Project): Promise<void> => {
  await workInShared(services, project).catch(() => undefined);
  await Promise.all([
    collaboration.refresh(services, project),
    syncWatch.refresh(services, project).catch(() => undefined),
  ]);
};
