import type { JSX } from "@solidjs/web";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect, Fiber, Result, Stream } from "effect";
import Minus from "lucide-solid/icons/minus";
import Plus from "lucide-solid/icons/plus";
import { For, Show, createSignal, onCleanup } from "solid-js";

import { endpointsChangedSinceBoot } from "../app/endpoints";
import { t } from "../app/i18n";
import { useShell } from "../app/ProjectContext";
import { SETTING_GROUPS, shellKeys, shellSettings, type AnyDescriptor } from "../app/settings";
import { CloudPanel } from "../app/ui/CloudPanel";
import { Breadcrumb } from "../app/ui/landing/Breadcrumb";
import {
  Button,
  Card,
  IconButton,
  Input,
  PanelHeader,
  SegmentedControl,
  Switch,
} from "../app/ui/primitives";
import { ShellGate } from "../app/ui/ShellGate";
import { applyAppearance, asTheme, type Appearance } from "../app/ui/theme";
import { UpdatePanel } from "../app/ui/UpdatePanel";
import type { SettingKey } from "../core/host/settings";

/**
 * The settings screen: one card per declared group, one row per registered key,
 * and the widget chosen by the descriptor's `kind`.
 *
 * Reads are synchronous — `Settings.get` returns an already-decoded value — and
 * writes are Effects, because a write validates against the key's schema and
 * rewrites the whole file. A rejected write is shown rather than swallowed: a
 * preference that silently did not stick is worse than an error.
 *
 * Three of the keys are also DOM state — theme, interface text size, zoom — so
 * every write re-applies the whole appearance to `<html>` through
 * `src/app/ui/theme.ts`. That module is the only writer of `data-theme`, and it
 * caches the answer so the next load's first paint does not have to wait for
 * the composition to build.
 *
 * The `switch` on `kind` is a plain switch, not a `<Switch>`: a preference's
 * type never changes at runtime, and only a real switch narrows the key's type
 * parameter along with the widget.
 */

