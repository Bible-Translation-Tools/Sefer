/**
 * The About block in Settings: which build this is, and how to replace it.
 *
 * Small on purpose. It is the surface that proves the `Updater` port is wired
 * end to end — version and channel read from the running bundle, a check that
 * reaches the updater worker, an install that verifies a minisign signature
 * and relaunches — and nothing more. The manual version picker
 * (`Updater.listVersions` / `installVersion`) exists in the port and is
 * deliberately not shown yet: installing an older build is a decision that
 * needs its own confirmation, not a click.
 *
 * On the Web host every install path answers "this build cannot update
 * itself". The panel still renders there, because the version and channel are
 * worth reading on every host — that is the whole reason `Updater` is a port
 * with a refusing implementation rather than a desktop-only import.
 */

import { Show, createSignal } from "solid-js";

import type { AvailableUpdate } from "../../core/host/updater";
import { t } from "../i18n";
import { useServices } from "../ProjectContext";
import { Button, Card, PanelHeader } from "./primitives";

/** What the panel is waiting on; `""` means nothing. */
type Busy = "" | "checking" | "installing";

export function UpdatePanel() {
  const services = useServices();
  const [busy, setBusy] = createSignal<Busy>("", { name: "updateBusy" });
  const [available, setAvailable] = createSignal<AvailableUpdate | undefined>(undefined, {
    name: "updateAvailable",
  });
  const [note, setNote] = createSignal("", { name: "updateNote" });

  const check = (): void => {
    setBusy("checking");
    setNote("");
    setAvailable(undefined);
    void services.run(services.updater.check()).then((result) => {
      setBusy("");
      if (result._tag === "Available") {
        setAvailable(result.update);
        return;
      }
      setNote(result._tag === "UpToDate" ? t("Sefer is up to date.") : result.reason);
    });
  };

  /**
   * On success this never returns — the host installs and relaunches. So there
   * is no "installed" state to render, only the failure someone has to see.
   */
  const install = (): void => {
    setBusy("installing");
    setNote("");
    void services.run(services.updater.installAndRelaunch()).catch((cause: unknown) => {
      setBusy("");
      setNote(cause instanceof Error ? cause.message : String(cause));
    });
  };

  const row = (label: string, value: string, mark?: Record<string, string>) => (
    <div class="flex items-center gap-3 px-4 py-2 text-small" {...mark}>
      <span class="text-on-surface-secondary">{label}</span>
      <span class="ms-auto font-mono text-smallest text-on-surface-primary">{value}</span>
    </div>
  );

  return (
    <Card padded={false} class="divide-y divide-surface-border" data-update-panel>
      <div class="px-4 py-3">
        <PanelHeader
          level={3}
          title={t("About")}
          actions={
            <Button
              size="sm"
              onClick={check}
              disabled={busy() !== ""}
              loading={busy() === "checking"}
            >
              {t("Check for updates")}
            </Button>
          }
        />
      </div>

      {row(t("Version"), services.updater.currentVersion(), { "data-update-version": "" })}
      {row(t("Channel"), services.updater.channel(), { "data-update-channel": "" })}
      {row(t("Build"), services.hostInfo.build())}

      <Show when={available()}>
        {(update) => (
          <div class="flex items-center gap-3 px-4 py-3 text-small" data-update-available>
            {t("Version {version} is available.", { version: update().version })}
            <Button
              variant="primary"
              size="sm"
              class="ms-auto"
              onClick={install}
              disabled={busy() !== ""}
              loading={busy() === "installing"}
            >
              {t("Install and relaunch")}
            </Button>
          </div>
        )}
      </Show>

      <Show when={busy() === "installing"}>
        <p class="px-4 py-2 text-small text-on-surface-tertiary">
          {t("Downloading and installing…")}
        </p>
      </Show>

      <Show when={note() !== ""}>
        <p class="px-4 py-2 text-smallest text-on-surface-tertiary" data-update-note>
          {note()}
        </p>
      </Show>
    </Card>
  );
}
