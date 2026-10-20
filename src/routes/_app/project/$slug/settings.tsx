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

type Services = ReturnType<typeof useShell>["services"];
type Keys = ReturnType<typeof shellKeys>;

interface SettingsModel {
  readonly read: <S>(key: SettingKey<S>) => S;
  readonly write: <S>(key: SettingKey<S>, value: S) => void;
  readonly drifted: () => boolean;
  readonly problem: () => string;
}

function createAdvancedVisible(services: Services, keys: Keys): () => boolean {
  const [advancedVisible, setAdvancedVisible] = createSignal<boolean>(
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
  return advancedVisible;
}

function createSettingsModel(services: Services, keys: Keys): SettingsModel {
  const [tick, setTick] = createSignal(0, { name: "settingsTick" });
  const [problem, setProblem] = createSignal("", { name: "settingsProblem" });

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

  return { read, write, drifted, problem };
}

function Stepper(props: {
  readonly descriptor: AnyDescriptor & { readonly kind: "number" };
  readonly model: SettingsModel;
}) {
  const descriptor = untrack(() => props.descriptor);
  const step = descriptor.step ?? 1;
  const low = descriptor.min ?? Number.NEGATIVE_INFINITY;
  const high = descriptor.max ?? Number.POSITIVE_INFINITY;
  const value = (): number => props.model.read(descriptor.key);
  const nudge = (by: number): void =>
    props.model.write(descriptor.key, Math.min(high, Math.max(low, value() + by)));

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
}

function createNetworkDraft(services: Services, model: SettingsModel, key: SettingKey<string>) {
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
  const stored = (): string => model.read(key).trim();
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
    model.write(key, value === built() ? "" : value);
    if (value === "") setDraft(built());
  };
  const useBuilds = (): void => {
    model.write(key, "");
    setDraft(built());
  };
  return { built, stored, draft, setDraft, invalid, dirty, save, useBuilds };
}

