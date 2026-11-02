import { Show, createSignal } from "solid-js";

import { t } from "../../i18n";
import { Button, Input } from "../primitives";
import type { Account } from "./account";

/**
 * The WACS sign-in: username and password stacked, a one-time code when the
 * server asks, then Sign in. Shown by the app bar's Account popover and by the
 * sync popover when signed out; both drive the one account.
 */
export const ProblemNote = (props: { readonly text: string }) => (
  <Show when={props.text !== ""}>
    <p
      class="rounded-md bg-surface-error px-3 py-2 text-small break-words text-on-surface-error"
      data-cloud="problem"
    >
      {props.text}
    </p>
  </Show>
);

export function SignInForm(props: {
  readonly account: Account;
  readonly host: string;
  /** Leave out the line on what signing in is for, where the place already says it. */
  readonly bare?: boolean;
}) {
  const [username, setUsername] = createSignal("", { name: "cloudUser" });
  const [password, setPassword] = createSignal("", { name: "cloudPassword" });
  const [otp, setOtp] = createSignal("", { name: "cloudOtp" });

  const submit = (event: SubmitEvent): void => {
    event.preventDefault();
    props.account.signIn({ username: username(), password: password(), otp: otp() });
    setPassword("");
    setOtp("");
  };

  return (
    <form class="space-y-3" onSubmit={submit} data-cloud="sign-in">
      <Show when={props.bare !== true}>
        <p class="text-small text-on-surface-secondary">
          {t(
            "Sign in to {host} to back your work up and share it. Your project is already saved on this device.",
            { host: props.host.replace(/^https?:\/\//u, "") },
          )}
        </p>
      </Show>
      <Input
        type="text"
        wrapperClass="w-full"
        autocomplete="username"
        aria-label={t("username")}
        placeholder={t("username")}
        value={username()}
        onInput={(event) => setUsername(event.currentTarget.value)}
      />
      <Input
        type="password"
        wrapperClass="w-full"
        autocomplete="current-password"
        aria-label={t("password")}
        placeholder={t("password")}
        value={password()}
        onInput={(event) => setPassword(event.currentTarget.value)}
      />
      <Show when={props.account.otpWanted()}>
        <Input
          type="text"
          inputmode="numeric"
          wrapperClass="w-full"
          autocomplete="one-time-code"
          aria-label={t("one-time code")}
          placeholder={t("one-time code")}
          value={otp()}
          onInput={(event) => setOtp(event.currentTarget.value)}
        />
      </Show>
      <ProblemNote text={props.account.problem()} />
      <Button
        type="submit"
        variant="primary"
        class="w-full justify-center"
        disabled={props.account.busy()}
      >
        {t("Sign in")}
      </Button>
    </form>
  );
}
