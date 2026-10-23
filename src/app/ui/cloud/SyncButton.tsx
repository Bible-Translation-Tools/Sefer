import Cloud from "lucide-solid/icons/cloud";
import CloudAlert from "lucide-solid/icons/cloud-alert";
import CloudCheck from "lucide-solid/icons/cloud-check";
import CloudDownload from "lucide-solid/icons/cloud-download";
import CloudOff from "lucide-solid/icons/cloud-off";
import CloudUpload from "lucide-solid/icons/cloud-upload";
import Copy from "lucide-solid/icons/copy";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import { Show, createEffect, createSignal, untrack } from "solid-js";

import type { Sync } from "#core/sync";

import { collaboration } from "../../collaboration";
import { t } from "../../i18n";
import { useShell, type Shell } from "../../ProjectContext";
import { syncStatus } from "../../syncStatus";
import { syncWatch } from "../../syncWatch";
import { writerWatch } from "../../writerWatch";
import { ago } from "../panels/format";
import { Button, IconButton, Input, Popover, cx, toasts } from "../primitives";
import { createAccount, type Account } from "./account";
import { SignInForm } from "./AccountCard";
import { CollabSection } from "./CollabSection";
import { stateCopy, type StateCopy } from "./copy";
import { PlanBooks } from "./IncomingPlanCard";
import { SyncClocks } from "./ProjectCard";
import { PublishSection } from "./PublishSection";
import {
  attentionOf,
  createQuickSync,
  quickActionOf,
  quickLabel,
  shareableLink,
  type QuickAction,
  type QuickSync,
} from "./quick";
import { WriterSection } from "./WriterSection";

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

const copyOf = (held: Sync | undefined, inCopy: boolean): StateCopy | undefined =>
  held === undefined
    ? undefined
    : stateCopy(held.reading.origin === undefined ? "detached" : held.state, {
        sendRefused: held.reading.sendRefused,
        signedIn: held.reading.signedIn,
        inCopy,
      });

const copyToClipboard = (held: string): void => {
  void navigator.clipboard
    .writeText(held)
    .then(() => toasts.success({ title: t("Link copied") }))
    .catch(() => toasts.error({ title: t("Could not copy the link"), message: held }));
};

const createSyncPopover = (shell: Shell, quick: QuickSync, account: Account) => {
  const { services } = shell;
  const [open, setOpen] = createSignal(false, { name: "syncButtonOpen" });

  const sync = quick.sync;
  const link = () => {
    const origin = sync()?.reading.origin;
    return origin === undefined ? undefined : shareableLink(origin);
  };

  // Untracked on purpose: a one-time read, not a dependency (Solid 2: STRICT_READ_UNTRACKED).
  createEffect(
    () => ({
      project: shell.project(),
      online: syncStatus.online(),
      user: account.session()?.username,
    }),
    ({ project }) => {
      if (project === undefined) return;
      void syncWatch.refresh(services, project).catch(() => undefined);
      if (untrack(() => collaboration.facts(project.root)) !== undefined)
        void collaboration.refresh(services, project);
    },
  );

  return {
    open,
    setOpen,
    link,
    attention: () =>
      writerWatch.facts(shell.project()?.root).work.length > 0 ? "alert" : attentionOf(sync()),
    copy: () => copyOf(sync(), collaboration.facts(shell.project()?.root)?.mode === "copy"),
    plan: () => syncWatch.facts(shell.project()?.root)?.plan,
    fetchedAt: () => {
      const root = shell.project()?.root;
      return root === undefined ? undefined : syncWatch.fetchedAt(root);
    },
    openChanged: (next: boolean): void => {
      setOpen(next);
      const project = shell.project();
      if (next && project !== undefined) {
        void syncWatch.refresh(services, project).catch(() => undefined);
        if (collaboration.facts(project.root) === undefined)
          void collaboration.refresh(services, project);
      }
    },
    run: (action: QuickAction): void => {
      if (action === "see" || action === "open" || action === "sign-in") setOpen(false);
      quick.run(action);
    },
    copyLink: (): void => {
      const held = link();
      if (held !== undefined) copyToClipboard(held);
    },
  };
};

