/**
 * The cloud panel: the whole of remote sync as a translator meets it.
 *
 * Everything here is one of four asks, in the order someone actually does
 * them — which build am I talking to, who am I, which repository is this
 * project, and move the bytes. Nothing runs on its own: Sefer is local-first,
 * so every transfer below is a button.
 *
 * The panel holds no domain state. The session lives in `Credentials` (through
 * `Gitea`), the attachment lives in the repository's own `origin`, and the
 * progress line is a subscription to `Remote.progress()` — so a reload or a
 * second panel shows the same truth rather than a copy of it.
 *
 * The "not configured" state is the important one to get right: a build with
 * no `VITE_SEFER_GITEA_WEB_HOST` (or no `VITE_SEFER_GIT_CORS_PROXY_URL`) can
 * do nothing here, and it says which variable is missing instead of offering a
 * form that would fail on submit.
 */

import { Effect, Fiber, Option, Stream } from "effect";
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";

import { Git } from "../../core/git/git";
import { Gitea, type RemoteRepo, type Session } from "../../core/remote/gitea";
import { Remote } from "../../core/remote/remote";
import { runCommand } from "../commands";
import { giteaHostFor } from "../env";
import { t } from "../i18n";
import { useShell } from "../ProjectContext";
import { Button, Card, Input, PanelHeader } from "./primitives";

/**
 * Every failure this panel shows, as one line.
 *
 * `services.run` rejects with the fiber's failure, whose own string already
 * carries a tagged error's `reason` and `description`. Reading those fields
 * would mean asserting a shape the promise's type does not carry, and the
 * string is what we would print anyway.
 */
