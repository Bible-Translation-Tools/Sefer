import type { JSX } from "@solidjs/web";
import CloudDownload from "lucide-solid/icons/cloud-download";
import CloudUpload from "lucide-solid/icons/cloud-upload";
import Copy from "lucide-solid/icons/copy";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import UserIcon from "lucide-solid/icons/user";
import { Show, createEffect, createSignal, onCleanup, untrack } from "solid-js";

import { emptyReading, sync as syncOf, type Sync, type SyncReading } from "#core/sync";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
import { m } from "../../paraglide/messages";
import { useShell, type Shell } from "../../ProjectContext";
import { suggestMyChanges } from "../../suggestions";
import { sendNow } from "../../syncActions";
import { syncStatus } from "../../syncStatus";
import { syncWatch } from "../../syncWatch";
import { writerWatch } from "../../writerWatch";
import { Button, Input, toasts } from "../primitives";
import { NetworkChip } from "../workspace/StatusChips";
import { createAccount, type Account } from "./account";
import { CollabSection } from "./CollabSection";
import { stateCopy, type StateCopy } from "./copy";
import { putOnline, suggestedName } from "./PublishSection";
import {
  attentionOf,
  createQuickSync,
  shareableLink,
  type QuickAction,
  type QuickSync,
} from "./quick";

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
    .then(() => toasts.success({ title: m.common_link_copied() }))
    .catch(() => toasts.error({ title: m.common_could_not_copy_the_link(), message: held }));
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

/** The sync state, its popover's state and the account: one per place that shows sync. */
const createSync = (shell: Shell) => {
  const quick = createQuickSync(shell);
  const account = createAccount(shell);
  const pop = createSyncPopover(shell, quick, account);
  return { quick, account, pop };
};

type SyncHandle = ReturnType<typeof createSync>;

const DAY = 86_400_000;
const commit = (id: string, at: number) => ({
  id,
  message: "",
  author: { name: "teammate", email: "" },
  at,
});
const ORIGIN = "https://content.bibletranslationtools.org/team/project";

/** Stand-in readings for the chip's design tweak; "live" is the real one. */
const PREVIEWS: Readonly<Record<string, Partial<SyncReading>>> = {
  "not uploaded": { signedIn: true },
  "uploaded today": {
    signedIn: true,
    origin: ORIGIN,
    remoteKnown: true,
    remoteHead: commit("a", Date.now() - 2 * 3_600_000),
  },
  "3 saves waiting": {
    signedIn: true,
    origin: ORIGIN,
    remoteKnown: true,
    remoteHead: commit("a", Date.now() - 3 * DAY),
    ahead: [commit("b", Date.now()), commit("c", Date.now()), commit("d", Date.now())],
  },
  "updates on WACS": {
    signedIn: true,
    origin: ORIGIN,
    remoteKnown: true,
    remoteHead: commit("e", Date.now() - DAY),
    behind: [commit("e", Date.now() - DAY)],
  },
  diverged: {
    signedIn: true,
    origin: ORIGIN,
    remoteKnown: true,
    remoteHead: commit("e", Date.now() - 9 * DAY),
    ahead: [commit("b", Date.now())],
    behind: [commit("e", Date.now() - 9 * DAY)],
  },
  "WACS unreachable": { signedIn: true, origin: ORIGIN, remoteKnown: true, online: false },
  "upload refused": {
    signedIn: true,
    origin: ORIGIN,
    remoteKnown: true,
    remoteHead: commit("a", Date.now() - 3 * DAY),
    ahead: [commit("b", Date.now())],
    sendRefused: true,
  },
  "no permission": {
    signedIn: true,
    origin: "https://content.bibletranslationtools.org/other_teaboogey/en_ulb",
    remoteKnown: true,
    remoteHead: commit("a", Date.now() - 3 * DAY),
    ahead: [commit("b", Date.now()), commit("c", Date.now())],
  },
  "signed out": { origin: ORIGIN, remoteKnown: true, remoteHead: commit("a", Date.now() - DAY) },
};

/**
 * Design scaffolding: a "Sync state" tweak on the chip, so each state can be
 * seen without a WACS account. The design surface loads lazily and installs
 * its handle after the app bar has mounted, so wait for it.
 */
