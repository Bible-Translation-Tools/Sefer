/**
 * Settings' Cloud section: the account, the ATTACHMENT half of remote sync,
 * and the open project's sync switches — `AccountCard`, `SharedProjectCard`
 * and `SyncSettingsCard`.
 *
 * Doing sync — the state, the clocks, what would arrive, the one right move —
 * is the app bar's cloud popover. What is here is configuration: choosing
 * WHICH shared project this folder is, creating one when there is none, and
 * what this project may do on open and on save.
 *
 * The account half is not duplicated. `createAccount` is the shared state and
 * `AccountCard` the shared component (`src/app/ui/cloud/account.ts` and
 * `src/app/ui/cloud/AccountCard.tsx`), so the two surfaces cannot disagree
 * about what "signed in" means.
 *
 * The panel holds no domain state. The session lives in `Credentials` (through
 * `Gitea`), the attachment lives in the repository's own `origin`, and the
 * progress line is a subscription to `Remote.progress()` — so a reload or a
 * second panel shows the same truth rather than a copy of it.
 */

import { Show } from "solid-js";

import { t } from "../i18n";
import { useShell } from "../ProjectContext";
import {
  AccountCard,
  CollabModeCard,
  createAccount,
  SharedProjectCard,
  SyncSettingsCard,
} from "./cloud";
import { PanelHeader } from "./primitives";

/**
 * `root` is the project this panel attaches and publishes. Optional, because
 * `/settings` shows the same panel with no project open: signing in and out is
 * an ACCOUNT action and belongs there, while attaching a repository is a fact
 * about one project on disk.
 */
export function CloudPanel(props: { readonly root?: string | undefined }) {
  const account = createAccount(useShell());
  return (
    <section class="space-y-3" data-panel="cloud">
      <PanelHeader level={2} title={t("Cloud")} />
      <AccountCard account={account} />
      <SharedProjectCard account={account} root={props.root} />
      <Show when={props.root}>
        {(root) => (
          <>
            <CollabModeCard />
            <SyncSettingsCard root={root()} />
          </>
        )}
      </Show>
    </section>
  );
}
