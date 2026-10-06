/**
 * The "Shared project" card: choosing WHICH shared project a project on this
 * device is, and creating one when there is none.
 *
 * One card, two places. `CloudPanel` shows it beside the account on
 * `/settings`; the sync screen (`CloudScreen`) shows it whenever the next step
 * is to attach or publish, because a "Choose a shared project" button with the
 * card somewhere else did nothing at all. The screen drives it through
 * `actions`: its primary button lists the repositories, or puts the caret in
 * the new-name field.
 *
 * It holds no domain state. The session lives in `Credentials` (through
 * `Gitea`), the attachment in the repository's own `origin`, and the progress
 * line is a subscription to `Remote.progress()`.
 */

import { Effect, Fiber, Stream } from "effect";
import { For, Show, createEffect, createSignal, onCleanup, untrack } from "solid-js";

import { Git } from "#core/git/git";
import { Gitea, type RemoteRepo } from "#core/remote/gitea";
import { Remote } from "#core/remote/remote";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Button, Card, Input, PanelHeader } from "../primitives";
import type { Account } from "./account";

/** What a screen can ask of the card from its own button. */
export interface SharedProjectActions {
  /** List the repositories this account can write, to attach one. */
  readonly list: () => void;
  /** Put the caret in the new shared project's name. */
  readonly focusName: () => void;
}

/**
 * `root` is the project this card attaches and publishes; optional because
 * `/settings` shows it with no project open, and then it says what is missing
 * rather than offering a button that would `git.init` whatever folder was at
 * hand. `onChanged` runs after an attach or publish succeeds, so a screen that
 * reads the sync state can read it again.
 */
export function SharedProjectCard(props: {
  readonly account: Account;
  readonly root?: string | undefined;
  readonly onChanged?: () => void;
  readonly actions?: (actions: SharedProjectActions) => void;
}) {
  const shell = useShell();
  const { services } = shell;
  // The account is the caller's, so the two cards on one screen share one.
  // oxlint-disable-next-line solid/reactivity -- a handle, not a value: the same Account for the card's life
  const account = props.account;
  let nameField: HTMLInputElement | undefined;

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
    const changed = props.onChanged;
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
      changed?.();
    });
  };

  /**
   * First publish: create the repository if it is not there, attach it, push.
   * `Remote.publish` owns that order — see `src/platform/web/remote.ts`.
   */
  const publish = (): void => {
    const root = props.root;
    if (root === undefined) return;
    // oxlint-disable-next-line solid/reactivity -- the account's work: runs once per press, reading the field at the moment of the ask
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
      props.onChanged?.();
    });
  };

  // Handed over once: the screen holding the card keeps the same two actions.
  untrack(() => props.actions)?.({ list: listRepos, focusName: () => nameField?.focus() });

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
              ref={(element: HTMLInputElement) => (nameField = element)}
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
  );
}
