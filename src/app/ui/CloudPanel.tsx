/**
 * The cloud panel: the account and the ATTACHMENT half of remote sync, side
 * by side — `AccountCard` and `SharedProjectCard`.
 *
 * `/cloud` is the sync screen, and it owns the state, the two clocks, the
 * incoming plan and the one right button. What is here is the part that
 * belongs beside a project rather than on a screen of its own: choosing WHICH
 * shared project this folder is, and creating one when there is none.
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

import { useShell } from "../ProjectContext";
import { AccountCard, createAccount, SharedProjectCard } from "./cloud";

/**
 * `root` is the project this panel attaches and publishes. Optional, because
 * `/settings` shows the same panel with no project open: signing in and out is
 * an ACCOUNT action and belongs there, while attaching a repository is a fact
 * about one project on disk.
 */
export function CloudPanel(props: { readonly root?: string | undefined }) {
  const account = createAccount(useShell());
  return (
    <div class="space-y-3" data-panel="cloud">
      <AccountCard account={account} />
      <SharedProjectCard account={account} root={props.root} />
    </div>
  );
}
