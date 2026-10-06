/**
 * Who am I, to the cloud — the first of the sync screen's four questions.
 *
 * Signing in is an ACCOUNT action, not a project one, which is why it has its
 * own Card above the project's: the same session serves every project on the
 * device. A build with no Gitea host configured says which variable is
 * missing rather than offering a form that would fail on submit.
 *
 * `SignInForm` is the form alone, so the app bar's cloud popover signs in
 * with the same fields and the same failure line.
 *
 * Sign-in failures render inline, under the form, and never as a toast. The
 * form is where the person is looking, and a toast about a password is gone
 * before they have finished reading it.
 */

import { Show, createSignal } from "solid-js";

import { t } from "../../i18n";
import { Button, Card, Input, PanelHeader } from "../primitives";
import type { Account } from "./account";

export function SignInForm(props: { readonly account: Account; readonly host: string }) {
  const [username, setUsername] = createSignal("", { name: "cloudUser" });
  const [password, setPassword] = createSignal("", { name: "cloudPassword" });
  const [otp, setOtp] = createSignal("", { name: "cloudOtp" });

  const submit = (event: SubmitEvent): void => {
    event.preventDefault();
    props.account.signIn({ username: username(), password: password(), otp: otp() });
    // The password is not kept anywhere, including here.
    setPassword("");
    setOtp("");
  };

  return (
    <form class="space-y-3" onSubmit={submit} data-cloud="sign-in">
      <p class="text-small text-on-surface-secondary">
        {t(
          "Sign in to {host} to back your work up and share it. Your project is already saved on this device.",
          { host: props.host },
        )}
      </p>
      <div class="flex flex-wrap items-center gap-2">
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
        <Show when={props.account.otpWanted()}>
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
        <Button type="submit" variant="primary" disabled={props.account.busy()}>
          {t("Sign in")}
        </Button>
      </div>
      <Show when={props.account.problem() !== ""}>
        <p
          class="rounded-md bg-surface-error px-3 py-2 text-small break-words text-on-surface-error"
          data-cloud="problem"
        >
          {props.account.problem()}
        </p>
      </Show>
    </form>
  );
}

export function AccountCard(props: { readonly account: Account }) {
  return (
    <Card class="space-y-3" data-cloud-card="account">
      <PanelHeader
        level={3}
        title={t("Account")}
        actions={
          <Show when={props.account.session() !== undefined}>
            <div class="flex items-center gap-2">
              <span class="text-small text-on-surface-success">{t("Signed in")}</span>
              <Button size="sm" onClick={props.account.signOut} disabled={props.account.busy()}>
                {t("Sign out")}
              </Button>
            </div>
          </Show>
        }
      />

      <Show
        when={props.account.host}
        fallback={
          <p class="text-small text-on-surface-tertiary" data-cloud="unconfigured">
            {t(
              "Cloud sync has no server for this build. Set the WACS endpoint on the Network card in Settings.",
            )}
          </p>
        }
      >
        {(base) => (
          <Show
            when={props.account.session()}
            fallback={<SignInForm account={props.account} host={base()} />}
          >
            {(held) => (
              <>
                <p class="text-small text-on-surface-secondary">
                  {t("Signed in to {host} as {user}.", { host: base(), user: held().username })}
                </p>
                <Show when={props.account.problem() !== ""}>
                  <p class="text-small break-words text-on-surface-error" data-cloud="problem">
                    {props.account.problem()}
                  </p>
                </Show>
              </>
            )}
          </Show>
        )}
      </Show>
    </Card>
  );
}
