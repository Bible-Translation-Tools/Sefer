import { Show, createSignal } from "solid-js";

import { t } from "../../i18n";
import { m } from "../../paraglide/messages";
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

/**
 * A page on the WACS server itself, in the browser: resetting a password and
 * creating an account are Gitea's own pages (`/user/forgot_password`,
 * `/user/sign_up`), so Sefer links to them rather than redoing them.
 */
const WacsLink = (props: {
  readonly host: string;
  readonly path: string;
  readonly testId: string;
  readonly children: string;
}) => (
  <a
    class="text-small text-brand hover:underline"
    href={`${props.host.replace(/\/+$/u, "")}${props.path}`}
    target="_blank"
    rel="noopener noreferrer"
    data-testid={props.testId}
  >
    {props.children}
  </a>
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

  // Blue, and pressable, only once both fields have something in them.
  const filled = (): boolean => username().trim() !== "" && password() !== "";

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
      <div class="flex justify-end">
        <WacsLink host={props.host} path="/user/forgot_password" testId="sign-in-forgot">
          {m.sign_in_forgot_password()}
        </WacsLink>
      </div>
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
        variant={filled() ? "primary" : "secondary"}
        class="w-full justify-center"
        disabled={!filled() || props.account.busy()}
      >
        {t("Sign in")}
      </Button>
      <p class="text-center text-small text-on-surface-secondary">
        {m.sign_in_no_account()}{" "}
        <WacsLink host={props.host} path="/user/sign_up" testId="sign-in-create">
          {m.sign_in_create_account()}
        </WacsLink>
      </p>
    </form>
  );
}
