/**
 * The cloud panel: the ATTACHMENT half of remote sync, beside the account.
 *
 * It used to be all four asks — who am I, which repository, and move the bytes
 * — because there was nowhere else to put them. There is now: `/cloud` is the
 * sync screen, and it owns the state, the two clocks, the incoming plan and
 * the one right button. What is left here is the part that belongs beside a
 * project rather than on a screen of its own: choosing WHICH shared project
 * this folder is, and creating one when there is none.
 *
 * The account half is not duplicated. `createAccount` is the shared state and
 * `AccountCard` the shared component (`src/app/ui/cloud/account.ts`), so the
 * two surfaces cannot disagree about what "signed in" means.
 *
 * The panel holds no domain state. The session lives in `Credentials` (through
 * `Gitea`), the attachment lives in the repository's own `origin`, and the
 * progress line is a subscription to `Remote.progress()` — so a reload or a
 * second panel shows the same truth rather than a copy of it.
 */

import { Effect, Fiber, Stream } from "effect";
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";

import { Git } from "../../core/git/git";
import { Gitea, type RemoteRepo } from "../../core/remote/gitea";
import { Remote } from "../../core/remote/remote";
import { t } from "../i18n";
import { useShell } from "../ProjectContext";
import { AccountCard, createAccount } from "./cloud";
import { Button, Card, Input, PanelHeader } from "./primitives";

/**
 * `root` is the project this panel attaches and publishes. It is optional
 * because `/settings` shows the same panel with no project open: signing in and
 * out is an ACCOUNT action and belongs there, while attaching a repository is a
 * fact about one project on disk. With no root the account half renders and the
 * attach/publish half says what is missing, rather than offering a button that
 * would `git.init` whatever folder happened to be at hand.
 */
export function CloudPanel(props: { readonly root?: string | undefined }) {
  const shell = useShell();
  const { services } = shell;
  const account = createAccount(shell);

  const [repos, setRepos] = createSignal<readonly RemoteRepo[]>([], { name: "cloudRepos" });
  const [newName, setNewName] = createSignal("", { name: "cloudNewName" });
  const [phase, setPhase] = createSignal("", { name: "cloudPhase" });

  // The progress line. A forked fiber rather than an awaited effect, because
  // the stream never completes; it is interrupted when the panel unmounts.
  //
  // The interrupt is registered in the COMPONENT body, not inside the effect
  // callback: Solid 2 runs that callback unowned, so an `onCleanup` in there is
  // never honoured (`NO_OWNER_CLEANUP`) and the fiber would outlive the panel,
  // still writing into a signal nothing renders. The held fiber is interrupted
  // both here and at the top of each re-run, so a root change replaces the
  // subscription rather than stacking a second one on it.
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
            Effect.sync(() =>
              setPhase(
                progress.total === undefined
                  ? t("{phase} {loaded}", { phase: progress.phase, loaded: progress.loaded })
                  : t("{phase} {loaded}/{total}", {
                      phase: progress.phase,
                      loaded: progress.loaded,
                      total: progress.total,
                    }),
              ),
            ),
          ),
        ),
      );
    },
  );

  const listRepos = (): void => {
    const base = account.host;
    if (base === null) return;
    account.attempt(async () => {
      setRepos(await services.run(Effect.flatMap(Gitea, (gitea) => gitea.listWritableRepos(base))));
    });
  };

  /** Attach an existing repository as this project's `origin`. */
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
    });
  };

  /**
   * First publish: create the repository if it is not there, attach it, push.
   * `Remote.publish` owns that order — see `src/platform/web/remote.ts`.
   */
  const publish = (): void => {
    const root = props.root;
    if (root === undefined) return;
    account.attempt(async () => {
      // Read inside the work, not at setup: the field may have changed between
      // the render that made this handler and the submit that ran it. The
      // `static` prefix says so to the Solid reactivity rule — one snapshot,
      // taken deliberately, at the moment of the ask.
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
    });
  };

  return (
    <div class="space-y-3" data-panel="cloud">
      <AccountCard account={account} />

      <Card class="space-y-3" data-cloud-card="attach">
        <PanelHeader
          level={3}
          title={t("Shared project")}
          actions={
            <a
              class="text-small font-medium text-brand underline underline-offset-2"
              href="/cloud"
              data-cloud="open-sync"
            >
              {t("Open sync…")}
            </a>
          }
        />

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
            <div class="flex flex-wrap items-center gap-2">
              <Button onClick={listRepos} disabled={account.busy()}>
                {t("Choose a shared project…")}
              </Button>
            </div>

            <Show when={repos().length > 0}>
              <ul class="flex flex-col gap-1" data-repos={repos().length}>
                <For each={repos()}>
                  {(repo) => (
                    <li
                      class="flex items-center gap-3 rounded-md border border-surface-border px-3 py-2"
                      data-repo={repo.fullName}
                    >
                      <strong class="text-small">{repo.fullName}</strong>
                      <Button
                        size="sm"
                        class="ms-auto"
                        onClick={() => attach(repo)}
                        disabled={account.busy()}
                      >
                        {t("Attach")}
                      </Button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>

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
          </Show>
        </Show>

        <Show when={phase() !== ""}>
          <p class="text-small text-on-surface-tertiary" data-cloud="progress">
            {phase()}
          </p>
        </Show>
      </Card>
    </div>
  );
}
