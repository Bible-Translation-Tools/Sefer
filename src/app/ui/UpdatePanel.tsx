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

  return (
    <section data-update-panel>
      <h3>{t("About")}</h3>

      <ul class="list">
        <li>
          <span>{t("Version")}</span>
          <span class="spacer" />
          <span data-update-version>{services.updater.currentVersion()}</span>
        </li>
        <li>
          <span>{t("Channel")}</span>
          <span class="spacer" />
          <span data-update-channel>{services.updater.channel()}</span>
        </li>
        <li>
          <span>{t("Build")}</span>
          <span class="spacer" />
          <span class="muted">{services.hostInfo.build()}</span>
        </li>
      </ul>

      <p>
        <button type="button" onClick={check} disabled={busy() !== ""}>
          {t("Check for updates")}
        </button>
      </p>

      <Show when={available()}>
        {(update) => (
          <p data-update-available>
            {t("Version {version} is available.", { version: update().version })}{" "}
            <button type="button" onClick={install} disabled={busy() !== ""}>
              {t("Install and relaunch")}
            </button>
          </p>
        )}
      </Show>

      <Show when={busy() === "checking"}>
        <p class="muted">{t("Checking…")}</p>
      </Show>
      <Show when={busy() === "installing"}>
        <p class="muted">{t("Downloading and installing…")}</p>
      </Show>

      <p class="muted" data-update-note>
        {note()}
      </p>
    </section>
  );
}