function useStateTweak(choose: (state: string) => void): void {
  let release: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tries = 0;
  const attempt = (): void => {
    // SAFETY: under `__SEFER_DESIGN__` the design surface installs this handle
    // (`src/dev/designSurface.ts`) with `register` of this shape; `unknown` in
    // the global's type only because platform may not import a dev tool.
    const design = globalThis.__sefer?.design as
      | {
          readonly register?: (registration: {
            readonly namespace: string;
            readonly tweaks: readonly {
              readonly key: string;
              readonly label: string;
              readonly kind: "choice";
              readonly options: readonly string[];
            }[];
            readonly onChange: (values: Readonly<Record<string, string>>) => void;
          }) => () => void;
        }
      | undefined;
    if (design?.register === undefined) {
      tries += 1;
      if (tries < 100) timer = setTimeout(attempt, 50);
      return;
    }
    release = design.register({
      namespace: "syncChip",
      tweaks: [
        {
          key: "state",
          label: "Sync state",
          kind: "choice",
          options: ["live", ...Object.keys(PREVIEWS)],
        },
      ],
      onChange: (values) => choose(values["syncChip.state"] ?? "live"),
    });
  };
  attempt();
  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer);
    release?.();
  });
}

/** Who a shared project belongs to: the first part of its path on WACS. */
const ownerOf = (link: string): string | undefined => {
  try {
    return new URL(link).pathname.split("/").find((part) => part !== "");
  } catch {
    return undefined;
  }
};

/** A message with `{user}` in it, the name drawn bold. */
const WithName = (props: { readonly text: string; readonly name: string }) => {
  const at = (): number => props.text.indexOf(props.name);
  return (
    <Show when={at() >= 0} fallback={props.text}>
      {props.text.slice(0, at())}
      <strong class="font-semibold text-on-surface-primary">{props.name}</strong>
      {props.text.slice(at() + props.name.length)}
    </Show>
  );
};

const Body = (props: { readonly children: JSX.Element }) => (
  <p class="text-body text-on-surface-primary">{props.children}</p>
);

/** While something runs, the buttons give way to a bar saying what. */
const Working = (props: { readonly label: string }) => (
  <div class="space-y-2" role="status" data-sync-working>
    <p class="text-small text-on-surface-secondary">{props.label}</p>
    <div class="h-2 overflow-hidden rounded-full bg-surface-secondary">
      <div class="h-full w-1/3 animate-pulse rounded-full bg-brand" />
    </div>
  </div>
);

const changesWaiting = (count: number): string =>
  count === 1 ? m.wacs_one_change_waiting() : m.wacs_changes_waiting({ count });

