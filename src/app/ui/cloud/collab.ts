import type { Project } from "#core/project/project";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
import { t } from "../../i18n";
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
          title: t("You're working in your own copy"),
          message:
            outcome.renamed === true
              ? t(
                  "You already had a project of that name, so your copy is {copy}. Your changes go there; offer them to the shared project when ready.",
                  { copy: outcome.copy },
                )
              : t("Your changes go to {copy}. Offer them to the shared project when ready.", {
                  copy: outcome.copy,
                }),
        });
        break;
      case "rerooted":
        toasts.success({
          title: t("This project is your copy of {shared}", { shared: outcome.shared }),
          message: t("Your changes stay in your copy until you offer them."),
        });
        break;
      case "standalone":
        return "standalone";
    }
    return "done";
  } catch (cause) {
    toasts.error({ title: t("Could not set up your copy"), message: describe(cause) });
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
