import type { JSX } from "@solidjs/web";
import { Link, createFileRoute } from "@tanstack/solid-router";
import { Effect, Fiber, Result, Stream } from "effect";
import Minus from "lucide-solid/icons/minus";
import Plus from "lucide-solid/icons/plus";
import { For, Show, createSignal, onCleanup, untrack } from "solid-js";

import { exportDiagnostics } from "#app/diagnostics";
import { BUILD_ENDPOINTS, endpointsChangedSinceBoot } from "#app/endpoints";
import { t } from "#app/i18n";
import { useShell } from "#app/ProjectContext";
import { SETTING_GROUPS, shellKeys, shellSettings, type AnyDescriptor } from "#app/settings";
import { TutorialsCard } from "#app/tour/TutorialsCard";
import { CloudPanel } from "#app/ui/CloudPanel";
import { Breadcrumb } from "#app/ui/landing/Breadcrumb";
import {
  Button,
  Card,
  IconButton,
  Input,
  PanelHeader,
  SegmentedControl,
  Switch,
} from "#app/ui/primitives";
import { ShellGate } from "#app/ui/ShellGate";
import { SourceTextsCard } from "#app/ui/SourceTextsCard";
import { SousSettingsPanel } from "#app/ui/SousSettingsPanel";
import {
  applyAppearance,
  asDiffPalette,
  asDiffRemoved,
  asTheme,
  type Appearance,
} from "#app/ui/theme";
import { UpdatePanel } from "#app/ui/UpdatePanel";
import type { SettingKey } from "#core/host/settings";
import { parseTransport } from "#core/remote/transport";

import "@sefer/editor/editor.css";

