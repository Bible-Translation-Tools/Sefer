import type { JSX } from "@solidjs/web";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect, Result } from "effect";
import { For, createSignal } from "solid-js";

import { t } from "../app/i18n";
import { useShell } from "../app/ProjectContext";
import { shellSettings, type AnyDescriptor } from "../app/settings";
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
          <input
            id={descriptor.key.name}
            type="checkbox"
            checked={read(descriptor.key)}
            onChange={(event) => write(descriptor.key, event.currentTarget.checked)}
          />
        );
      case "number":
        return (
          <input
            id={descriptor.key.name}
            type="number"
            value={read(descriptor.key)}
            onChange={(event) => write(descriptor.key, Number(event.currentTarget.value))}
          />
        );
      case "string":
        return (
          <input
            id={descriptor.key.name}
            type="text"
            value={read(descriptor.key)}
            onChange={(event) => write(descriptor.key, event.currentTarget.value)}
          />
        );
    }
  };

  return (
    <main>
      <header>
        <h2>{t("Settings")}</h2>
        <span class="muted spacer">{shell.services.hostInfo.kind()}</span>
      </header>

      <ul class="list" data-settings={descriptors.length}>
        <For each={descriptors}>
          {(descriptor) => (
            <li data-setting={descriptor.key.name}>
              <label for={descriptor.key.name}>{t(descriptor.label)}</label>
              <span class="spacer" />
              {widget(descriptor)}
            </li>
          )}
        </For>
      </ul>

      <p class="muted">{problem()}</p>
      <p class="muted">
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
