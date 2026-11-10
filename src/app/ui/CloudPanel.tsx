import { Show } from "solid-js";

import { m } from "#app/paraglide/messages";

import { useShell } from "../ProjectContext";
import { syncWatch } from "../syncWatch";
import { CollabModeCard, createAccount, SharedProjectCard, SyncSettingsCard } from "./cloud";
import { WriterFollowCard } from "./cloud/WriterFollowCard";
import { WriterSection } from "./cloud/WriterSection";
import { PanelHeader } from "./primitives";

export function CloudPanel(props: { readonly root?: string | undefined }) {
  const account = createAccount(useShell());
  return (
    <section class="space-y-3" data-panel="cloud">
      <PanelHeader level={2} title={m.cloud_cloud()} door={false} />
      <SharedProjectCard account={account} root={props.root} />
      <Show when={props.root}>
        {(root) => (
          <>
            <Show when={syncWatch.sync(root())?.reading.origin !== undefined}>
              <CollabModeCard />
            </Show>
            <SyncSettingsCard root={root()} />
            <WriterFollowCard root={root()} />
            <WriterSection onLeave={() => undefined} />
          </>
        )}
      </Show>
    </section>
  );
}