function NetworkRow(props: {
  readonly descriptor: AnyDescriptor & { kind: "string" };
  readonly model: SettingsModel;
}) {
  const { services } = useShell();
  const key = untrack(() => props.descriptor.key);
  const { built, stored, draft, setDraft, invalid, dirty, save, useBuilds } = createNetworkDraft(
    services,
    untrack(() => props.model),
    key,
  );

  return (
    <div class="space-y-2 py-3" data-setting={key.name}>
      <label for={key.name} class="block text-small text-on-surface-primary">
        {t(props.descriptor.label)}
        <Show when={props.descriptor.description}>
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
        <Button size="sm" variant="primary" disabled={!dirty() || invalid() !== ""} onClick={save}>
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
}

const widget = (descriptor: AnyDescriptor, model: SettingsModel): JSX.Element => {
  switch (descriptor.kind) {
    case "boolean":
      return (
        <Switch
          id={descriptor.key.name}
          aria-label={t(descriptor.label)}
          checked={model.read(descriptor.key)}
          onChange={(next) => model.write(descriptor.key, next)}
        />
      );
    case "choice":
      return (
        <SegmentedControl
          label={t(descriptor.label)}
          value={model.read(descriptor.key)}
          onChange={(next) => model.write(descriptor.key, next)}
          items={descriptor.options.map((option) => ({
            value: option.value,
            label: t(option.label),
          }))}
        />
      );
    case "number":
      return <Stepper descriptor={descriptor} model={model} />;
    case "string":
      return (
        <Input
          id={descriptor.key.name}
          type="text"
          size="sm"
          wrapperClass="w-64"
          value={model.read(descriptor.key)}
          onChange={(event) => model.write(descriptor.key, event.currentTarget.value)}
        />
      );
  }
};

function SettingRow(props: { readonly descriptor: AnyDescriptor; readonly model: SettingsModel }) {
  return (
    <div class="flex items-center gap-6 py-3" data-setting={props.descriptor.key.name}>
      <div class="min-w-0 flex-1">
        <label for={props.descriptor.key.name} class="block text-small text-on-surface-primary">
          {t(props.descriptor.label)}
          <Show when={props.descriptor.description}>
            {(description) => (
              <span class="block text-smallest text-on-surface-tertiary">{t(description())}</span>
            )}
          </Show>
        </label>
        <Show when={props.descriptor.kind === "choice" && props.descriptor.preview}>
          <DiffSample />
        </Show>
      </div>
      <div class="shrink-0">{widget(props.descriptor, props.model)}</div>
    </div>
  );
}

function SettingsGroup(props: {
  readonly group: (typeof SETTING_GROUPS)[number];
  readonly descriptors: readonly AnyDescriptor[];
  readonly advancedVisible: boolean;
  readonly model: SettingsModel;
}) {
  const { services } = useShell();
  const rows = () =>
    props.descriptors.filter(
      (descriptor) =>
        descriptor.group === props.group.id &&
        ((props.group.id !== "advanced" && props.group.id !== "network") ||
          props.advancedVisible) &&
        (descriptor.hosts === undefined || descriptor.hosts.includes(services.hostInfo.kind())),
    );
  return (
    <Show when={rows().length > 0}>
      <Card class="space-y-1" data-settings-group={props.group.id}>
        <PanelHeader level={3} title={t(props.group.title)} subtitle={t(props.group.subtitle)} />
        <div class="divide-y divide-surface-border">
          <For each={rows()}>
            {(descriptor) =>
              descriptor.group === "network" && descriptor.kind === "string" ? (
                <NetworkRow descriptor={descriptor} model={props.model} />
              ) : (
                <SettingRow descriptor={descriptor} model={props.model} />
              )
            }
          </For>
        </div>
        <Show when={props.group.id === "network" && props.model.drifted()}>
          <div class="flex items-center gap-3 pt-3">
            <p class="min-w-0 flex-1 text-smallest text-on-surface-tertiary">
              {t(
                "Screens are using the new endpoint already; transfers and the catalogue were built with the old one and change on reload.",
              )}
            </p>
            <Button size="sm" variant="secondary" onClick={() => globalThis.location.reload()}>
              {t("Reload")}
            </Button>
          </div>
        </Show>
      </Card>
    </Show>
  );
}

function DiagnosticsCard() {
  const shell = useShell();
  const { services } = shell;
  return (
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
  );
}

function PreferencesTab(props: {
  readonly descriptors: readonly AnyDescriptor[];
  readonly advancedVisible: boolean;
  readonly model: SettingsModel;
}) {
  const shell = useShell();
  const { services } = shell;
  return (
    <>
      <For each={SETTING_GROUPS}>
        {(group) => (
          <SettingsGroup
            group={group}
            descriptors={props.descriptors}
            advancedVisible={props.advancedVisible}
            model={props.model}
          />
        )}
      </For>

      <Show when={props.model.problem() !== ""}>
        <p class="text-small text-on-surface-error">{props.model.problem()}</p>
      </Show>

      <SousSettingsPanel />

      <Show when={props.advancedVisible}>
        <DiagnosticsCard />
      </Show>

      <UpdatePanel />

      <CloudPanel root={shell.project()?.root} />

      <SourceTextsCard />

      <p class="text-smallest text-on-surface-tertiary">
        {t("Stored in {file}", {
          file: `${services.hostInfo.paths().appData}/settings.json`,
        })}
      </p>
    </>
  );
}

function SettingsPage() {
  const shell = useShell();
  const { services } = shell;
  const search = Route.useSearch();
  const tab = (): SettingsTab => search().tab ?? "preferences";
  const keys = shellKeys(services.settings);
  const descriptors = shellSettings(services.settings);
  const advancedVisible = createAdvancedVisible(services, keys);
  const model = createSettingsModel(services, keys);

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
        <PreferencesTab
          descriptors={descriptors}
          advancedVisible={advancedVisible()}
          model={model}
        />
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
