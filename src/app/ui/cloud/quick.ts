/**
 * Sync from wherever someone is: the app bar's cloud button and Review's
 * status line both offer the one right move, and this is that move — the same
 * for both, so they cannot disagree.
 *
 * Anything that receives goes through Review ("See the changes"), where every
 * passage is shown before it lands; a send, a check and finishing a stopped
 * transfer are one press; signing in and publishing are the popover's own
 * forms, and a surface without them is taken to Settings' Cloud section.
 */

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

/**
 * `open` is setting sharing up — choosing or publishing a shared project — and
 * takes a surface without the popover's forms to Settings' Cloud section; the
 * name is from when it opened `/cloud`.
 */
export type QuickAction = "see" | "send" | "check" | "resolve" | "sign-in" | "open";

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
  readonly busy: Accessor<"" | "send" | "check" | "resolve">;
  readonly run: (action: QuickAction) => void;
}

export const createQuickSync = (
  shell: Shell,
  /** What "See the changes" does; by default it opens Review against the shared project. */
  onSee?: () => void,
): QuickSync => {
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
      // Signing in, and choosing or publishing a shared project, are Settings'
      // Cloud section's on a surface without the popover's own forms.
      case "open":
      case "sign-in":
        void navigate({ to: "/settings" });
        return;
      case "resolve":
        // A hard reset underneath, which is why `abortMerge` refuses when no
        // merge is in progress: on a clean repository it would discard unsaved
        // work instead of undoing a transfer. Only `conflicted` offers it.
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
