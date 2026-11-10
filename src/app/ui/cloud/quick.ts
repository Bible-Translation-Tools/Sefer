import { useNavigate } from "@tanstack/solid-router";
import { Effect } from "effect";
import { createSignal, type Accessor } from "solid-js";

import { m } from "#app/paraglide/messages";
import { Git } from "#core/git/git";
import { Remote } from "#core/remote/remote";
import type { Sync } from "#core/sync";

import { describe } from "../../describe";
import type { Shell } from "../../ProjectContext";
import { checkForChanges, sendNow } from "../../syncActions";
import { syncWatch } from "../../syncWatch";
import { toasts } from "../primitives";
import { createAccount } from "./account";
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
      return m.cloud_see_the_changes();
    case "send":
      return m.common_send_my_changes();
    case "check":
      return m.cloud_check_for_changes();
    case "resolve":
      return m.cloud_finish_the_transfer();
    case "sign-in":
      return m.common_sign_in();
    case "open":
      return m.common_set_up_sharing();
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

const abortTransfer = (root: string) =>
  Effect.gen(function* () {
    const git = yield* Git;
    const remote = yield* Remote;
    return yield* remote.abortMerge(yield* git.open(root));
  });

const announceSend = (
  outcome: Parameters<typeof sendOutcomeCopy>[0],
  state: Sync["state"] | undefined,
): void => {
  const copy = sendOutcomeCopy(outcome, state);
  const notice = { title: copy.title, message: copy.detail };
  if (copy.tone === "success") toasts.success(notice);
  else if (copy.tone === "warning") toasts.error({ ...notice, autoClose: false });
  else toasts.info(notice);
};

type Running = "send" | "check" | "resolve";

// One for the app, not one per control: the sync popover and the review line start the same send.
const [running, setRunning] = createSignal<
  { readonly root: string; readonly action: Running } | undefined
>(undefined, { name: "quickSyncBusy" });

export const createQuickSync = (shell: Shell, onSee?: () => void): QuickSync => {
  const navigate = useNavigate();
  const { services } = shell;
  const busy = (): "" | Running => {
    const held = running();
    return held !== undefined && held.root === shell.project()?.root ? held.action : "";
  };
  const sync = (): Sync | undefined => syncWatch.sync(shell.project()?.root);

  const run = (action: QuickAction): void => {
    const project = shell.project();
    if (project === undefined || busy() !== "") return;
    const setBusy = (next: "" | Running): void => {
      if (next !== "") setRunning({ root: project.root, action: next });
      else setRunning((held) => (held?.root === project.root ? undefined : held));
    };
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
      case "sign-in":
        // After the sync popover has closed, so its dismissal does not close this one.
        setTimeout(() => createAccount(shell).setPanelOpen(true));
        return;
      case "open":
        void navigate({ to: "/project/$slug/settings", params: { slug: shell.slug() } });
        return;
      case "resolve":
        setBusy("resolve");
        void services
          .run(abortTransfer(project.root))
          .catch((cause: unknown) =>
            toasts.error({
              title: m.cloud_could_not_finish_the_transfer(),
              message: describe(cause),
            }),
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
          .then((outcome) => announceSend(outcome, syncWatch.sync(project.root)?.state))
          .finally(() => setBusy(""));
        return;
    }
  };

  return { sync, busy, run };
};
