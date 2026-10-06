/**
 * The cloud in the app bar: where the open project stands with the shared
 * project, without going anywhere to find out.
 *
 * The glyph says it at a glance — a tick when both sides agree, an arrow up
 * for work waiting to be sent, an arrow down for versions to receive, the
 * cloud struck through when the device is offline — and it turns the warning
 * colour, with a "!", when something is waiting on a person: versions to
 * review, a send that was refused, a sign-in. Offline is never the alarm: the
 * work is on disk, and editing goes on.
 *
 * The popover is where sync is done: the state in a sentence, the two clocks,
 * what would arrive, the one right move, the link to hand a teammate, and the
 * account — signing in and out happen here — and publishing a project that is
 * only on this device. Choosing an existing shared project, the mode and the
 * per-project switches are Settings' Cloud section.
 */

import Cloud from "lucide-solid/icons/cloud";
import CloudAlert from "lucide-solid/icons/cloud-alert";
import CloudCheck from "lucide-solid/icons/cloud-check";
import CloudDownload from "lucide-solid/icons/cloud-download";
import CloudOff from "lucide-solid/icons/cloud-off";
import CloudUpload from "lucide-solid/icons/cloud-upload";
import Copy from "lucide-solid/icons/copy";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import { Show, createEffect, createSignal } from "solid-js";

import type { Sync } from "#core/sync";

import { collaboration } from "../../collaboration";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { syncStatus } from "../../syncStatus";
import { syncWatch } from "../../syncWatch";
import { ago } from "../panels/format";
import { Button, IconButton, Input, Popover, cx, toasts } from "../primitives";
import { createAccount } from "./account";
import { SignInForm } from "./AccountCard";
import { CollabSection } from "./CollabSection";
import { stateCopy } from "./copy";
import { PlanBooks } from "./IncomingPlanCard";
import { SyncClocks, toneText } from "./ProjectCard";
import { PublishSection } from "./PublishSection";
import { attentionOf, createQuickSync, quickActionOf, quickLabel, shareableLink } from "./quick";

const glyphOf = (sync: Sync | undefined) => {
  if (sync?.reading.origin === undefined) return <Cloud size={20} />;
  switch (sync.state) {
    case "attached-clean":
      return <CloudCheck size={20} />;
    case "ahead":
    case "unpublished":
      return <CloudUpload size={20} />;
    case "behind":
      return <CloudDownload size={20} />;
    case "diverged":
    case "conflicted":
    case "unauthorized":
      return <CloudAlert size={20} />;
    case "offline":
      return <CloudOff size={20} />;
    default:
      return <Cloud size={20} />;
  }
};

