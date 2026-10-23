import type { JSX } from "@solidjs/web";
import { Effect, Fiber, Stream } from "effect";
import { Show, createEffect, createSignal, onCleanup } from "solid-js";

import { Git } from "#core/git/git";
import { Gitea, type RemoteRepo } from "#core/remote/gitea";
import { Remote } from "#core/remote/remote";

import { collaboration } from "../../collaboration";
import { describeTransfer } from "../../describe";
import { t } from "../../i18n";
import { useShell, type Shell } from "../../ProjectContext";
import { syncWatch } from "../../syncWatch";
import { Button, Card, FilterList, Input, PanelHeader, Popover } from "../primitives";
import type { Account } from "./account";

type Services = Shell["services"];

const initAndAttach = (root: string, cloneUrl: string) =>
  Effect.gen(function* () {
    const git = yield* Git;
    const remote = yield* Remote;
    const opened = yield* git.init(root);
    yield* remote.attach(opened, cloneUrl);
  });

const initAndPublish = (root: string, name: string) =>
  Effect.gen(function* () {
    const git = yield* Git;
    const remote = yield* Remote;
    const opened = yield* git.init(root);
    yield* remote.publish(opened, name);
  });

const shortOrigin = (origin: string): string =>
  origin
    .replace(/\.git$/u, "")
    .split("/")
    .slice(-2)
    .join("/");

const createTransferPhase = (
  services: Services,
  root: () => string | undefined,
  setPhase: (phase: string) => void,
): void => {
  // onCleanup in the component body: one inside an effect callback never runs (NO_OWNER_CLEANUP).
  let progressFiber: Fiber.Fiber<void, unknown> | undefined;
  const stopProgress = (): void => {
    if (progressFiber === undefined) return;
    Effect.runFork(Fiber.interrupt(progressFiber));
    progressFiber = undefined;
  };
  onCleanup(stopProgress);

  createEffect(root, () => {
    stopProgress();
    progressFiber = services.runtime.runFork(
      Effect.flatMap(Remote, (remote) =>
        Stream.runForEach(remote.progress(), (progress) =>
          Effect.sync(() => setPhase(describeTransfer(progress))),
        ),
      ),
    );
  });
};

