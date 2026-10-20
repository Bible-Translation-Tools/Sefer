import { useNavigate } from "@tanstack/solid-router";
import { Effect } from "effect";
import { createSignal, type Accessor } from "solid-js";

import { Git } from "#core/git/git";
import { Remote } from "#core/remote/remote";
import type { Sync } from "#core/sync";

import { describe } from "../../describe";
import { t } from "../../i18n";
import type { Shell } from "../../ProjectContext";
import { checkForChanges, sendNow } from "../../syncActions";
import { syncWatch } from "../../syncWatch";
import { toasts } from "../primitives";
import { sendOutcomeCopy } from "./copy";

export type QuickAction = "see" | "send" | "check" | "resolve" | "sign-in" | "open";

export const quickActionOf = (sync: Sync): QuickAction => {
  switch (sync.primary) {
    case "pull":
    case "combine":
    case "compare":
      return "see";
    case "push":
      return "send";
    case "retry":
      return "check";
    case "resolve":
      return "resolve";
    case "sign-in":
      return "sign-in";
    case "attach":
    case "publish":
      return "open";
  }
};

export const quickLabel = (action: QuickAction): string => {
  switch (action) {
    case "see":
      return t("See the changes");
    case "send":
      return t("Send my changes");
    case "check":
      return t("Check for changes");
    case "resolve":
      return t("Finish the transfer");
    case "sign-in":
      return t("Sign in");
    case "open":
      return t("Set up sharing");
  }
};

export const attentionOf = (sync: Sync | undefined): "none" | "tint" | "alert" => {
  if (sync === undefined || sync.reading.origin === undefined) return "none";
  switch (sync.state) {
    case "behind":
    case "diverged":
    case "conflicted":
    case "unauthorized":
      return "alert";
    case "ahead":
      return sync.reading.sendRefused ? "alert" : "tint";
    default:
      return "none";
  }
};

export const shareableLink = (origin: string): string => {
  try {
    const url = new URL(origin);
    url.username = "";
    url.password = "";
    return url.toString().replace(/\.git$/u, "");
  } catch {
    return origin;
  }
};

export interface QuickSync {
  readonly sync: Accessor<Sync | undefined>;
  readonly busy: Accessor<"" | "send" | "check" | "resolve">;
  readonly run: (action: QuickAction) => void;
}

export const createQuickSync = (shell: Shell, onSee?: () => void): QuickSync => {
  const navigate = useNavigate();
  const { services } = shell;
  const [busy, setBusy] = createSignal<"" | "send" | "check" | "resolve">("", {
    name: "quickSyncBusy",
  });
  const sync = (): Sync | undefined => syncWatch.sync(shell.project()?.root);

  const run = (action: QuickAction): void => {
    const project = shell.project();
    if (project === undefined || busy() !== "") return;
    switch (action) {
      case "see":
        if (onSee !== undefined) onSee();
        else
          void navigate({
            to: "/project/$slug/review",
            params: { slug: shell.slug() },
            search: { against: "shared" },
          });
        return;
      case "open":
      case "sign-in":
        void navigate({ to: "/project/$slug/settings", params: { slug: shell.slug() } });
        return;
      case "resolve":
        setBusy("resolve");
        void services
          .run(
            Effect.gen(function* () {
              const git = yield* Git;
              const remote = yield* Remote;
              return yield* remote.abortMerge(yield* git.open(project.root));
            }),
          )
          .catch((cause: unknown) =>
            toasts.error({ title: t("Could not finish the transfer"), message: describe(cause) }),
          )
          .finally(() => {
            setBusy("");
            void syncWatch.refresh(services, project).catch(() => undefined);
          });
        return;
      case "check":
        setBusy("check");
        void checkForChanges(services, project).finally(() => setBusy(""));
        return;
      case "send":
        setBusy("send");
        void sendNow(services, project)
          .then((outcome) => {
            const copy = sendOutcomeCopy(outcome, syncWatch.sync(project.root)?.state);
            const notice = { title: copy.title, message: copy.detail };
            if (copy.tone === "success") toasts.success(notice);
            else if (copy.tone === "warning") toasts.error({ ...notice, autoClose: false });
            else toasts.info(notice);
          })
          .finally(() => setBusy(""));
        return;
    }
  };

  return { sync, busy, run };
};