const SyncTrigger = (props: {
  readonly attention: "none" | "tint" | "alert";
  readonly headline: string | undefined;
  readonly sync: Sync | undefined;
  readonly open: boolean;
}) => (
  <span class="relative inline-flex" data-sync-attention={props.attention}>
    <IconButton
      label={props.headline ?? t("Sync")}
      data-testid="app-bar-sync"
      data-sync-state={props.sync?.state ?? "unknown"}
      tooltipSide="bottom"
      aria-pressed={props.open ? "true" : "false"}
      class={cx(props.attention !== "none" && "text-on-surface-warning")}
      icon={glyphOf(props.sync)}
    />
    <Show when={props.attention === "alert"}>
      <span
        aria-hidden="true"
        class="pointer-events-none absolute end-1 top-1 flex size-4 items-center justify-center rounded-full bg-on-surface-warning text-[10px] leading-none font-bold text-surface-primary"
      >
        !
      </span>
    </Show>
  </span>
);

const StateHeading = (props: { readonly copy: StateCopy | undefined }) => (
  <div>
    <h3 class="flex items-center gap-2 text-body font-semibold text-on-surface-primary">
      <Show when={props.copy?.tone === "warning" || props.copy?.tone === "error"}>
        <span
          aria-hidden="true"
          class={cx(
            "size-2 shrink-0 rounded-full",
            props.copy?.tone === "error" ? "bg-on-surface-error" : "bg-on-surface-warning",
          )}
        />
      </Show>
      {props.copy?.headline}
    </h3>
    <p class="mt-1 text-small text-on-surface-tertiary">{props.copy?.detail}</p>
  </div>
);

const QuickRow = (props: {
  readonly held: Sync;
  readonly quick: QuickSync;
  readonly fetchedAt: number | undefined;
  readonly onRun: (action: QuickAction) => void;
}) => (
  <div class="flex flex-wrap items-center gap-2">
    <Show when={quickActionOf(props.held) !== "sign-in" && quickActionOf(props.held) !== "open"}>
      <Button
        size="sm"
        variant="primary"
        data-sync-quick={quickActionOf(props.held)}
        loading={props.quick.busy() !== ""}
        onClick={() => props.onRun(quickActionOf(props.held))}
      >
        {quickLabel(quickActionOf(props.held))}
      </Button>
    </Show>
    <Show when={quickActionOf(props.held) !== "check" && props.held.reading.origin !== undefined}>
      <Show when={props.fetchedAt}>
        {(at) => (
          <span class="ms-auto text-smallest text-on-surface-tertiary">
            {t("checked {when}", { when: ago(at()) })}
          </span>
        )}
      </Show>
      <IconButton
        size="sm"
        class={props.fetchedAt === undefined ? "ms-auto" : undefined}
        label={
          props.fetchedAt === undefined
            ? t("Check for changes")
            : t("Check for changes (last checked {when})", {
                when: ago(props.fetchedAt ?? 0),
              })
        }
        disabled={props.quick.busy() !== ""}
        icon={<RefreshCw class={cx(props.quick.busy() === "check" && "animate-spin")} />}
        onClick={() => props.onRun("check")}
      />
    </Show>
  </div>
);

const ShareLink = (props: { readonly href: string; readonly onCopy: () => void }) => (
  <details class="border-t border-surface-border pt-3" data-sync-details>
    <summary class="cursor-pointer text-smallest font-medium text-on-surface-tertiary">
      {t("Project details")}
    </summary>
    <label class="mt-3 block pb-1 text-smallest text-on-surface-tertiary" for="sync-share-link">
      {t("Shared project link — send it to a teammate to work on this project")}
    </label>
    <div class="flex items-center gap-2">
      <Input
        id="sync-share-link"
        size="sm"
        wrapperClass="min-w-0 flex-1"
        readonly
        value={props.href}
        onFocus={(event) => event.currentTarget.select()}
      />
      <Button size="sm" variant="secondary" icon={<Copy />} onClick={props.onCopy}>
        {t("Copy")}
      </Button>
    </div>
  </details>
);

