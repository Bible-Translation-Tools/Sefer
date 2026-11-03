import type { JSX } from "@solidjs/web";
import Eye from "lucide-solid/icons/eye";
import EyeOff from "lucide-solid/icons/eye-off";
import KeyRound from "lucide-solid/icons/key-round";
import Lock from "lucide-solid/icons/lock";
import Mail from "lucide-solid/icons/mail";
import SquareArrowOutUpRight from "lucide-solid/icons/square-arrow-out-up-right";
import { Show, createSignal } from "solid-js";

import { m } from "../../paraglide/messages";
import { Button, ButtonLink, IconButton, Input } from "../primitives";
import type { Account } from "./account";

/** A page on the WACS server itself; Gitea owns recovery and registration, so Sefer links to them. */
export const wacsPage = (host: string, path: string): string =>
  `${host.replace(/\/+$/u, "")}${path}`;

const Label = (props: {
  readonly for: string;
  readonly icon: JSX.Element;
  readonly children: string;
}) => (
  <label
    for={props.for}
    class="flex items-center gap-2 text-small font-medium text-on-surface-primary [&>svg]:size-5"
  >
    {props.icon}
    {props.children}
    <span class="text-on-surface-error" aria-hidden="true">
      *
    </span>
  </label>
);

/**
 * The WACS sign-in, after the designer's mock: email or username and password
 * up front, Forgot password under the password, Sign in (blue once both are
 * filled), then Create new account. Recovery and registration are WACS's own
 * pages, opened in the browser. Drawn by the app bar's Account popover.
 */
export function SignInForm(props: { readonly account: Account; readonly host: string }) {
  const [identifier, setIdentifier] = createSignal("", { name: "cloudUser" });
  const [password, setPassword] = createSignal("", { name: "cloudPassword" });
  const [otp, setOtp] = createSignal("", { name: "cloudOtp" });
  const [shown, setShown] = createSignal(false, { name: "cloudPasswordShown" });

  // Blue, and pressable, only once both fields have something in them.
  const filled = (): boolean => identifier().trim() !== "" && password() !== "";

  const submit = (event: SubmitEvent): void => {
    event.preventDefault();
    props.account.signIn({ username: identifier().trim(), password: password(), otp: otp() });
    setPassword("");
    setOtp("");
  };

  return (
    <form class="space-y-4" onSubmit={submit} data-cloud="sign-in">
      <h2 class="text-center text-h4 font-semibold text-on-surface-primary">{m.sign_in_title()}</h2>

      <div class="space-y-2">
        <Label for="sign-in-identifier" icon={<Mail />}>
          {m.sign_in_identifier()}
        </Label>
        <Input
          id="sign-in-identifier"
          type="text"
          required
          wrapperClass="w-full"
          autocomplete="username"
          value={identifier()}
          onInput={(event) => setIdentifier(event.currentTarget.value)}
        />
      </div>

      <div class="space-y-2">
        <Label for="sign-in-password" icon={<Lock />}>
          {m.sign_in_password()}
        </Label>
        <span class="relative block">
          <Input
            id="sign-in-password"
            type={shown() ? "text" : "password"}
            required
            wrapperClass="w-full"
            class="pe-12"
            autocomplete="current-password"
            value={password()}
            onInput={(event) => setPassword(event.currentTarget.value)}
          />
          <span class="absolute inset-y-0 end-0 flex items-center">
            <IconButton
              variant="bare"
              label={shown() ? m.sign_in_hide_password() : m.sign_in_show_password()}
              icon={shown() ? <EyeOff /> : <Eye />}
              aria-pressed={shown() ? "true" : "false"}
              onClick={() => setShown(!shown())}
              data-testid="sign-in-show-password"
            />
          </span>
        </span>
        <Show when={props.account.problem() !== ""}>
          <p class="text-small break-words text-on-surface-error" data-cloud="problem">
            {props.account.problem()}
          </p>
        </Show>
        <a
          class="inline-block text-small text-on-surface-secondary underline hover:text-on-surface-primary"
          href={wacsPage(props.host, "/user/forgot_password")}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="sign-in-forgot"
        >
          {m.sign_in_forgot_password()}
        </a>
      </div>

      <Show when={props.account.otpWanted()}>
        <div class="space-y-2">
          <Label for="sign-in-otp" icon={<KeyRound />}>
            {m.sign_in_one_time_code()}
          </Label>
          <Input
            id="sign-in-otp"
            type="text"
            inputmode="numeric"
            wrapperClass="w-full"
            autocomplete="one-time-code"
            value={otp()}
            onInput={(event) => setOtp(event.currentTarget.value)}
          />
        </div>
      </Show>

      <div class="space-y-2">
        <Button
          type="submit"
          variant={filled() ? "primary" : "secondary"}
          class="w-full justify-center"
          disabled={!filled() || props.account.busy()}
          loading={props.account.busy()}
        >
          {m.sign_in_button()}
        </Button>
        <ButtonLink
          variant="secondary"
          class="w-full justify-center"
          icon={<SquareArrowOutUpRight size={20} />}
          href={wacsPage(props.host, "/user/sign_up")}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="sign-in-create"
        >
          {m.sign_in_create_account()}
        </ButtonLink>
      </div>
    </form>
  );
}
