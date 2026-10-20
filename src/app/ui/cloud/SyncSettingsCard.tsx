import { Effect } from "effect";
import { For, createSignal } from "solid-js";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { setSyncPreference, syncPreferences, type SyncPreferences } from "../../syncSettings";
import { Card, PanelHeader, Switch } from "../primitives";

const ROWS: readonly {
  readonly key: keyof SyncPreferences;
  readonly label: string;
  readonly detail: string;
}[] = [
  {
    key: "checkOnOpen",
    label: "Check for changes on open",
    detail: "When you open this project, ask the shared project what has changed.",
  },
  {
    key: "sendOnSave",
    label: "Send my changes on save",
    detail:
      "When you save, send your changes — to the shared project, or to your copy if you work in one.",
  },
  {
    key: "skipReviewMine",
    label: "Skip review of my changes",
    detail: "Save your changes directly, without reviewing them first.",
  },
  {
    key: "skipReviewIncoming",
    label: "Skip review of incoming changes",
    detail:
      "Take changes from the shared project without reviewing them — unless they touch a book you have also changed.",
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
      <PanelHeader level={3} title={t("For this project")} />
      <ul class="space-y-3">
        <For each={ROWS}>
          {(row) => (
            <li class="flex items-start justify-between gap-3">
              <div>
                <p class="text-small font-semibold">{t(row.label)}</p>
                <p class="text-smallest text-on-surface-secondary">{t(row.detail)}</p>
              </div>
              <Switch
                aria-label={t(row.label)}
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