const describe = (cause: unknown): string => String(cause);

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

  // The host is a build fact, read once. `giteaHostFor` picks the Web or the
  // desktop variable from the host we are actually running on.
  const host = giteaHostFor(services.hostInfo.kind());

  const [session, setSession] = createSignal<Session | undefined>(undefined, { name: "session" });
  const [username, setUsername] = createSignal("", { name: "cloudUser" });
  const [password, setPassword] = createSignal("", { name: "cloudPassword" });
  const [otp, setOtp] = createSignal("", { name: "cloudOtp" });
  const [otpWanted, setOtpWanted] = createSignal(false, { name: "cloudOtpWanted" });
  const [problem, setProblem] = createSignal("", { name: "cloudProblem" });
  const [busy, setBusy] = createSignal(false, { name: "cloudBusy" });
  const [repos, setRepos] = createSignal<readonly RemoteRepo[]>([], { name: "cloudRepos" });
  const [newName, setNewName] = createSignal("", { name: "cloudNewName" });
  const [phase, setPhase] = createSignal("", { name: "cloudPhase" });

  /** One place for "try this, and if it fails say why" — every button uses it. */
  const attempt = (work: () => Promise<void>): void => {
    setProblem("");
    setBusy(true);
    void work()
      .catch((cause: unknown) => {
        const message = describe(cause);
        setProblem(message);
        // The one failure that is not really a failure: the password was fine
        // and the account wants its second factor.
        if (/OtpRequired/u.test(message)) setOtpWanted(true);
      })
      .finally(() => setBusy(false));
  };

  // Whether we are already signed in is not this component's to remember: ask
  // Gitea (which asks Credentials) on mount, so a panel remounted by
  // navigation shows the session the application actually holds.
  createEffect(
    () => host,
    (base) => {
      if (base === null) return;
      void services
        .run(Effect.flatMap(Gitea, (gitea) => gitea.session(base)))
        .then((held) => setSession(Option.getOrUndefined(held)))
        .catch(() => undefined);
    },
  );

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

  const signIn = (): void => {
    const base = host;
    if (base === null) return;
    attempt(async () => {
      const held = await services.run(
        Effect.flatMap(Gitea, (gitea) =>
          gitea.login({
            host: base,
            username: username(),
            password: password(),
            otp: otp() === "" ? undefined : otp(),
          }),
        ),
      );
      setSession(held);
      // The password is not kept anywhere, including here.
      setPassword("");
      setOtp("");
      setOtpWanted(false);
      shell.report(t("signed in to {host} as {user}", { host: base, user: held.username }));
    });
  };

  const signOut = (): void => {
    const base = host;
    if (base === null) return;
    attempt(async () => {
      await services.run(Effect.flatMap(Gitea, (gitea) => gitea.logout(base)));
      setSession(undefined);
      setRepos([]);
    });
  };

  const listRepos = (): void => {
    const base = host;
    if (base === null) return;
    attempt(async () => {
      setRepos(await services.run(Effect.flatMap(Gitea, (gitea) => gitea.listWritableRepos(base))));
    });
  };

  /** Attach an existing repository as this project's `origin`. */
  const attach = (repo: RemoteRepo): void => {
    const root = props.root;
    if (root === undefined) return;
    attempt(async () => {
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
    attempt(async () => {
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
    <Card class="space-y-3" data-panel="cloud">
      <PanelHeader level={3} title={t("Cloud")} />

      <Show
        when={host}
        fallback={
          <p class="text-small text-on-surface-tertiary" data-cloud="unconfigured">
            {t("Cloud sync is not configured for this build: set VITE_SEFER_GITEA_WEB_HOST.")}
          </p>
        }
      >
        {(base) => (
          <>
            <p class="font-mono text-smallest text-on-surface-tertiary">{base()}</p>

            <Show
              when={session()}
              fallback={
                <form
                  class="flex flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    signIn();
                  }}
                >
                  <Input
                    type="text"
                    wrapperClass="w-40"
                    autocomplete="username"
                    placeholder={t("username")}
                    value={username()}
                    onInput={(event) => setUsername(event.currentTarget.value)}
                  />
                  <Input
                    type="password"
                    wrapperClass="w-40"
                    autocomplete="current-password"
                    placeholder={t("password")}
                    value={password()}
                    onInput={(event) => setPassword(event.currentTarget.value)}
                  />
                  <Show when={otpWanted()}>
                    <Input
                      type="text"
                      wrapperClass="w-32"
                      inputmode="numeric"
                      autocomplete="one-time-code"
                      placeholder={t("one-time code")}
                      value={otp()}
                      onInput={(event) => setOtp(event.currentTarget.value)}
                    />
                  </Show>
                  <Button type="submit" variant="primary" disabled={busy()}>
                    {t("Sign in")}
                  </Button>
                </form>
              }
            >
              {(held) => (
                <>
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-small">
                      {t("signed in as {user}", { user: held().username })}
                    </span>
                    <Button class="ms-auto" onClick={signOut} disabled={busy()}>
                      {t("Sign out")}
                    </Button>
                  </div>

                  <Show
                    when={props.root !== undefined}
                    fallback={
                      <p class="text-small text-on-surface-tertiary" data-cloud="no-project">
                        {t("Open a project to attach it to a repository, or to push and pull.")}
                      </p>
                    }
                  >
                    <div class="flex flex-wrap items-center gap-2">
                      <Button onClick={listRepos} disabled={busy()}>
                        {t("Attach to repo…")}
                      </Button>
                      <Button onClick={() => runCommand("remote.pull")}>{t("Pull")}</Button>
                      <Button onClick={() => runCommand("remote.push")}>{t("Push")}</Button>
                    </div>
                  </Show>

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
                              disabled={busy()}
                            >
                              {t("Attach")}
                            </Button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>

                  <form
                    class={
                      props.root === undefined ? "hidden" : "flex flex-wrap items-center gap-2"
                    }
                    onSubmit={(event) => {
                      event.preventDefault();
                      publish();
                    }}
                  >
                    <Input
                      type="text"
                      wrapperClass="w-64"
                      placeholder={t("new repository name")}
                      value={newName()}
                      onInput={(event) => setNewName(event.currentTarget.value)}
                    />
                    <Button type="submit" disabled={busy()}>
                      {t("Create and publish")}
                    </Button>
                  </form>
                </>
              )}
            </Show>

            <Show when={phase() !== ""}>
              <p class="text-small text-on-surface-tertiary" data-cloud="progress">
                {phase()}
              </p>
            </Show>

            <Show when={problem() !== ""}>
              <p
                class="rounded-md bg-surface-error px-3 py-2 text-small break-words text-on-surface-error"
                data-cloud="problem"
              >
                {problem()}
              </p>
            </Show>
          </>
        )}
      </Show>
    </Card>
  );
}
