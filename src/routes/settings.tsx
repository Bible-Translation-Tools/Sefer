import type { JSX } from "@solidjs/web";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect, Result } from "effect";
import { For, Show, createSignal } from "solid-js";

import { t } from "../app/i18n";
import { useShell } from "../app/ProjectContext";
import { shellSettings, type AnyDescriptor } from "../app/settings";
import { Card, Input, PanelHeader, Switch } from "../app/ui/primitives";
import { ShellGate } from "../app/ui/ShellGate";
import { UpdatePanel } from "../app/ui/UpdatePanel";
import type { SettingKey } from "../core/host/settings";

/**
 * The settings screen: one widget per registered key, chosen by the
 * descriptor's `kind`.
 *
 * Reads are synchronous — `Settings.get` returns an already-decoded value —
 * and writes are Effects, because a write validates against the key's schema
 * and rewrites the whole file. A rejected write is shown rather than
 * swallowed: a preference that silently did not stick is worse than an error.
 *
 * The `switch` on `kind` is a plain switch, not a `<Switch>`: a preference's
 * type never changes at runtime, and only a real switch narrows the key's type
 * parameter along with the widget.
 */

function SettingsPage() {
  const shell = useShell();
  const descriptors = shellSettings(shell.services.settings);
  const [tick, setTick] = createSignal(0, { name: "settingsTick" });
  const [problem, setProblem] = createSignal("");

  const read = <S,>(key: SettingKey<S>): S => {
    tick();
    return shell.services.settings.get(key);
  };

  const write = <S,>(key: SettingKey<S>, value: S): void => {
    void shell.services
      .run(Effect.result(shell.services.settings.set(key, value)))
      .then((result) => {
        setProblem(
          Result.isFailure(result)
            ? t("{key}: {reason}", { key: result.failure.key, reason: result.failure.reason })
            : "",
        );
        setTick((held) => held + 1);
      });
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
      case "number":
        return (
          <Input
            id={descriptor.key.name}
            type="number"
            size="sm"
            wrapperClass="w-32"
            value={read(descriptor.key)}
            onChange={(event) => write(descriptor.key, Number(event.currentTarget.value))}
          />
        );
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
    <main class="min-w-0 max-w-4xl space-y-4 p-6">
      <PanelHeader title={t("Settings")} subtitle={shell.services.hostInfo.kind()} />

      <Card
        padded={false}
        class="divide-y divide-surface-border"
        data-settings={descriptors.length}
      >
        <For each={descriptors}>
          {(descriptor) => (
            <div class="flex items-center gap-3 px-4 py-3" data-setting={descriptor.key.name}>
              <label for={descriptor.key.name} class="text-small text-on-surface-primary">
                {t(descriptor.label)}
              </label>
              <span class="ms-auto">{widget(descriptor)}</span>
            </div>
          )}
        </For>
      </Card>

      <Show when={problem() !== ""}>
        <p class="text-small text-on-surface-error">{problem()}</p>
      </Show>
      <p class="text-smallest text-on-surface-tertiary">
        {t("Stored in {file}", {
          file: `${shell.services.hostInfo.paths().appData}/settings.json`,
        })}
      </p>

      <UpdatePanel />
    </main>
  );
}

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Sefer — settings" }] }),
  component: () => <ShellGate>{() => <SettingsPage />}</ShellGate>,
});
