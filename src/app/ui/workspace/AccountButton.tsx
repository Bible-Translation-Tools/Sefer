import LogOut from "lucide-solid/icons/log-out";
import SquareArrowOutUpRight from "lucide-solid/icons/square-arrow-out-up-right";
import UserIcon from "lucide-solid/icons/user";
import UserCog from "lucide-solid/icons/user-cog";
import { Show } from "solid-js";

import { m } from "../../paraglide/messages";
import { useShell } from "../../ProjectContext";
import { createAccount, type Account } from "../cloud/account";
import { SignInForm, openOutside, wacsPage } from "../cloud/SignInForm";
import { Button, ButtonLink, IconButton, Popover, cx } from "../primitives";

/** Up to two letters for the avatar: the first of each part of the name ("thomas_hajny" → "TH"). */
const initialsOf = (username: string): string => {
  const parts = username.split(/[\s._-]+/u).filter((part) => part !== "");
  const letters =
    parts.length > 1 ? (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "") : username.slice(0, 2);
  return letters.toUpperCase();
};

/** The person's WACS picture once it is known, else their initials. */
const Avatar = (props: { readonly account: Account; readonly class: string }) => (
  <Show
    when={props.account.profile()?.avatarUrl}
    fallback={
      <span
        class={cx(
          "button-primary inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
          props.class,
        )}
        data-account-initials
      >
        {initialsOf(props.account.session()?.username ?? "")}
      </span>
    }
  >
    {(src) => (
      <img
        src={src()}
        alt=""
        class={cx("shrink-0 rounded-full object-cover", props.class)}
        data-account-avatar
      />
    )}
  </Show>
);

/**
 * The app bar's Account button: the WACS sign-in, wherever you are. Signed
 * out it is a person icon and opens the sign-in form; signed in it is the
 * person's picture (or initials) and opens who they are, Sign out, and their
 * WACS account settings. Sefer keeps no account settings of its own, so that
 * button opens WACS's page. The sync popover's Sign in opens this.
 */
export function AccountButton() {
  const account = createAccount(useShell());
  const outside = openOutside();
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
      class="w-96 p-6"
      open={account.panelOpen()}
      onOpenChange={account.setPanelOpen}
      initialFocus="input"
      keepOpenForPasswordManagers
      trigger={
        <IconButton
          label={label()}
          data-testid="app-bar-account"
          aria-pressed={account.panelOpen() ? "true" : "false"}
          tooltipSide="bottom"
          icon={
            <Show when={account.session()} fallback={<UserIcon size={20} />}>
              <Avatar account={account} class="size-8 text-small" />
            </Show>
          }
        />
      }
    >
      <div data-account-panel>
        <Show
          when={account.host}
          fallback={
            <p class="text-small text-on-surface-tertiary" data-cloud="unconfigured">
              {m.workspace_cloud_sync_has_no_server()}
            </p>
          }
        >
          {(base) => (
            <Show
              when={account.session()}
              fallback={<SignInForm account={account} host={base()} />}
            >
              {(held) => (
                <div class="space-y-4">
                  <div class="flex items-center gap-3">
                    <Avatar account={account} class="size-14 text-h4" />
                    <div class="min-w-0">
                      <p class="truncate text-body font-semibold text-on-surface-primary">
                        {account.profile()?.fullName || held().username}
                      </p>
                      <p class="truncate text-small text-on-surface-tertiary">
                        {account.profile()?.email || base().replace(/^https?:\/\//u, "")}
                      </p>
                    </div>
                  </div>
                  <Show when={account.problem() !== ""}>
                    <p class="text-small break-words text-on-surface-error" data-cloud="problem">
                      {account.problem()}
                    </p>
                  </Show>
                  <div class="space-y-2">
                    <Button
                      variant="secondary"
                      class="w-full justify-center"
                      icon={<LogOut size={20} />}
                      onClick={account.signOut}
                      disabled={account.busy()}
                      data-testid="account-sign-out"
                    >
                      {m.common_sign_out()}
                    </Button>
                    <ButtonLink
                      variant="secondary"
                      class="w-full justify-center"
                      icon={<UserCog size={20} />}
                      href={wacsPage(base(), "/user/settings")}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={outside}
                      data-testid="account-settings"
                    >
                      {m.account_settings()}
                      <SquareArrowOutUpRight size={16} aria-hidden="true" />
                    </ButtonLink>
                  </div>
                </div>
              )}
            </Show>
          )}
        </Show>
      </div>
    </Popover>
  );
}
