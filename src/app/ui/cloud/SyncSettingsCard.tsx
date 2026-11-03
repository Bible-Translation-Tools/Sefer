import { Effect } from "effect";
import { For, createSignal } from "solid-js";

import { m } from "#app/paraglide/messages";

import type { Message } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { setSyncPreference, syncPreferences, type SyncPreferences } from "../../syncSettings";
import { Card, PanelHeader, Switch } from "../primitives";

const ROWS: readonly {
  readonly key: keyof SyncPreferences;
  readonly label: Message;
  readonly detail: Message;
}[] = [
  {
    key: "checkOnOpen",
    label: m.cloud_check_for_changes_on_open,
    detail: m.cloud_when_you_open_this_project,
  },
  {
    key: "sendOnSave",
    label: m.cloud_send_my_changes_on_save,
    detail: m.cloud_when_you_save_send_your,
  },
  {
    key: "skipReviewMine",
    label: m.cloud_skip_review_of_my_changes,
    detail: m.cloud_save_your_changes_directly_without,
  },
  {
    key: "skipReviewIncoming",
    label: m.cloud_skip_review_of_incoming_changes,
    detail: m.cloud_take_changes_from_the_shared,
  },
];

export function SyncSettingsCard(props: { readonly root: string }) {
  const { services } = useShell();
  const [written, setWritten] = createSignal(0, { name: "syncPreferencesWritten" });
  const held = (): SyncPreferences => {
    written();
    return syncPreferences(services.settings, props.root);
  };
  const change = (key: keyof SyncPreferences, value: boolean): void => {
    void services
      .run(Effect.ignore(setSyncPreference(services.settings, props.root, key, value)))
      .then(() => setWritten((count) => count + 1));
  };
  return (
    <Card class="space-y-3" data-cloud-card="settings">
      <PanelHeader level={3} title={m.cloud_for_this_project()} />
      <ul class="space-y-3">
        <For each={ROWS}>
          {(row) => (
            <li class="flex items-start justify-between gap-3">
              <div>
                <p class="text-small font-semibold">{row.label()}</p>
                <p class="text-smallest text-on-surface-secondary">{row.detail()}</p>
              </div>
              <Switch
                aria-label={row.label()}
                checked={held()[row.key]}
                onChange={(value) => change(row.key, value)}
              />
            </li>
          )}
        </For>
      </ul>
    </Card>
  );
}
