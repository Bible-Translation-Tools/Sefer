import { Effect, Fiber, Stream } from "effect";
import { Show, createEffect, createSignal, onCleanup } from "solid-js";

import { Git } from "#core/git/git";
import { Gitea, type RemoteRepo } from "#core/remote/gitea";
import { Remote } from "#core/remote/remote";

import { collaboration } from "../../collaboration";
import { describeTransfer } from "../../describe";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { syncWatch } from "../../syncWatch";
import { Button, Card, FilterList, Input, PanelHeader, Popover } from "../primitives";
import type { Account } from "./account";

export function SharedProjectCard(props: {
  readonly account: Account;
  readonly root?: string | undefined;
}) {
  const shell = useShell();
  const { services } = shell;
  // oxlint-disable-next-line solid/reactivity
  const account = props.account;
  const reread = (): void => {
    const project = shell.project();
    if (project === undefined) return;
    void syncWatch.refresh(services, project).catch(() => undefined);
    void collaboration.refresh(services, project);
  };

  const [repos, setRepos] = createSignal<readonly RemoteRepo[]>([], { name: "cloudRepos" });
  const [choosing, setChoosing] = createSignal(false, { name: "cloudChoosing" });
  const [newName, setNewName] = createSignal("", { name: "cloudNewName" });
  const [phase, setPhase] = createSignal("", { name: "cloudPhase" });

  // onCleanup in the component body: one inside an effect callback never runs (NO_OWNER_CLEANUP).
  let progressFiber: Fiber.Fiber<void, unknown> | undefined;
  const stopProgress = (): void => {
    if (progressFiber === undefined) return;
    Effect.runFork(Fiber.interrupt(progressFiber));
    progressFiber = undefined;
  };
  onCleanup(stopProgress);

  createEffect(
    () => props.root,
    () => {
      stopProgress();
      progressFiber = services.runtime.runFork(
        Effect.flatMap(Remote, (remote) =>
          Stream.runForEach(remote.progress(), (progress) =>
            Effect.sync(() => setPhase(describeTransfer(progress))),
          ),
        ),
      );
    },
  );

  const [searching, setSearching] = createSignal(false, { name: "cloudRepoSearching" });
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchTicket = 0;
  const searchRepos = (text: string): void => {
    clearTimeout(searchTimer);
    const base = account.host;
    searchTicket += 1;
    const ticket = searchTicket;
    if (base === null || text === "") {
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer = setTimeout(() => {
      void services
        .run(Effect.flatMap(Gitea, (gitea) => gitea.listWritableRepos(base, text)))
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

  const listRepos = (): void => {
    const base = account.host;
    if (base === null) return;
    account.attempt(async () => {
      setRepos(await services.run(Effect.flatMap(Gitea, (gitea) => gitea.listWritableRepos(base))));
    });
  };

  const attach = (repo: RemoteRepo): void => {
    const root = props.root;
    if (root === undefined) return;
    account.attempt(async () => {
      await services.run(
        Effect.gen(function* () {
          const git = yield* Git;
          const remote = yield* Remote;
          const opened = yield* git.init(root);
          yield* remote.attach(opened, repo.cloneUrl);
        }),
      );
      shell.report(t("attached {name}", { name: repo.fullName }));
      reread();
    });
  };

  const publish = (): void => {
    const root = props.root;
    if (root === undefined) return;
    // oxlint-disable-next-line solid/reactivity
    account.attempt(async () => {
      const staticName = newName().trim();
      if (staticName === "") return;
      await services.run(
        Effect.gen(function* () {
          const git = yield* Git;
          const remote = yield* Remote;
          const opened = yield* git.init(root);
          yield* remote.publish(opened, staticName);
        }),
      );
      setNewName("");
      shell.report(t("published {name}", { name: staticName }));
      reread();
    });
  };

  const attachedTo = (): string | undefined => {
    const origin = syncWatch.sync(shell.project()?.root)?.reading.origin;
    return origin === undefined
      ? undefined
      : origin
          .replace(/\.git$/u, "")
          .split("/")
          .slice(-2)
          .join("/");
  };

  const controls = () => (
    <>
      <div class="flex flex-wrap items-center gap-2">
        <Popover
          label={t("Shared projects")}
          side="bottom"
          align="start"
          class="flex max-h-[60vh] w-96 flex-col p-2"
          open={choosing()}
          onOpenChange={(open) => {
            setChoosing(open);
            if (open && repos().length === 0) listRepos();
          }}
          trigger={
            <Button disabled={account.busy()} data-testid="choose-shared-project">
              {t("Choose a shared project…")}
            </Button>
          }
        >
          <Show
            when={repos().length > 0}
            fallback={
              <p class="p-2 text-small text-on-surface-tertiary">
                {account.host === null
                  ? t("Sign in to choose a shared project.")
                  : account.busy()
                    ? t("Listing your projects…")
                    : t("No projects to choose from.")}
              </p>
            }
          >
            <FilterList
              label={t("Filter shared projects")}
              placeholder={t("Name or owner…")}
              items={repos()}
              key={(repo) => repo.fullName}
              match={(repo, query) => repo.fullName.toLowerCase().includes(query.toLowerCase())}
              onQuery={searchRepos}
              searching={searching()}
              onPick={(repo) => {
                setChoosing(false);
                attach(repo);
              }}
            >
              {(repo) => <span class="truncate">{repo.fullName}</span>}
            </FilterList>
          </Show>
        </Popover>
      </div>

      <form
        class="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          publish();
        }}
      >
        <Input
          type="text"
          wrapperClass="w-64"
          placeholder={t("new shared project name")}
          value={newName()}
          onInput={(event) => setNewName(event.currentTarget.value)}
        />
        <Button type="submit" disabled={account.busy()}>
          {t("Create and publish")}
        </Button>
      </form>
    </>
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
          <Show when={attachedTo()} fallback={<div class="space-y-3">{controls()}</div>}>
            {(origin) => (
              <div class="space-y-3">
                <p class="text-small text-on-surface-secondary" data-cloud="attached-to">
                  {t("This project is shared at {name}.", { name: origin() })}
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
                  {controls()}
                </details>
              </div>
            )}
          </Show>
        </Show>
      </Show>

      <Show when={phase() !== ""}>
        <p class="text-small text-on-surface-tertiary" data-cloud="progress">
          {phase()}
        </p>
      </Show>
    </Card>
  );
}