const SyncDetails = (props: {
  readonly held: Sync;
  readonly pop: ReturnType<typeof createSyncPopover>;
  readonly quick: QuickSync;
  readonly account: Account;
}) => (
  <div class="space-y-4" data-sync-popover={props.held.state}>
    <StateHeading copy={props.pop.copy()} />

    <Show when={props.held.reading.origin !== undefined}>
      <SyncClocks
        sync={props.held}
        plan={props.pop.plan()}
        class="border-t border-surface-border pt-3"
      />
    </Show>

    <Show when={(props.pop.plan()?.books.length ?? 0) > 0 ? props.pop.plan() : undefined}>
      {(arriving) => (
        <div class="space-y-2 border-t border-surface-border pt-3">
          <p class="text-smallest font-medium text-on-surface-tertiary">{t("Incoming changes")}</p>
          <PlanBooks plan={arriving()} />
        </div>
      )}
    </Show>

    <QuickRow
      held={props.held}
      quick={props.quick}
      fetchedAt={props.pop.fetchedAt()}
      onRun={props.pop.run}
    />

    <CollabSection onLeave={() => props.pop.setOpen(false)} />

    <WriterSection onLeave={() => props.pop.setOpen(false)} />

    <Show when={props.held.reading.origin === undefined}>
      <PublishSection
        signedIn={props.account.session() !== undefined}
        onLeave={() => props.pop.setOpen(false)}
      />
    </Show>

    <Show when={props.pop.link()}>
      {(href) => <ShareLink href={href()} onCopy={props.pop.copyLink} />}
    </Show>
  </div>
);

const AccountRow = (props: { readonly account: Account; readonly host: string }) => (
  <div class="mt-4 border-t border-surface-border pt-3" data-sync-account>
    <Show
      when={props.account.session()}
      fallback={<SignInForm account={props.account} host={props.host} />}
    >
      {(held) => (
        <div class="flex items-center gap-2">
          <p class="min-w-0 flex-1 text-small break-words text-on-surface-secondary">
            <span class="font-medium text-on-surface-primary">{held().username}</span>
            <span class="text-on-surface-tertiary">
              {" · "}
              {props.host.replace(/^https?:\/\//u, "")}
            </span>
          </p>
          <Button
            size="sm"
            variant="tertiary"
            onClick={props.account.signOut}
            disabled={props.account.busy()}
          >
            {t("Sign out")}
          </Button>
        </div>
      )}
    </Show>
  </div>
);

export function SyncButton() {
  const shell = useShell();
  const quick = createQuickSync(shell);
  const account = createAccount(shell);
  const pop = createSyncPopover(shell, quick, account);

  return (
    <Show when={shell.project()}>
      <Popover
        label={t("Sync")}
        side="bottom"
        align="end"
        class="w-[min(480px,92vw)]"
        open={pop.open()}
        onOpenChange={pop.openChanged}
        trigger={
          <SyncTrigger
            attention={pop.attention()}
            headline={pop.copy()?.headline}
            sync={quick.sync()}
            open={pop.open()}
          />
        }
      >
        <Show
          when={quick.sync()}
          fallback={
            <p class="text-small text-on-surface-secondary">{t("Reading this project…")}</p>
          }
        >
          {(held) => <SyncDetails held={held()} pop={pop} quick={quick} account={account} />}
        </Show>

        <Show when={account.host}>{(host) => <AccountRow account={account} host={host()} />}</Show>
      </Popover>
    </Show>
  );
}
