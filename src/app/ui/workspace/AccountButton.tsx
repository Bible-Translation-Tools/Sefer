import UserIcon from "lucide-solid/icons/user";
import { Show, createSignal } from "solid-js";

import { t } from "../../i18n";
import { m } from "../../paraglide/messages";
import { useShell } from "../../ProjectContext";
import { createAccount, type Account } from "../cloud/account";
import { Button, IconButton, Input, Popover } from "../primitives";

/** Up to two letters for the avatar: the first of each part of the name ("thomas_hajny" → "TH"). */
const initialsOf = (username: string): string => {
  const parts = username.split(/[\s._-]+/u).filter((part) => part !== "");
  const letters =
    parts.length > 1 ? (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "") : username.slice(0, 2);
  return letters.toUpperCase();
};

const ProblemNote = (props: { readonly text: string }) => (
  <Show when={props.text !== ""}>
    <p
      class="rounded-md bg-surface-error px-3 py-2 text-small break-words text-on-surface-error"
      data-cloud="problem"
    >
      {props.text}
    </p>
  </Show>
);

function SignInForm(props: { readonly account: Account; readonly host: string }) {
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
      <p class="text-small text-on-surface-secondary">
        {t(
          "Sign in to {host} to back your work up and share it. Your project is already saved on this device.",
          { host: props.host.replace(/^https?:\/\//u, "") },
        )}
      </p>
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

/**
 * The app bar's Account button: the WACS sign-in, wherever you are. Signed
 * out it is a person icon and opens the sign-in form; signed in it is the
 * person's initials and opens who they are, with Sign out. The account is the
 * one every cloud surface reads (`createAccount`), so the sync popover's Sign
 * in opens this.
 */
export function AccountButton() {
  const account = createAccount(useShell());
  const label = (): string => {
    const held = account.session();
    return held === undefined
      ? m.account_button()
      : m.account_signed_in_as({ user: held.username });
  };

  return (
    <Popover
      label={m.account_button()}
      side="bottom"
      align="end"
      class="w-80"
      open={account.panelOpen()}
      onOpenChange={account.setPanelOpen}
      initialFocus="input"
      trigger={
        <IconButton
          label={label()}
          data-testid="app-bar-account"
          aria-pressed={account.panelOpen() ? "true" : "false"}
          tooltipSide="bottom"
          icon={
            <Show when={account.session()} fallback={<UserIcon size={20} />}>
              {(held) => (
                <span
                  class="button-primary inline-flex size-8 items-center justify-center rounded-full text-small font-semibold"
                  data-account-initials
                >
                  {initialsOf(held().username)}
                </span>
              )}
            </Show>
          }
        />
      }
    >
      <div class="space-y-3" data-account-panel>
        <Show
          when={account.host}
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
              when={account.session()}
              fallback={<SignInForm account={account} host={base()} />}
            >
              {(held) => (
                <>
                  <div class="flex items-center gap-3">
                    <span class="button-primary inline-flex size-10 shrink-0 items-center justify-center rounded-full font-semibold">
                      {initialsOf(held().username)}
                    </span>
                    <div class="min-w-0">
                      <p class="truncate font-medium text-on-surface-primary">{held().username}</p>
                      <p class="truncate text-smallest text-on-surface-tertiary">
                        {base().replace(/^https?:\/\//u, "")}
                      </p>
                    </div>
                  </div>
                  <ProblemNote text={account.problem()} />
                  <Button
                    class="w-full justify-center"
                    onClick={account.signOut}
                    disabled={account.busy()}
                    data-testid="account-sign-out"
                  >
                    {t("Sign out")}
                  </Button>
                </>
              )}
            </Show>
          )}
        </Show>
      </div>
    </Popover>
  );
}