/**
 * The settings screen, under the open project (Will, 2026-10-07: leaving
 * the project to reach Settings unloaded it, and half of what is here — the
 * Cloud section — is about that project anyway). The preferences themselves
 * are still this device's, for every project.
 *
 * One card per declared group, one row per registered key,
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
  const search = Route.useSearch();
  const tab = (): SettingsTab => search().tab ?? "preferences";
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

  const drifted = (): boolean => {
    tick();
    return endpointsChangedSinceBoot(services.settings);
  };

  const read = <S,>(key: SettingKey<S>): S => {
    tick();
    return services.settings.get(key);
  };

  const appearance = (): Appearance => ({
    theme: asTheme(services.settings.get(keys.theme)),
    fontSize: services.settings.get(keys.fontSize),
    zoom: services.settings.get(keys.zoom),
    diffPalette: asDiffPalette(services.settings.get(keys.diffPalette)),
    diffRemoved: asDiffRemoved(services.settings.get(keys.diffRemoved)),
  });

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
          icon={<Minus />}
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
          icon={<Plus />}
          disabled={value() >= high}
          onClick={() => nudge(step)}
        />
      </div>
    );
  };

  const NetworkRow = (rowProps: { readonly descriptor: AnyDescriptor & { kind: "string" } }) => {
    const key = untrack(() => rowProps.descriptor.key);
    const which = (): keyof typeof BUILD_ENDPOINTS | undefined => {
      const held = shellKeys(services.settings);
      if (key === held.contentHost) return "contentHost";
      if (key === held.catalogueUrl) return "catalogueUrl";
      if (key === held.webTransport) return "webTransport";
      return undefined;
    };
    const built = (): string => {
      const name = which();
      return (name === undefined ? null : BUILD_ENDPOINTS[name]) ?? "";
    };
    const stored = (): string => read(key).trim();
    const inUse = (): string => stored() || built();
    const [draft, setDraft] = createSignal(untrack(inUse), { name: "networkDraft" });

    const invalid = (): string => {
      const value = draft().trim();
      if (value === "") return "";
      if (which() === "webTransport") {
        const pairs = value.split(",").filter((pair) => pair.trim() !== "");
        return parseTransport(value).size === pairs.length
          ? ""
          : t("Every pair must be host=proxy, both full URLs.");
      }
      try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:"
          ? ""
          : t("Use a full http(s) URL.");
      } catch {
        return t("Use a full http(s) URL.");
      }
    };
    const dirty = (): boolean => draft().trim() !== inUse();
    const save = (): void => {
      const value = draft().trim();
      write(key, value === built() ? "" : value);
      if (value === "") setDraft(built());
    };
    const useBuilds = (): void => {
      write(key, "");
      setDraft(built());
    };

    return (
      <div class="space-y-2 py-3" data-setting={key.name}>
        <label for={key.name} class="block text-small text-on-surface-primary">
          {t(rowProps.descriptor.label)}
          <Show when={rowProps.descriptor.description}>
            {(description) => (
              <span class="block text-smallest text-on-surface-tertiary">{t(description())}</span>
            )}
          </Show>
        </label>
        <div class="flex items-center gap-2">
          <Input
            id={key.name}
            type="text"
            size="sm"
            wrapperClass="min-w-0 flex-1"
            class="font-mono"
            spellcheck={false}
            placeholder={built() || t("none")}
            value={draft()}
            aria-invalid={invalid() === "" ? undefined : "true"}
            onInput={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && dirty() && invalid() === "") save();
            }}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty() || invalid() !== ""}
            onClick={save}
          >
            {t("Save")}
          </Button>
          <Button size="sm" variant="secondary" disabled={stored() === ""} onClick={useBuilds}>
            {t("Use this build's")}
          </Button>
        </div>
        <p data-in-use={key.name} class="text-smallest text-on-surface-tertiary">
          <Show
            when={invalid() === ""}
            fallback={<span class="text-on-surface-error">{invalid()}</span>}
          >
            {stored() === ""
              ? t("In use: this build's value.")
              : t("In use: your override. This build's is {built}.", {
                  built: built() || t("none"),
                })}
          </Show>
        </p>
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
      <Breadcrumb
        crumbs={[
          { label: t("Sefer"), to: "/" },
          { label: t("Projects"), to: "/projects" },
          { label: t("Settings") },
        ]}
      />
      <PanelHeader
        title={t("Settings")}
        subtitle={t("{host} · {storage}", {
          host: services.hostInfo.kind(),
          storage: services.storage,
        })}
      />

      <nav aria-label={t("Settings sections")} class="flex border-b border-surface-border">
        <For each={SETTINGS_TABS}>
          {(entry) => (
            <Link
              to="/project/$slug/settings"
              params={{ slug: shell.slug() }}
              search={entry.id === "preferences" ? {} : { tab: entry.id }}
              class={TAB}
              aria-current={tab() === entry.id ? "page" : undefined}
              data-settings-tab={entry.id}
            >
              {t(entry.label)}
            </Link>
          )}
        </For>
      </nav>

      <Show when={tab() === "tutorials"}>
        <TutorialsCard kind="tutorial" />
      </Show>

      <Show when={tab() === "workflows"}>
        <TutorialsCard kind="workflow" />
      </Show>

      <Show when={tab() === "preferences"}>
        <For each={SETTING_GROUPS}>
          {(group) => {
            const rows = () =>
              descriptors.filter(
                (descriptor) =>
                  descriptor.group === group.id &&
                  ((group.id !== "advanced" && group.id !== "network") || advancedVisible()) &&
                  (descriptor.hosts === undefined ||
                    descriptor.hosts.includes(services.hostInfo.kind())),
              );
            return (
              <Show when={rows().length > 0}>
                <Card class="space-y-1" data-settings-group={group.id}>
                  <PanelHeader level={3} title={t(group.title)} subtitle={t(group.subtitle)} />
                  <div class="divide-y divide-surface-border">
                    <For each={rows()}>
                      {(descriptor) =>
                        descriptor.group === "network" && descriptor.kind === "string" ? (
                          <NetworkRow descriptor={descriptor} />
                        ) : (
                          <div
                            class="flex items-center gap-6 py-3"
                            data-setting={descriptor.key.name}
                          >
                            <div class="min-w-0 flex-1">
                              <label
                                for={descriptor.key.name}
                                class="block text-small text-on-surface-primary"
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
                              <Show when={descriptor.kind === "choice" && descriptor.preview}>
                                <DiffSample />
                              </Show>
                            </div>
                            <div class="shrink-0">{widget(descriptor)}</div>
                          </div>
                        )
                      }
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

        <SousSettingsPanel />

        <Show when={advancedVisible()}>
          <Card class="space-y-1" data-settings-group="diagnostics">
            <PanelHeader
              level={3}
              title={t("Diagnostics")}
              subtitle={t(
                "What Sefer recorded on this device, as one file to send to someone helping you. Paths are shortened and account names are left out.",
              )}
            />
            <div class="flex items-center gap-6 py-3">
              <p class="min-w-0 flex-1 text-smallest text-on-surface-tertiary">
                {t("Kept for seven days, at most {size} MB.", { size: 5 })}
              </p>
              <Button
                size="sm"
                variant="secondary"
                data-action="export-diagnostics"
                onClick={() => void exportDiagnostics(services, shell.project())}
              >
                {t("Export diagnostics")}
              </Button>
            </div>
          </Card>
        </Show>

        <UpdatePanel />

        <CloudPanel root={shell.project()?.root} />

        <SourceTextsCard />

        <p class="text-smallest text-on-surface-tertiary">
          {t("Stored in {file}", {
            file: `${services.hostInfo.paths().appData}/settings.json`,
          })}
        </p>
      </Show>
    </main>
  );
}

function DiffSample() {
  return (
    <div
      class="mt-2 overflow-hidden rounded-md border border-surface-border font-[family-name:var(--font-scripture)] text-small"
      aria-hidden="true"
      data-diff-sample
    >
      <p class="cm-diff-was px-3 py-1">
        {t("And God")} <span class="cm-diff-removed">{t("spoke")}</span> {t("all these words")}
      </p>
      <p class="cm-diff-now px-3 py-1">
        {t("And God")} <span class="cm-diff-added">{t("said")}</span> {t("all these words")}
      </p>
    </div>
  );
}

type SettingsTab = "preferences" | "tutorials" | "workflows";
const SETTINGS_TABS: readonly { readonly id: SettingsTab; readonly label: string }[] = [
  { id: "preferences", label: "Preferences" },
  { id: "tutorials", label: "Tutorials" },
  { id: "workflows", label: "Workflows" },
];

const TAB = [
  "border-b-2 px-3 py-2 text-center text-small no-underline transition-colors",
  "aria-[current=page]:border-brand aria-[current=page]:font-medium aria-[current=page]:text-on-surface-primary",
  "not-aria-[current=page]:border-transparent not-aria-[current=page]:text-on-surface-tertiary",
  "not-aria-[current=page]:hover:text-on-surface-secondary",
].join(" ");

export const Route = createFileRoute("/_app/project/$slug/settings")({
  validateSearch: (search: Record<string, unknown>): { readonly tab?: SettingsTab } =>
    search["tab"] === "tutorials" || search["tab"] === "workflows" ? { tab: search["tab"] } : {},
  head: () => ({ meta: [{ title: "Sefer — settings" }] }),
  component: () => <ShellGate>{() => <SettingsPage />}</ShellGate>,
});
