/**
 * Sync from wherever someone is, not only from `/cloud`: the app bar's cloud
 * button and Review's status line both offer the one right move, and this is
 * that move — the same for both, so they cannot disagree.
 *
 * Fewer moves than `/cloud` has, on purpose. Anything that receives goes
 * through Review ("See the changes"), where every passage is shown before it
 * lands; a send and a check are one press; everything else — signing in,
 * attaching, finishing a stopped transfer — is `/cloud`'s, and the button says
 * so by taking you there.
 */

import { useNavigate } from "@tanstack/solid-router";
import { createSignal, type Accessor } from "solid-js";

import type { Sync } from "#core/sync";

import { t } from "../../i18n";
import type { Shell } from "../../ProjectContext";
import { checkForChanges, sendNow } from "../../syncActions";
import { syncWatch } from "../../syncWatch";
import { toasts } from "../primitives";
import { sendOutcomeCopy } from "./copy";

export type QuickAction = "see" | "send" | "check" | "open";

/** The state's one right button, as a move that can be made from here. */
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
    case "sign-in":
    case "attach":
    case "publish":
    case "resolve":
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
    case "open":
      return t("Open Sync");
  }
};

/**
 * How loudly the cloud should ask for attention.
 *
 * `alert` is something waiting on a person: versions to review, a send that
 * was refused, a sign-in, a transfer that stopped. `tint` is work that has
 * not left this device yet and nothing went wrong — it is waiting on a press,
 * not on a problem. Everything else is quiet.
 */
export const attentionOf = (sync: Sync | undefined): "none" | "tint" | "alert" => {
  // A project attached to nothing owes the shared project nothing: whether
  // anyone is signed in is not this project's alarm.
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

/**
 * The shared project's address, to hand to a teammate: no credentials, and
 * no `.git`, so it opens in a browser and still clones.
 */
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
  /** Which move is running now, or "" when none is. */
  readonly busy: Accessor<"" | "send" | "check">;
  readonly run: (action: QuickAction) => void;
}

export const createQuickSync = (
  shell: Shell,
  /** What "See the changes" does; by default it opens Review against the shared project. */
  onSee?: () => void,
): QuickSync => {
  const navigate = useNavigate();
  const { services } = shell;
  const [busy, setBusy] = createSignal<"" | "send" | "check">("", { name: "quickSyncBusy" });
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
        void navigate({ to: "/project/$slug/cloud", params: { slug: shell.slug() }, search: {} });
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
