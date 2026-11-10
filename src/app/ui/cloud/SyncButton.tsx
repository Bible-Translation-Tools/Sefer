import { Effect, Option } from "effect";
import CircleHelp from "lucide-solid/icons/circle-help";
import CloudUpload from "lucide-solid/icons/cloud-upload";
import Copy from "lucide-solid/icons/copy";
import GitCompare from "lucide-solid/icons/git-compare";
import Link2 from "lucide-solid/icons/link-2";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import UserIcon from "lucide-solid/icons/user";
import { Show, createEffect, createSignal, onCleanup, untrack } from "solid-js";

import { Git, repositoryPath } from "#core/git/git";
import { Gitea } from "#core/remote/gitea";
import { Remote } from "#core/remote/remote";
import { emptyReading, sync as syncOf, type Sync, type SyncReading } from "#core/sync";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
import { m } from "../../paraglide/messages";
import { useShell, type Shell } from "../../ProjectContext";
import { suggestMyChanges } from "../../suggestions";
import { sendNow } from "../../syncActions";
import { syncStatus } from "../../syncStatus";
import { syncWatch } from "../../syncWatch";
import { Button, Input, Tooltip, toasts } from "../primitives";
import { bookName } from "../workspace/books";
import { NetworkChip } from "../workspace/StatusChips";
import { createAccount, type Account } from "./account";
import { CollabSection } from "./CollabSection";
import { sendOutcomeCopy, stateCopy, type StateCopy } from "./copy";
import { putOnline, suggestedName } from "./PublishSection";
import { createQuickSync, shareableLink, type QuickAction, type QuickSync } from "./quick";

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
  "review before upload": {
    signedIn: true,
    origin: ORIGIN,
    remoteKnown: true,
    remoteHead: commit("e", Date.now() - DAY),
    ahead: [commit("b", Date.now()), commit("c", Date.now())],
    behind: [commit("e", Date.now() - DAY)],
    sendRefused: true,
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
      // The design surface can arrive well after the app bar (a slow first
      // load, a lazy chunk), so keep waiting, more slowly after a while.
      tries += 1;
      timer = setTimeout(attempt, tries < 100 ? 50 : 500);
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

/**
 * A failure in a few words for the line under the button: a name WACS
 * already holds says so; anything else is the first sentence of what the
 * error says.
 */
const briefly = (cause: unknown): string => {
  const said = describe(cause);
  if (/\b409\b|already exists/iu.test(said)) return m.wacs_name_taken();
  const first = said.split(/(?<=[.!?])\s|\n/u)[0] ?? said;
  return first.length > 120 ? `${first.slice(0, 117)}…` : first;
};

/** Projects whose refused upload the person has already been shown once. */
const [failureSeen, setFailureSeen] = createSignal<ReadonlySet<string>>(new Set(), {
  name: "wacsFailureSeen",
  ownedWrite: true,
});
const markSeen = (root: string, seen: boolean): void => {
  setFailureSeen((held) => {
    if (held.has(root) === seen) return held;
    const next = new Set(held);
    if (seen) next.add(root);
    else next.delete(root);
    return next;
  });
};

/** Who a shared project belongs to: the first part of its path on WACS. */
const ownerOf = (link: string): string | undefined => {
  try {
    return new URL(link).pathname.split("/").find((part) => part !== "");
  } catch {
    return undefined;
  }
};

/** While something runs, the buttons give way to a bar saying what. */
const Working = (props: { readonly label: string }) => (
  <div class="space-y-2" role="status" data-sync-working>
    <p class="text-small text-on-surface-secondary">{props.label}</p>
    <div class="h-2 overflow-hidden rounded-full bg-surface-secondary">
      <div class="h-full w-1/3 animate-pulse rounded-full bg-brand" />
    </div>
  </div>
);

/**
 * What waits to go up, by book: "Changes to Luke", "Changes to Luke and
 * Romans", or past two, "Changes to 12 books". Without the book list (still
 * being worked out, or unreadable) it says "Your saved changes".
 */
const waitingWhat = (books: readonly string[] | undefined): string => {
  if (books === undefined || books.length === 0) return m.wacs_your_saved_changes();
  if (books.length === 1) return m.wacs_changes_to({ books: books[0] ?? "" });
  if (books.length === 2)
    return m.wacs_changes_to({
      books: m.wacs_two_books({ first: books[0] ?? "", second: books[1] ?? "" }),
    });
  return m.wacs_changes_to({ books: m.wacs_count_books({ count: books.length }) });
};

/**
 * Where the project lives on WACS. The link is cut from its start, since every
 * link starts the same and differs at the end; Copy sits inside the box. The
 * ? beside the heading says, in a tooltip, whose project it is and what the
 * link is for.
 */
const ProjectLocation = (props: { readonly href: string; readonly noWrite: boolean }) => {
  const owner = (): string | undefined => ownerOf(props.href);
  const help = (): string =>
    `${owner() === undefined ? "" : `${m.wacs_owned_by({ owner: owner() ?? "" })} `}${
      props.noWrite ? m.wacs_no_permission() : m.wacs_share_download()
    }`;
  return (
    <div class="space-y-2" data-sync-link>
      <div class="flex items-center gap-1">
        <h4 class="text-small font-semibold text-on-surface-primary">
          {m.wacs_project_location()}
        </h4>
        <Tooltip label={help()} side="top">
          <button
            type="button"
            class="inline-flex size-6 cursor-help items-center justify-center rounded-full text-on-surface-tertiary hover:text-on-surface-primary"
            aria-label={`${m.wacs_about_location()}: ${help()}`}
            data-testid="wacs-location-help"
          >
            <CircleHelp size={16} />
          </button>
        </Tooltip>
      </div>
      <div class="flex h-12 items-center rounded-lg border border-surface-border bg-surface-primary">
        <span
          class="min-w-0 flex-1 truncate px-3 text-small text-on-surface-primary [direction:rtl] text-left"
          title={props.href}
          data-testid="wacs-link"
        >
          <bdi dir="ltr">{props.href}</bdi>
        </span>
        <button
          type="button"
          class="flex h-full shrink-0 cursor-pointer items-center gap-1.5 rounded-e-lg border-s border-surface-border px-3 text-small text-on-surface-primary hover:bg-surface-secondary [&>svg]:size-5"
          onClick={() => copyToClipboard(props.href)}
          data-testid="wacs-copy"
        >
          <Copy />
          {m.cloud_copy()}
        </button>
      </div>
    </div>
  );
};

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
  /** A design stand-in: show its state even when this browser isn't signed in. */
  readonly standIn?: boolean;
  readonly noWrite: boolean | undefined;
  readonly onLeave: () => void;
}) => {
  const shell = useShell();
  const { quick, account } = untrack(() => props.sync);
  const facts = () => collaboration.facts(shell.project()?.root);
  const noWrite = (): boolean =>
    props.noWrite ?? (facts()?.canWrite === false || facts()?.mode === "copy");
  const waiting = (): number => props.held?.reading.ahead.length ?? 0;

  // The books the waiting versions touch: what changed between WACS's copy
  // and this device's, read from git once per pair of commits.
  const [waitingBooks, setWaitingBooks] = createSignal<readonly string[] | undefined>(undefined, {
    name: "wacsWaitingBooks",
  });
  createEffect(
    () => ({
      project: shell.project(),
      from: props.held?.reading.remoteHead?.id,
      to: props.held?.reading.localHead?.id ?? props.held?.reading.ahead[0]?.id,
      count: props.held?.reading.ahead.length ?? 0,
    }),
    ({ project, from, to, count }) => {
      if (project === undefined || from === undefined || to === undefined || count === 0) {
        setWaitingBooks(undefined);
        return;
      }
      const metadata = Option.getOrUndefined(project.metadata());
      void shell.services
        .run(
          Effect.gen(function* () {
            const git = yield* Git;
            const repo = yield* git.open(project.root);
            return yield* git.changedPathsBetween(repo, from, to);
          }).pipe(Effect.orElseSucceed(() => undefined)),
        )
        .then((changed) => {
          if (changed === undefined) {
            setWaitingBooks(undefined);
            return;
          }
          const touched = new Set(changed.map((entry) => entry.path));
          setWaitingBooks(
            project.books
              .filter((book) => {
                const inside = repositoryPath(project.root, book.path);
                return Option.isSome(inside) && touched.has(inside.value);
              })
              .map((book) => bookName(book.id, metadata)),
          );
        });
    },
  );
  const user = (): string | undefined => account.session()?.username;

  const opened = untrack(() => shell.project());
  const [name, setName] = createSignal(opened === undefined ? "" : suggestedName(opened), {
    name: "wacsName",
  });
  const [working, setWorking] = createSignal<"" | "publish" | "submit" | "upload">("", {
    name: "wacsWorking",
  });
  // What went wrong with the last attempt from this popover, said in a line
  // under its button instead of a toast at the edge of the screen.
  const [problem, setProblem] = createSignal("", { name: "wacsProblem" });
  // The name was already taken on the person's account: offer to link this
  // project to that one instead of making another.
  const [taken, setTaken] = createSignal(false, { name: "wacsNameTaken" });

  const publish = (event: SubmitEvent): void => {
    event.preventDefault();
    const project = shell.project();
    const chosen = name().trim();
    if (project === undefined || chosen === "" || working() !== "") return;
    setWorking("publish");
    setProblem("");
    void putOnline(shell.services, project, chosen)
      .then(() => toasts.success({ title: m.cloud_published_as_name({ name: chosen }) }))
      .catch((cause: unknown) => {
        const said = briefly(cause);
        setProblem(said);
        setTaken(said === m.wacs_name_taken());
      })
      .finally(() => setWorking(""));
  };

  // Without permission, an upload goes to the person's own copy and is then
  // offered to the owner in the same step, unless an offer is already waiting.
  const submit = (): void => {
    const project = shell.project();
    if (project === undefined || working() !== "") return;
    setWorking("submit");
    setProblem("");
    void sendNow(shell.services, project)
      .then(async (outcome) => {
        if (outcome.kind !== "sent") {
          setProblem(sendOutcomeCopy(outcome).title);
          return;
        }
        await collaboration.refresh(shell.services, project);
        const now = collaboration.facts(project.root);
        if (now?.offerable === true && now.mine?.kind !== "waiting")
          await suggestMyChanges(shell.services, project);
        await collaboration.refresh(shell.services, project);
        toasts.success({ title: m.wacs_submitted() });
      })
      .catch((cause: unknown) => setProblem(briefly(cause)))
      .finally(() => setWorking(""));
  };

  // Link this project to the one of the same name already on the person's
  // account, then let the popover read where things stand.
  const link = (): void => {
    const project = shell.project();
    const host = account.host;
    const owner = user();
    const chosen = name().trim();
    if (project === undefined || host === null || owner === undefined || working() !== "") return;
    setWorking("publish");
    void shell.services
      .run(
        Effect.gen(function* () {
          const gitea = yield* Gitea;
          const found = yield* gitea.getRepo(host, owner, chosen);
          if (Option.isNone(found)) return false;
          const git = yield* Git;
          const remote = yield* Remote;
          yield* remote.attach(yield* git.init(project.root), found.value.cloneUrl);
          return true;
        }),
      )
      .then(async (linked) => {
        if (!linked) {
          setProblem(m.wacs_not_found({ name: chosen }));
          return;
        }
        setProblem("");
        setTaken(false);
        await syncWatch.refresh(shell.services, project).catch(() => undefined);
        await collaboration.refresh(shell.services, project);
        toasts.success({ title: m.wacs_linked({ name: chosen }) });
      })
      .catch((cause: unknown) => setProblem(briefly(cause)))
      .finally(() => setWorking(""));
  };

  const upload = (): void => {
    const project = shell.project();
    if (project === undefined || working() !== "") return;
    setWorking("upload");
    setProblem("");
    void sendNow(shell.services, project)
      .then((outcome) => {
        if (outcome.kind === "sent") toasts.success({ title: sendOutcomeCopy(outcome).title });
        else setProblem(sendOutcomeCopy(outcome).title);
      })
      .catch((cause: unknown) => setProblem(briefly(cause)))
      .finally(() => setWorking(""));
  };

  const run = (action: QuickAction): void => {
    if (action === "see" || action === "sign-in") props.onLeave();
    quick.run(action);
  };

  const busyLabel = (): string | undefined => {
    if (working() === "publish" || working() === "upload" || quick.busy() === "send")
      return m.wacs_uploading();
    if (working() === "submit") return m.wacs_submitting();
    if (quick.busy() === "check") return m.wacs_checking();
    return undefined;
  };

  // A refused upload: the description says so for as long as it lasts, and a
  // red line under the button shows only the first time the popover opens
  // after it, so it is news once and then gets out of the way.
  const refused = (): boolean => props.held?.reading.sendRefused === true;
  const root = untrack(() => shell.project()?.root) ?? "";
  // Seen already only if it was refused when this opening began and shown
  // before; a failure that happens while the popover is open is always news.
  const seenBefore = untrack(() => refused() && failureSeen().has(root));
  if (!untrack(() => refused())) markSeen(root, false);
  onCleanup(() => {
    if (props.held?.reading.sendRefused === true) markSeen(root, true);
  });

  // The one description under the switch: signed in or not, online or not,
  // and whether the project is on WACS and what is waiting. Only the location
  // tooltip and status notes (a failed upload, an offer waiting) sit elsewhere.
  const mode = ():
    | "offline"
    | "reading"
    | "unreachable"
    | "signed-out"
    | "new"
    | "review"
    | "incoming"
    | "on-wacs" => {
    if (syncStatus.workOffline()) return "offline";
    const held = props.held;
    if (held === undefined) return "reading";
    if (held.state === "offline") return "unreachable";
    if ((user() === undefined && props.standIn !== true) || held.state === "unauthorized")
      return "signed-out";
    if (held.reading.origin === undefined) return "new";
    // Both sides moved: the upload waits until the person has reviewed what
    // came in from WACS, so the review is the next step, not a retry.
    if (held.reading.behind.length === 0) return "on-wacs";
    // WACS moved and this device has nothing waiting: there is only something to look at.
    return held.reading.ahead.length > 0 ? "review" : "incoming";
  };
  const origin = (): string | undefined => props.held?.reading.origin;
  const sentences = (): readonly string[] => {
    switch (mode()) {
      case "offline":
        return [
          m.wacs_offline_body(),
          ...(waiting() === 0
            ? []
            : [m.wacs_ready_when_online({ what: waitingWhat(waitingBooks()) })]),
        ];
      case "reading":
        return [m.cloud_reading_this_project()];
      case "unreachable":
        return [m.wacs_unreachable()];
      case "signed-out":
        return [
          origin() === undefined ? m.wacs_signed_out_not_on_wacs() : m.wacs_signed_out_on_wacs(),
        ];
      case "new":
        return [m.wacs_not_on_wacs(), m.wacs_name_suggested()];
      case "review":
        return [m.wacs_on_wacs(), m.wacs_review_needed({ what: waitingWhat(waitingBooks()) })];
      case "incoming":
        return [m.wacs_on_wacs()];
      case "on-wacs":
        return [
          m.wacs_on_wacs(),
          waiting() > 0
            ? m.wacs_not_uploaded_yet({ what: waitingWhat(waitingBooks()) })
            : m.wacs_all_uploaded(),
          ...(refused() ? [m.wacs_last_upload_failed()] : []),
        ];
    }
  };
  const signedIn = (): boolean =>
    mode() === "new" || mode() === "on-wacs" || mode() === "review" || mode() === "incoming";

  return (
    <div class="space-y-4" data-sync-popover={props.held?.state ?? "reading"}>
      <p class="text-body text-on-surface-primary" data-sync-description={mode()}>
        <Show when={signedIn() && user() !== undefined}>
          {m.wacs_signed_in_as()} <strong class="font-semibold">{user()}</strong>.{" "}
        </Show>
        {sentences().join(" ")}
      </p>

      <Show when={mode() === "unreachable"}>
        <Button
          variant="primary"
          class="w-full justify-center"
          icon={<RefreshCw size={20} />}
          onClick={() => run("check")}
          data-testid="wacs-try-again"
        >
          {m.wacs_try_again()}
        </Button>
      </Show>

      <Show
        when={
          (mode() === "signed-out" ||
            mode() === "on-wacs" ||
            mode() === "review" ||
            mode() === "incoming") &&
          origin()
        }
      >
        {(at) => <ProjectLocation href={shareableLink(at())} noWrite={noWrite()} />}
      </Show>

      <Show when={mode() === "signed-out"}>
        <Button
          variant="primary"
          class="w-full justify-center"
          icon={<UserIcon size={20} />}
          onClick={() => run("sign-in")}
          data-testid="sync-sign-in"
        >
          {m.common_sign_in_to_wacs()}
        </Button>
      </Show>

      <Show when={mode() === "new"}>
        <form class="space-y-4" onSubmit={publish} data-sync-publish>
          <div class="space-y-2">
            <label class="block text-small font-semibold text-on-surface-primary" for="wacs-name">
              {m.wacs_project_location()}
            </label>
            <Input
              id="wacs-name"
              wrapperClass="w-full"
              value={name()}
              onInput={(event) => {
                setName(event.currentTarget.value);
                setProblem("");
                setTaken(false);
              }}
            />
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
          <Show when={problem()}>
            {(said) => (
              <div class="space-y-2" data-sync-failed>
                <p class="text-small text-on-surface-error">{said()}</p>
                <Show when={taken()}>
                  <Button
                    variant="secondary"
                    class="w-full justify-center"
                    icon={<Link2 size={20} />}
                    onClick={link}
                    data-testid="wacs-link-existing"
                  >
                    {m.wacs_link_existing({ name: name().trim() })}
                  </Button>
                </Show>
              </div>
            )}
          </Show>
        </form>
      </Show>

      <Show when={mode() === "incoming"}>
        {/* The thing to act on, so it is the loudest line here; how loud is Thomas's call. */}
        <p
          class="rounded-md bg-surface-warning px-3 py-2 text-body font-semibold text-on-surface-warning"
          data-sync-incoming
        >
          {m.cloud_there_are_updates_to_receive()}
        </p>
        <Button
          variant="primary"
          class="w-full justify-center"
          icon={<GitCompare size={20} />}
          onClick={() => run("see")}
          data-testid="wacs-see"
        >
          {m.wacs_review_changes()}
        </Button>
      </Show>

      <Show when={mode() === "review"}>
        {/* The upload is held until the person has reviewed what came in. */}
        <Button
          variant="primary"
          class="w-full justify-center"
          icon={<CloudUpload size={20} />}
          disabled
          data-testid="wacs-upload-pending"
        >
          {m.wacs_upload_pending()}
        </Button>
        <Button
          variant="secondary"
          class="w-full justify-center"
          icon={<GitCompare size={20} />}
          onClick={() => run("see")}
          data-testid="wacs-review"
        >
          {m.wacs_review_changes()}
        </Button>
        <p class="text-small text-on-surface-secondary" data-sync-review-note>
          {m.wacs_review_then_upload()}
        </p>
      </Show>

      <Show when={mode() === "on-wacs"}>
        <CollabSection onLeave={props.onLeave} />
        <Show
          when={busyLabel()}
          fallback={
            <Button
              variant="primary"
              class="w-full justify-center"
              icon={<CloudUpload size={20} />}
              disabled={waiting() === 0}
              onClick={() => (noWrite() ? submit() : upload())}
              data-testid="wacs-upload"
            >
              {refused()
                ? m.wacs_retry_upload()
                : noWrite()
                  ? m.wacs_submit_changes()
                  : m.menu_upload_to_wacs()}
            </Button>
          }
        >
          {(label) => <Working label={label()} />}
        </Show>
        <Show
          when={problem()}
          fallback={
            <Show when={refused() && !seenBefore}>
              <p class="text-small text-on-surface-error" data-sync-failed>
                {m.wacs_upload_failed_note()}
              </p>
            </Show>
          }
        >
          {(said) => (
            <p class="text-small text-on-surface-error" data-sync-failed>
              {said()}
            </p>
          )}
        </Show>
        <Show when={facts()?.mine?.kind === "waiting"}>
          <p class="text-small text-on-surface-secondary">{m.wacs_waiting_owner()}</p>
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
  const shell = useShell();
  const sync = createSync(shell);
  const [preview, setPreview] = createSignal("live", { name: "syncChipPreview", ownedWrite: true });
  if (__SEFER_DESIGN__) useStateTweak(setPreview);
  const held = (): Sync | undefined => {
    const stand = PREVIEWS[preview()];
    return stand === undefined ? sync.quick.sync() : syncOf({ ...emptyReading, ...stand });
  };
  // What the pill says in amber until the person opens the popover: a refused
  // upload they have not seen yet, WACS out of reach, or a sign-in WACS refused.
  const warning = (): string | undefined => {
    const shown = held();
    const root = shell.project()?.root ?? "";
    if (shown === undefined || shown.reading.origin === undefined) return undefined;
    if (shown.reading.ahead.length > 0 && shown.reading.behind.length > 0)
      return m.network_review_needed();
    if (shown.reading.sendRefused && !failureSeen().has(root)) return m.network_upload_failed();
    if (shown.state === "unauthorized") return m.network_sign_in_needed();
    if (shown.state === "offline" && !syncStatus.workOffline() && syncStatus.interfaceUp())
      return m.network_cant_reach_wacs();
    return undefined;
  };
  return (
    <NetworkChip
      warning={warning()}
      onOpenChange={(open) => {
        if (open) sync.pop.openChanged(true);
      }}
      body={(close) => (
        <WacsBody
          sync={sync}
          held={held()}
          standIn={preview() !== "live" && PREVIEWS[preview()]?.signedIn === true}
          noWrite={NO_WRITE_PREVIEWS.has(preview()) ? true : undefined}
          onLeave={close}
        />
      )}
    />
  );
}