const createRepoSearch = (
  services: Services,
  host: string | null,
  setRepos: (update: (held: readonly RemoteRepo[]) => readonly RemoteRepo[]) => void,
) => {
  const [searching, setSearching] = createSignal(false, { name: "cloudRepoSearching" });
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchTicket = 0;
  const searchRepos = (text: string): void => {
    clearTimeout(searchTimer);
    searchTicket += 1;
    const ticket = searchTicket;
    if (host === null || text === "") {
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer = setTimeout(() => {
      void services
        .run(Effect.flatMap(Gitea, (gitea) => gitea.listWritableRepos(host, text)))
        .then((found) => {
          if (ticket !== searchTicket) return;
          setRepos((held) => {
            const known = new Set(held.map((repo) => repo.fullName));
            return [...held, ...found.filter((repo) => !known.has(repo.fullName))];
          });
        })
        .catch(() => undefined)
        .finally(() => {
          if (ticket === searchTicket) setSearching(false);
        });
    }, 300);
  };
  onCleanup(() => clearTimeout(searchTimer));
  return { searching, searchRepos };
};

const rereadProject = (shell: Shell): void => {
  const project = shell.project();
  if (project === undefined) return;
  void syncWatch.refresh(shell.services, project).catch(() => undefined);
  void collaboration.refresh(shell.services, project);
};

const createSharedProject = (account: Account, root: () => string | undefined) => {
  const shell = useShell();
  const { services } = shell;
  const reread = (): void => rereadProject(shell);

  const [repos, setRepos] = createSignal<readonly RemoteRepo[]>([], { name: "cloudRepos" });
  const [choosing, setChoosing] = createSignal(false, { name: "cloudChoosing" });
  const [newName, setNewName] = createSignal("", { name: "cloudNewName" });
  const [phase, setPhase] = createSignal("", { name: "cloudPhase" });

  createTransferPhase(services, root, setPhase);
  const { searching, searchRepos } = createRepoSearch(services, account.host, setRepos);

  return {
    repos,
    choosing,
    setChoosing,
    newName,
    setNewName,
    phase,
    searching,
    searchRepos,
    listRepos: (): void => {
      const base = account.host;
      if (base === null) return;
      account.attempt(async () => {
        setRepos(
          await services.run(Effect.flatMap(Gitea, (gitea) => gitea.listWritableRepos(base))),
        );
      });
    },
    attach: (repo: RemoteRepo): void => {
      const at = root();
      if (at === undefined) return;
      account.attempt(async () => {
        await services.run(initAndAttach(at, repo.cloneUrl));
        shell.report(t("attached {name}", { name: repo.fullName }));
        reread();
      });
    },
    publish: (): void => {
      const at = root();
      if (at === undefined) return;
      // oxlint-disable-next-line solid/reactivity
      account.attempt(async () => {
        const staticName = newName().trim();
        if (staticName === "") return;
        await services.run(initAndPublish(at, staticName));
        setNewName("");
        shell.report(t("published {name}", { name: staticName }));
        reread();
      });
    },
    attachedTo: (): string | undefined => {
      const origin = syncWatch.sync(shell.project()?.root)?.reading.origin;
      return origin === undefined ? undefined : shortOrigin(origin);
    },
  };
};

type SharedProject = ReturnType<typeof createSharedProject>;

const RepoChooser = (props: {
  readonly account: Account;
  readonly shared: SharedProject;
  readonly emptyNote: string;
}) => (
  <div class="flex flex-wrap items-center gap-2">
    <Popover
      label={t("Shared projects")}
      side="bottom"
      align="start"
      class="flex max-h-[60vh] w-96 flex-col p-2"
      open={props.shared.choosing()}
      onOpenChange={(open) => {
        props.shared.setChoosing(open);
        if (open && props.shared.repos().length === 0) props.shared.listRepos();
      }}
      trigger={
        <Button disabled={props.account.busy()} data-testid="choose-shared-project">
          {t("Choose a shared project…")}
        </Button>
      }
    >
      <Show
        when={props.shared.repos().length > 0}
        fallback={<p class="p-2 text-small text-on-surface-tertiary">{props.emptyNote}</p>}
      >
        <FilterList
          label={t("Filter shared projects")}
          placeholder={t("Name or owner…")}
          items={props.shared.repos()}
          key={(repo) => repo.fullName}
          match={(repo, query) => repo.fullName.toLowerCase().includes(query.toLowerCase())}
          onQuery={props.shared.searchRepos}
          searching={props.shared.searching()}
          onPick={(repo) => {
            props.shared.setChoosing(false);
            props.shared.attach(repo);
          }}
        >
          {(repo) => <span class="truncate">{repo.fullName}</span>}
        </FilterList>
      </Show>
    </Popover>
  </div>
);

const CreateForm = (props: { readonly account: Account; readonly shared: SharedProject }) => (
  <form
    class="flex flex-wrap items-center gap-2"
    onSubmit={(event) => {
      event.preventDefault();
      props.shared.publish();
    }}
  >
    <Input
      type="text"
      wrapperClass="w-64"
      placeholder={t("new shared project name")}
      value={props.shared.newName()}
      onInput={(event) => props.shared.setNewName(event.currentTarget.value)}
    />
    <Button type="submit" disabled={props.account.busy()}>
      {t("Create and publish")}
    </Button>
  </form>
);

const SharedControls = (props: {
  readonly account: Account;
  readonly shared: SharedProject;
  readonly emptyNote: string;
}) => (
  <>
    <RepoChooser account={props.account} shared={props.shared} emptyNote={props.emptyNote} />
    <CreateForm account={props.account} shared={props.shared} />
  </>
);

const AttachedBlock = (props: { readonly origin: string; readonly children: JSX.Element }) => (
  <div class="space-y-3">
    <p class="text-small text-on-surface-secondary" data-cloud="attached-to">
      {t("This project is shared at {name}.", { name: props.origin })}
    </p>
    <details class="space-y-3" data-cloud="change-shared">
      <summary class="cursor-pointer text-small text-on-surface-tertiary">
        {t("Change shared project…")}
      </summary>
      <p class="pt-2 text-smallest text-on-surface-tertiary">
        {t(
          "Your work stays on this device. Another shared project changes where this one receives from and sends to.",
        )}
      </p>
      {props.children}
    </details>
  </div>
);

export function SharedProjectCard(props: {
  readonly account: Account;
  readonly root?: string | undefined;
}) {
  // oxlint-disable-next-line solid/reactivity
  const account = props.account;
  const shared = createSharedProject(account, () => props.root);
  const emptyNote = (): string => {
    if (account.host === null) return t("Sign in to choose a shared project.");
    return account.busy() ? t("Listing your projects…") : t("No projects to choose from.");
  };
  const controls = () => (
    <SharedControls account={account} shared={shared} emptyNote={emptyNote()} />
  );

  return (
    <Card class="space-y-3" data-cloud-card="attach">
      <PanelHeader level={3} title={t("Shared project")} />

      <Show
        when={account.host !== null && account.session() !== undefined}
        fallback={
          <p class="text-small text-on-surface-tertiary" data-cloud="signed-out">
            {t("Sign in above to choose a shared project for this one.")}
          </p>
        }
      >
        <Show
          when={props.root !== undefined}
          fallback={
            <p class="text-small text-on-surface-tertiary" data-cloud="no-project">
              {t("Open a project to attach it to a shared project, or to send and receive.")}
            </p>
          }
        >
          <Show when={shared.attachedTo()} fallback={<div class="space-y-3">{controls()}</div>}>
            {(origin) => <AttachedBlock origin={origin()}>{controls()}</AttachedBlock>}
          </Show>
        </Show>
      </Show>

      <Show when={shared.phase() !== ""}>
        <p class="text-small text-on-surface-tertiary" data-cloud="progress">
          {shared.phase()}
        </p>
      </Show>
    </Card>
  );
}