const pathOf = (href: string): string =>
  URL.canParse(href) ? new URL(href).pathname.replace(/^\//u, "") : href;

/** Where the project lives on WACS, whose it is, and what the link is for. */
const ProjectLocation = (props: { readonly href: string; readonly noWrite: boolean }) => (
  <div class="space-y-2" data-sync-link>
    <label class="block text-small font-semibold text-on-surface-primary" for="wacs-link">
      {m.wacs_project_location()}
    </label>
    <div class="flex items-center gap-2">
      <Input
        id="wacs-link"
        wrapperClass="min-w-0 flex-1"
        readonly
        // The owner and name, which is the part that tells projects apart; Copy gives the whole link.
        value={pathOf(props.href)}
        title={props.href}
        onFocus={(event) => event.currentTarget.select()}
      />
      <Button
        variant="secondary"
        icon={<Copy size={20} />}
        onClick={() => copyToClipboard(props.href)}
      >
        {m.cloud_copy()}
      </Button>
    </div>
    <p class="text-small text-on-surface-tertiary">
      {ownerOf(props.href) === undefined
        ? ""
        : `${m.wacs_owned_by({ owner: ownerOf(props.href) ?? "" })} `}
      {props.noWrite ? m.wacs_no_permission() : m.wacs_share_download()}
    </p>
  </div>
);

/**
 * Under the connection switch: where the work stands with WACS and the next
 * thing to do (SEFER-92, SEFER-83; Thomas's cards, 2026-11-09). Offline, only
 * what is waiting to go up. Online: signed out → Sign in; WACS out of reach →
 * Try again; not on WACS yet → a name and Upload; on WACS → how many changes
 * are waiting, where it lives and whose it is, Upload (Submit changes without
 * permission, which offers them to the owner) and Check for updates. Running
 * work shows a bar; a refused upload says so and offers Retry.
 */
const WacsBody = (props: {
  readonly sync: SyncHandle;
  readonly held: Sync | undefined;
  readonly noWrite: boolean | undefined;
  readonly onLeave: () => void;
}) => {
  const shell = useShell();
  const { quick, account } = untrack(() => props.sync);
  const facts = () => collaboration.facts(shell.project()?.root);
  const noWrite = (): boolean =>
    props.noWrite ?? (facts()?.canWrite === false || facts()?.mode === "copy");
  const waiting = (): number => props.held?.reading.ahead.length ?? 0;
  const user = (): string => account.session()?.username ?? m.wacs_you();

  const opened = untrack(() => shell.project());
  const [name, setName] = createSignal(opened === undefined ? "" : suggestedName(opened), {
    name: "wacsName",
  });
  const [working, setWorking] = createSignal<"" | "publish" | "submit">("", {
    name: "wacsWorking",
  });

  const publish = (event: SubmitEvent): void => {
    event.preventDefault();
    const project = shell.project();
    const chosen = name().trim();
    if (project === undefined || chosen === "" || working() !== "") return;
    setWorking("publish");
    void putOnline(shell.services, project, chosen)
      .then(() => toasts.success({ title: m.cloud_published_as_name({ name: chosen }) }))
      .catch((cause: unknown) =>
        toasts.error({ title: m.cloud_could_not_publish(), message: describe(cause) }),
      )
      .finally(() => setWorking(""));
  };

  // Without permission, an upload goes to the person's own copy and is then
  // offered to the owner in the same step, unless an offer is already waiting.
  const submit = (): void => {
    const project = shell.project();
    if (project === undefined || working() !== "") return;
    setWorking("submit");
    void sendNow(shell.services, project)
      .then(async () => {
        await collaboration.refresh(shell.services, project);
        const now = collaboration.facts(project.root);
        if (now?.offerable === true && now.mine?.kind !== "waiting")
          await suggestMyChanges(shell.services, project);
        await collaboration.refresh(shell.services, project);
        toasts.success({ title: m.wacs_submitted() });
      })
      .catch((cause: unknown) =>
        toasts.error({ title: m.wacs_upload_failed_title(), message: describe(cause) }),
      )
      .finally(() => setWorking(""));
  };

  // The shared project holds versions this device lacks: the next thing to do is look at them.
  const incoming = (): boolean => (props.held?.reading.behind.length ?? 0) > 0;

  const run = (action: QuickAction): void => {
    if (action === "see" || action === "sign-in") props.onLeave();
    quick.run(action);
  };

  const busyLabel = (): string | undefined => {
    if (working() === "publish" || quick.busy() === "send") return m.wacs_uploading();
    if (working() === "submit") return m.wacs_submitting();
    if (quick.busy() === "check") return m.wacs_checking();
    return undefined;
  };

  return (
    <div class="space-y-4" data-sync-popover={props.held?.state ?? "reading"}>
      <Show
        when={!syncStatus.workOffline()}
        fallback={
          <>
            <Body>{m.wacs_offline_body()}</Body>
            <Show when={waiting() > 0}>
              <p class="text-small text-on-surface-secondary">
                {waiting() === 1
                  ? m.wacs_one_ready_when_online()
                  : m.wacs_ready_when_online({ count: waiting() })}
              </p>
            </Show>
          </>
        }
      >
        <Show when={props.held} fallback={<Body>{m.cloud_reading_this_project()}</Body>}>
          {(held) => (
            <Show
              when={held().state !== "offline"}
              fallback={
                <>
                  <Body>{m.wacs_unreachable()}</Body>
                  <Button
                    variant="primary"
                    class="w-full justify-center"
                    icon={<RefreshCw size={20} />}
                    onClick={() => run("check")}
                    data-testid="wacs-try-again"
                  >
                    {m.wacs_try_again()}
                  </Button>
                </>
              }
            >
              <Show
                when={held().reading.signedIn && held().state !== "unauthorized"}
                fallback={
                  <>
                    <Body>{m.wacs_signed_out_body()}</Body>
                    <Button
                      variant="primary"
                      class="w-full justify-center"
                      icon={<UserIcon size={20} />}
                      onClick={() => run("sign-in")}
                      data-testid="sync-sign-in"
                    >
                      {m.common_sign_in_to_wacs()}
                    </Button>
                  </>
                }
              >
                <Show
                  when={held().reading.origin}
                  fallback={
                    <form class="space-y-4" onSubmit={publish} data-sync-publish>
                      <Body>
                        <WithName text={m.wacs_not_uploaded_body({ user: user() })} name={user()} />
                      </Body>
                      <div class="space-y-2">
                        <label
                          class="block text-small font-semibold text-on-surface-primary"
                          for="wacs-name"
                        >
                          {m.wacs_project_location()}
                        </label>
                        <Input
                          id="wacs-name"
                          wrapperClass="w-full"
                          value={name()}
                          onInput={(event) => setName(event.currentTarget.value)}
                        />
                        <p class="text-small text-on-surface-tertiary">{m.wacs_name_hint()}</p>
                      </div>
                      <Show
                        when={busyLabel()}
                        fallback={
                          <Button
                            type="submit"
                            variant="primary"
                            class="w-full justify-center"
                            icon={<CloudUpload size={20} />}
                            disabled={name().trim() === ""}
                            data-testid="wacs-put-online"
                          >
                            {m.menu_upload_to_wacs()}
                          </Button>
                        }
                      >
                        {(label) => <Working label={label()} />}
                      </Show>
                    </form>
                  }
                >
                  {(origin) => (
                    <>
                      <Body>
                        <WithName text={m.wacs_connected_body({ user: user() })} name={user()} />{" "}
                        {waiting() > 0 ? changesWaiting(waiting()) : m.wacs_all_uploaded()}
                      </Body>
                      <Show when={incoming()}>
                        <p class="text-small text-on-surface-primary" data-sync-incoming>
                          {m.cloud_there_are_updates_to_receive()}
                        </p>
                      </Show>
                      <Show when={held().reading.sendRefused}>
                        <p class="text-small text-on-surface-error" data-sync-failed>
                          {m.wacs_upload_failed_body()}
                        </p>
                      </Show>
                      <Show when={facts()?.mine?.kind === "waiting"}>
                        <p class="text-small text-on-surface-secondary">{m.wacs_waiting_owner()}</p>
                      </Show>
                      <ProjectLocation href={shareableLink(origin())} noWrite={noWrite()} />
                      <CollabSection onLeave={props.onLeave} />
                      <Show
                        when={busyLabel()}
                        fallback={
                          <div class="space-y-2">
                            <Show when={incoming()}>
                              <Button
                                variant="primary"
                                class="w-full justify-center"
                                onClick={() => run("see")}
                                data-testid="wacs-see"
                              >
                                {m.cloud_see_the_changes()}
                              </Button>
                            </Show>
                            <Button
                              variant={waiting() > 0 && !incoming() ? "primary" : "secondary"}
                              class="w-full justify-center"
                              icon={<CloudUpload size={20} />}
                              disabled={waiting() === 0}
                              onClick={() => (noWrite() ? submit() : run("send"))}
                              data-testid="wacs-upload"
                            >
                              {held().reading.sendRefused
                                ? m.wacs_retry_upload()
                                : noWrite()
                                  ? m.wacs_submit_changes()
                                  : m.menu_upload_to_wacs()}
                            </Button>
                            <Button
                              variant={waiting() > 0 || incoming() ? "secondary" : "primary"}
                              class="w-full justify-center"
                              icon={<CloudDownload size={20} />}
                              onClick={() => run("check")}
                              data-testid="wacs-check"
                            >
                              {m.menu_check_for_updates()}
                            </Button>
                          </div>
                        }
                      >
                        {(label) => <Working label={label()} />}
                      </Show>
                    </>
                  )}
                </Show>
              </Show>
            </Show>
          )}
        </Show>
      </Show>
    </div>
  );
};

/** Stand-ins for the design tweak that also need the person to have no permission. */
const NO_WRITE_PREVIEWS = new Set(["no permission"]);

/**
 * The app bar's connection chip (SEFER-92, SEFER-83): Online or Offline, which
 * the person can switch. Its popover says where the work stands with WACS and
 * what to do next. A dot on the chip says something waits on the person.
 */
export function SyncChip() {
  const sync = createSync(useShell());
  const [preview, setPreview] = createSignal("live", { name: "syncChipPreview", ownedWrite: true });
  if (__SEFER_DESIGN__) useStateTweak(setPreview);
  const held = (): Sync | undefined => {
    const stand = PREVIEWS[preview()];
    return stand === undefined ? sync.quick.sync() : syncOf({ ...emptyReading, ...stand });
  };
  const tone = (): "none" | "tint" | "alert" =>
    preview() === "live" ? sync.pop.attention() : attentionOf(held());
  return (
    <NetworkChip
      attention={tone()}
      onOpenChange={(open) => {
        if (open) sync.pop.openChanged(true);
      }}
      body={(close) => (
        <WacsBody
          sync={sync}
          held={held()}
          noWrite={NO_WRITE_PREVIEWS.has(preview()) ? true : undefined}
          onLeave={close}
        />
      )}
    />
  );
}
