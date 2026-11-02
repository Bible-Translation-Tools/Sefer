import UserIcon from "lucide-solid/icons/user";
import { Show } from "solid-js";

import { t } from "../../i18n";
import { m } from "../../paraglide/messages";
import { useShell } from "../../ProjectContext";
import { createAccount } from "../cloud/account";
import { ProblemNote, SignInForm } from "../cloud/SignInForm";
import { Button, IconButton, Popover } from "../primitives";

/** Up to two letters for the avatar: the first of each part of the name ("thomas_hajny" → "TH"). */
const initialsOf = (username: string): string => {
  const parts = username.split(/[\s._-]+/u).filter((part) => part !== "");
  const letters =
    parts.length > 1 ? (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "") : username.slice(0, 2);
  return letters.toUpperCase();
};

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
