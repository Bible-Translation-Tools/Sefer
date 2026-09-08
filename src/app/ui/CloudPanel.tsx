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

/**
 * Every failure this panel shows, as one line.
 *
 * `services.run` rejects with the fiber's failure, whose own string already
 * carries a tagged error's `reason` and `description`. Reading those fields
 * would mean asserting a shape the promise's type does not carry, and the
 * string is what we would print anyway.
 */
const describe = (cause: unknown): string => String(cause);

export function CloudPanel(props: { readonly root: string }) {
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
  createEffect(
    () => props.root,
    () => {
      const fiber = services.runtime.runFork(
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
      onCleanup(() => {
        Effect.runFork(Fiber.interrupt(fiber));
      });
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
    attempt(async () => {
      await services.run(
        Effect.gen(function* () {
          const git = yield* Git;
          const remote = yield* Remote;
          const opened = yield* git.init(props.root);
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
          const opened = yield* git.init(props.root);
          yield* remote.publish(opened, staticName);
        }),
      );
      setNewName("");
      shell.report(t("published {name}", { name: staticName }));
    });
  };

  return (
    <section data-panel="cloud">
      <h3>{t("Cloud")}</h3>

      <Show
        when={host}
        fallback={
          <p class="muted" data-cloud="unconfigured">
            {t("Cloud sync is not configured for this build: set VITE_SEFER_GITEA_WEB_HOST.")}
          </p>
        }
      >
        {(base) => (
          <>
            <p class="muted">
              <code>{base()}</code>
            </p>

            <Show
              when={session()}
              fallback={
                <form
                  class="row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    signIn();
                  }}
                >
                  <input
                    type="text"
                    autocomplete="username"
                    placeholder={t("username")}
                    value={username()}
                    onInput={(event) => setUsername(event.currentTarget.value)}
                  />
                  <input
                    type="password"
                    autocomplete="current-password"
                    placeholder={t("password")}
                    value={password()}
                    onInput={(event) => setPassword(event.currentTarget.value)}
                  />
                  <Show when={otpWanted()}>
                    <input
                      type="text"
                      inputmode="numeric"
                      autocomplete="one-time-code"
                      placeholder={t("one-time code")}
                      value={otp()}
                      onInput={(event) => setOtp(event.currentTarget.value)}
                    />
                  </Show>
                  <button type="submit" disabled={busy()}>
                    {t("Sign in")}
                  </button>
                </form>
              }
            >
              {(held) => (
                <>
                  <div class="row">
                    <span>{t("signed in as {user}", { user: held().username })}</span>
                    <button type="button" class="spacer" onClick={signOut} disabled={busy()}>
                      {t("Sign out")}
                    </button>
                  </div>

                  <div class="row">
                    <button type="button" onClick={listRepos} disabled={busy()}>
                      {t("Attach to repo…")}
                    </button>
                    <button type="button" onClick={() => runCommand("remote.pull")}>
                      {t("Pull")}
                    </button>
                    <button type="button" onClick={() => runCommand("remote.push")}>
                      {t("Push")}
                    </button>
                  </div>

                  <Show when={repos().length > 0}>
                    <ul class="list" data-repos={repos().length}>
                      <For each={repos()}>
                        {(repo) => (
                          <li data-repo={repo.fullName}>
                            <strong>{repo.fullName}</strong>
                            <button
                              type="button"
                              class="spacer"
                              onClick={() => attach(repo)}
                              disabled={busy()}
                            >
                              {t("Attach")}
                            </button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>

                  <form
                    class="row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      publish();
                    }}
                  >
                    <input
                      type="text"
                      placeholder={t("new repository name")}
                      value={newName()}
                      onInput={(event) => setNewName(event.currentTarget.value)}
                    />
                    <button type="submit" disabled={busy()}>
                      {t("Create and publish")}
                    </button>
                  </form>
                </>
              )}
            </Show>

            <Show when={phase() !== ""}>
              <p class="muted" data-cloud="progress">
                {phase()}
              </p>
            </Show>

            <Show when={problem() !== ""}>
              <p class="problem" data-cloud="problem">
                {problem()}
              </p>
            </Show>
          </>
        )}
      </Show>
    </section>
  );
}