function SettingsPage() {
  const shell = useShell();
  const { services } = shell;
  const keys = shellKeys(services.settings);
  const descriptors = shellSettings(services.settings);
  const [tick, setTick] = createSignal(0, { name: "settingsTick" });
  const [problem, setProblem] = createSignal("", { name: "settingsProblem" });
  const [advancedVisible, setAdvancedVisible] = createSignal(
    services.settings.get(keys.showAdvancedSettings),
    { name: "showAdvancedSettings" },
  );
  const advancedChanges = services.runtime.runFork(
    Stream.runForEach(services.settings.changes(keys.showAdvancedSettings), (visible) =>
      Effect.sync(() => setAdvancedVisible(visible)),
    ),
  );
  onCleanup(() => {
    Effect.runFork(Fiber.interrupt(advancedChanges));
  });

  /**
   * Whether a reload would change what a transfer or a catalogue read does.
   *
   * The composition captured its endpoints once at boot, so a change here
   * reaches the screens immediately and the services not at all. Saying so and
   * offering the reload is honest; silently doing nothing until the next
   * launch is not. `tick` is read so this re-runs after every write.
   */
  const drifted = (): boolean => {
    tick();
    return endpointsChangedSinceBoot(services.settings, services.hostInfo.kind());
  };

  const read = <S,>(key: SettingKey<S>): S => {
    tick();
    return services.settings.get(key);
  };

  /** The three appearance keys as one value, read straight out of Settings. */
  const appearance = (): Appearance => ({
    theme: asTheme(services.settings.get(keys.theme)),
    fontSize: services.settings.get(keys.fontSize),
    zoom: services.settings.get(keys.zoom),
  });

  // The authoritative read, once the composition is up. The module-level apply
  // in theme.ts used the cache; this corrects it if Settings disagrees.
  applyAppearance(appearance());

  const write = <S,>(key: SettingKey<S>, value: S): void => {
    void services.run(Effect.result(services.settings.set(key, value))).then((result) => {
      setProblem(
        Result.isFailure(result)
          ? t("{key}: {reason}", { key: result.failure.key, reason: result.failure.reason })
          : "",
      );
      setTick((held) => held + 1);
      applyAppearance(appearance());
    });
  };

  /** Proto's font-size and zoom controls: a value between two repeat buttons. */
  const stepper = (descriptor: AnyDescriptor & { readonly kind: "number" }): JSX.Element => {
    const step = descriptor.step ?? 1;
    const low = descriptor.min ?? Number.NEGATIVE_INFINITY;
    const high = descriptor.max ?? Number.POSITIVE_INFINITY;
    const value = (): number => read(descriptor.key);
    const nudge = (by: number): void =>
      write(descriptor.key, Math.min(high, Math.max(low, value() + by)));

    return (
      <div class="flex items-center gap-1">
        <IconButton
          label={t("Decrease {label}", { label: t(descriptor.label) })}
          variant="outlined"
          size="sm"
          icon={<Minus size={14} />}
          disabled={value() <= low}
          onClick={() => nudge(-step)}
        />
        <span class="w-16 text-center text-small tabular-nums text-on-surface-primary">
          {value()}
          {descriptor.unit ?? ""}
        </span>
        <IconButton
          label={t("Increase {label}", { label: t(descriptor.label) })}
          variant="outlined"
          size="sm"
          icon={<Plus size={14} />}
          disabled={value() >= high}
          onClick={() => nudge(step)}
        />
      </div>
    );
  };

  const widget = (descriptor: AnyDescriptor): JSX.Element => {
    switch (descriptor.kind) {
      case "boolean":
        return (
          <Switch
            id={descriptor.key.name}
            aria-label={t(descriptor.label)}
            checked={read(descriptor.key)}
            onChange={(next) => write(descriptor.key, next)}
          />
        );
      case "choice":
        return (
          <SegmentedControl
            size="sm"
            label={t(descriptor.label)}
            value={read(descriptor.key)}
            onChange={(next) => write(descriptor.key, next)}
            items={descriptor.options.map((option) => ({
              value: option.value,
              label: t(option.label),
            }))}
          />
        );
      case "number":
        return stepper(descriptor);
      case "string":
        return (
          <Input
            id={descriptor.key.name}
            type="text"
            size="sm"
            wrapperClass="w-64"
            value={read(descriptor.key)}
            onChange={(event) => write(descriptor.key, event.currentTarget.value)}
          />
        );
    }
  };

  return (
    <main class="min-w-0 max-w-4xl space-y-5 p-6">
      <Breadcrumb crumbs={[{ label: t("Sefer"), to: "/" }, { label: t("Settings") }]} />
      <PanelHeader
        title={t("Settings")}
        subtitle={t("{host} · {storage}", {
          host: services.hostInfo.kind(),
          storage: services.storage,
        })}
      />

      <For each={SETTING_GROUPS}>
        {(group) => {
          const rows = descriptors.filter(
            (descriptor) =>
              descriptor.group === group.id &&
              (group.id !== "advanced" || advancedVisible()) &&
              // A preference that cannot matter on this host is not drawn.
              // The WACS endpoint is the only one: on the Web it is normally a
              // proxy, because a browser cannot reach the content host
              // directly, and desktop has no such problem.
              (descriptor.hosts === undefined ||
                descriptor.hosts.includes(services.hostInfo.kind())),
          );
          return (
            <Show when={rows.length > 0}>
              <Card class="space-y-1" data-settings-group={group.id}>
                <PanelHeader level={3} title={t(group.title)} subtitle={t(group.subtitle)} />
                <div class="divide-y divide-surface-border">
                  <For each={rows}>
                    {(descriptor) => (
                      <div class="flex items-center gap-6 py-3" data-setting={descriptor.key.name}>
                        <label
                          for={descriptor.key.name}
                          class="min-w-0 flex-1 text-small text-on-surface-primary"
                        >
                          {t(descriptor.label)}
                          <Show when={descriptor.description}>
                            {(description) => (
                              <span class="block text-smallest text-on-surface-tertiary">
                                {t(description())}
                              </span>
                            )}
                          </Show>
                        </label>
                        <div class="shrink-0">{widget(descriptor)}</div>
                      </div>
                    )}
                  </For>
                </div>
                <Show when={group.id === "network" && drifted()}>
                  <div class="flex items-center gap-3 pt-3">
                    <p class="min-w-0 flex-1 text-smallest text-on-surface-tertiary">
                      {t(
                        "Screens are using the new endpoint already; transfers and the catalogue were built with the old one and change on reload.",
                      )}
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => globalThis.location.reload()}
                    >
                      {t("Reload")}
                    </Button>
                  </div>
                </Show>
              </Card>
            </Show>
          );
        }}
      </For>

      <Show when={problem() !== ""}>
        <p class="text-small text-on-surface-error">{problem()}</p>
      </Show>

      <UpdatePanel />

      <CloudPanel root={shell.project()?.root} />

      <p class="text-smallest text-on-surface-tertiary">
        {t("Stored in {file}", {
          file: `${services.hostInfo.paths().appData}/settings.json`,
        })}
      </p>
    </main>
  );
}

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Sefer — settings" }] }),
  component: () => <ShellGate>{() => <SettingsPage />}</ShellGate>,
});