export function SyncButton() {
  const shell = useShell();
  const { services } = shell;
  const quick = createQuickSync(shell);
  const account = createAccount(shell);
  const [open, setOpen] = createSignal(false, { name: "syncButtonOpen" });

  const sync = quick.sync;
  const attention = () => attentionOf(sync());
  const copy = () => {
    const held = sync();
    return held === undefined
      ? undefined
      : // A project attached to nothing is "only on this device", whoever is
        // or is not signed in.
        stateCopy(held.reading.origin === undefined ? "detached" : held.state, {
          sendRefused: held.reading.sendRefused,
          signedIn: held.reading.signedIn,
        });
  };
  const plan = () => syncWatch.facts(shell.project()?.root)?.plan;
  const link = () => {
    const origin = sync()?.reading.origin;
    return origin === undefined ? undefined : shareableLink(origin);
  };
  const fetchedAt = () => {
    const root = shell.project()?.root;
    return root === undefined ? undefined : syncWatch.fetchedAt(root);
  };

  // Coming back online, going offline, or signing in or out changes the answer
  // without anything being read: take the reading again so the glyph says so.
  createEffect(
    () => [syncStatus.online(), account.session()?.username],
    () => {
      const project = shell.project();
      if (project === undefined) return;
      void syncWatch.refresh(services, project).catch(() => undefined);
      // Who is signed in decides what the collaboration facts say. Only once
      // they have been asked: the first ask is the check's, on its schedule.
      if (collaboration.facts(project.root) !== undefined)
        void collaboration.refresh(services, project);
    },
  );

  const openChanged = (next: boolean): void => {
    setOpen(next);
    const project = shell.project();
    // Opening reads again: local work, refs and logs already here.
    if (next && project !== undefined) {
      void syncWatch.refresh(services, project).catch(() => undefined);
      // Somebody looking, with no check made yet (checking on open is off):
      // ask once, so the popover can say how this project is worked on.
      if (collaboration.facts(project.root) === undefined)
        void collaboration.refresh(services, project);
    }
  };

  const run = (action: ReturnType<typeof quickActionOf>): void => {
    if (action === "see" || action === "open" || action === "sign-in") setOpen(false);
    quick.run(action);
  };

  const copyLink = (): void => {
    const held = link();
    if (held === undefined) return;
    void navigator.clipboard
      .writeText(held)
      .then(() => toasts.success({ title: t("Link copied") }))
      .catch(() => toasts.error({ title: t("Could not copy the link"), message: held }));
  };

  return (
    <Show when={shell.project()}>
      <Popover
        label={t("Sync")}
        side="bottom"
        align="end"
        class="w-[min(480px,92vw)]"
        open={open()}
        onOpenChange={openChanged}
        trigger={
          <span class="relative inline-flex" data-sync-attention={attention()}>
            <IconButton
              label={copy()?.headline ?? t("Sync")}
              data-testid="app-bar-sync"
              data-sync-state={sync()?.state ?? "unknown"}
              tooltipSide="bottom"
              aria-pressed={open() ? "true" : "false"}
              class={cx(attention() !== "none" && "text-on-surface-warning")}
              icon={glyphOf(sync())}
            />
            <Show when={attention() === "alert"}>
              <span
                aria-hidden="true"
                class="pointer-events-none absolute end-1 top-1 flex size-4 items-center justify-center rounded-full bg-on-surface-warning text-[10px] leading-none font-bold text-surface-primary"
              >
                !
              </span>
            </Show>
          </span>
        }
      >
        <Show
          when={sync()}
          fallback={
            <p class="text-small text-on-surface-secondary">{t("Reading this project…")}</p>
          }
        >
          {(held) => (
            <div class="space-y-4" data-sync-popover={held().state}>
              <div>
                <h3 class={cx("text-body font-semibold", toneText(copy()?.tone ?? "muted"))}>
                  {copy()?.headline}
                </h3>
                <p class="mt-1 text-small text-on-surface-secondary">{copy()?.detail}</p>
              </div>

              <Show when={held().reading.origin !== undefined}>
                <SyncClocks
                  sync={held()}
                  plan={plan()}
                  class="border-t border-surface-border pt-3"
                />
              </Show>

              <Show when={(plan()?.books.length ?? 0) > 0 ? plan() : undefined}>
                {(arriving) => (
                  <div class="space-y-2 border-t border-surface-border pt-3">
                    <p class="text-smallest tracking-wide text-on-surface-tertiary uppercase">
                      {t("Incoming changes")}
                    </p>
                    <PlanBooks plan={arriving()} />
                  </div>
                )}
              </Show>

              <div class="flex flex-wrap items-center gap-2">
                {/* Signing in and publishing are the forms below, not buttons that go elsewhere. */}
                <Show
                  when={quickActionOf(held()) !== "sign-in" && quickActionOf(held()) !== "open"}
                >
                  <Button
                    size="sm"
                    variant="primary"
                    data-sync-quick={quickActionOf(held())}
                    loading={quick.busy() !== ""}
                    onClick={() => run(quickActionOf(held()))}
                  >
                    {quickLabel(quickActionOf(held()))}
                  </Button>
                </Show>
                <Show
                  when={quickActionOf(held()) !== "check" && held().reading.origin !== undefined}
                >
                  <IconButton
                    size="sm"
                    class="ms-auto"
                    label={
                      fetchedAt() === undefined
                        ? t("Check for changes")
                        : t("Check for changes (last checked {when})", {
                            when: ago(fetchedAt() ?? 0),
                          })
                    }
                    disabled={quick.busy() !== ""}
                    icon={<RefreshCw class={cx(quick.busy() === "check" && "animate-spin")} />}
                    onClick={() => run("check")}
                  />
                </Show>
              </div>

              <CollabSection onLeave={() => setOpen(false)} />

              <Show when={held().reading.origin === undefined}>
                <PublishSection
                  signedIn={account.session() !== undefined}
                  onLeave={() => setOpen(false)}
                />
              </Show>

              <Show when={link()}>
                {(href) => (
                  <details class="border-t border-surface-border pt-3" data-sync-details>
                    <summary class="cursor-pointer text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase">
                      {t("Project details")}
                    </summary>
                    <label
                      class="mt-3 block pb-1 text-smallest text-on-surface-tertiary"
                      for="sync-share-link"
                    >
                      {t("Shared project link — send it to a teammate to work on this project")}
                    </label>
                    <div class="flex items-center gap-2">
                      <Input
                        id="sync-share-link"
                        size="sm"
                        wrapperClass="min-w-0 flex-1"
                        readonly
                        value={href()}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <Button size="sm" variant="secondary" icon={<Copy />} onClick={copyLink}>
                        {t("Copy")}
                      </Button>
                    </div>
                  </details>
                )}
              </Show>
            </div>
          )}
        </Show>

        <Show when={account.host}>
          {(host) => (
            <div class="mt-4 border-t border-surface-border pt-3" data-sync-account>
              <Show
                when={account.session()}
                fallback={<SignInForm account={account} host={host()} />}
              >
                {(held) => (
                  <div class="flex items-center gap-2">
                    <p class="min-w-0 flex-1 text-small break-words text-on-surface-secondary">
                      {t("Signed in to {host} as {user}.", { host: host(), user: held().username })}
                    </p>
                    <Button
                      size="sm"
                      variant="tertiary"
                      onClick={account.signOut}
                      disabled={account.busy()}
                    >
                      {t("Sign out")}
                    </Button>
                  </div>
                )}
              </Show>
            </div>
          )}
        </Show>
      </Popover>
    </Show>
  );
}
