import { Show, createSignal } from "solid-js";

import { UpdaterError, type AvailableUpdate } from "#core/host/updater";

import { t } from "../i18n";
import { useServices } from "../ProjectContext";
import { Button, Card, PanelHeader } from "./primitives";

type Busy = "" | "checking" | "installing";

type Services = ReturnType<typeof useServices>;

function createUpdater(services: Services) {
  const [busy, setBusy] = createSignal<Busy>("", { name: "updateBusy" });
  const [available, setAvailable] = createSignal<AvailableUpdate | undefined>(undefined, {
    name: "updateAvailable",
  });
  const [note, setNote] = createSignal("", { name: "updateNote" });

  const check = (): void => {
    setBusy("checking");
    setNote("");
    setAvailable(undefined);
    const operation = services.composition.observability.operation("update.check", {
      "update.channel": services.updater.channel(),
    });
    void services.run(services.updater.check()).then((result) => {
      operation.end(result._tag === "Unavailable" ? "unavailable" : "passed", {
        "update.result": result._tag,
      });
      setBusy("");
      if (result._tag === "Available") {
        setAvailable(result.update);
        return;
      }
      setNote(result._tag === "UpToDate" ? t("Sefer is up to date.") : result.reason);
    });
  };

  const install = (): void => {
    setBusy("installing");
    setNote("");
    const operation = services.composition.observability.operation("update.install", {
      "update.channel": services.updater.channel(),
    });
    void services
      .run(services.updater.installAndRelaunch())
      .then(() => {
        operation.end("passed");
      })
      .catch((cause: unknown) => {
        const reason = cause instanceof UpdaterError ? cause.reason : undefined;
        operation.end(reason === "Unavailable" || reason === "Network" ? "unavailable" : "failed", {
          "update.reason": reason ?? "unknown",
        });
        setBusy("");
        setNote(cause instanceof Error ? cause.message : String(cause));
      });
  };

  return { busy, available, note, check, install };
}

const row = (label: string, value: string, mark?: Record<string, string>) => (
  <div class="flex items-center gap-3 px-4 py-2 text-small" {...mark}>
    <span class="text-on-surface-secondary">{label}</span>
    <span class="ms-auto font-mono text-smallest text-on-surface-primary">{value}</span>
  </div>
);

export function UpdatePanel() {
  const services = useServices();
  const { busy, available, note, check, install } = createUpdater(services);

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
