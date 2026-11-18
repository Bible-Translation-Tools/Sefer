import type { JSX } from "@solidjs/web";
import { Link, useNavigate } from "@tanstack/solid-router";
import { Effect, Fiber, Result, Stream } from "effect";
import Minus from "lucide-solid/icons/minus";
import Plus from "lucide-solid/icons/plus";
import { For, Show, createSignal, onCleanup, untrack } from "solid-js";

import { exportDiagnostics } from "#app/diagnostics";
import { BUILD_ENDPOINTS, endpointsChangedSinceBoot } from "#app/endpoints";
import type { Message } from "#app/i18n";
import { m } from "#app/paraglide/messages";
import { useShell } from "#app/ProjectContext";
import { SETTING_GROUPS, shellKeys, shellSettings, type AnyDescriptor } from "#app/settings";
import { TutorialsCard } from "#app/tour/TutorialsCard";
import { CloudPanel } from "#app/ui/CloudPanel";
import { DesktopDownloadCard } from "#app/ui/DesktopDownloadCard";
import {
  Button,
  Card,
  IconButton,
  Input,
  PanelHeader,
  SegmentedControl,
  Select,
  Switch,
} from "#app/ui/primitives";
import { NAV_ROW, SettingsNav, createSettingsNav } from "#app/ui/SettingsNav";
import { SourceTextsCard } from "#app/ui/SourceTextsCard";
import { SousSettingsPanel } from "#app/ui/SousSettingsPanel";
import {
  applyAppearance,
  parseDiffPalette,
  parseDiffRemoved,
  parseTheme,
  type Appearance,
} from "#app/ui/theme";
import { UpdatePanel } from "#app/ui/UpdatePanel";
import type { SettingKey } from "#core/host/settings";
import { CHANNEL_ENDPOINTS, WEB_TRANSPORT_SPEC } from "#core/remote/channels";
import { parseTransport } from "#core/remote/transport";

import "@wycliffeassociates/sefer-editor/editor.css";

/**
 * The settings screen. With a project open it lives under it
 * (`/project/$slug/settings`; Will, 2026-10-07: leaving the project to reach
 * Settings unloaded it, and part of what is here is about that project).
 * With none it is `/settings` (Will, 2026-11-18: the preferences are this
 * device's, so they must not need a project); the project's own cards then
 * stay out, as each already does without a root.
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
    theme: parseTheme(services.settings.get(keys.theme)),
    fontSize: services.settings.get(keys.fontSize),
    zoom: services.settings.get(keys.zoom),
    diffPalette: parseDiffPalette(services.settings.get(keys.diffPalette)),
    diffRemoved: parseDiffRemoved(services.settings.get(keys.diffRemoved)),
  });

  applyAppearance(appearance());

  const write = <S,>(key: SettingKey<S>, value: S): void => {
    void services.run(Effect.result(services.settings.set(key, value))).then((result) => {
      setProblem(
        Result.isFailure(result)
          ? m.common_key_reason({ key: result.failure.key, reason: result.failure.reason })
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
        label={m.settings_decrease_label({ label: descriptor.label })}
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
        label={m.settings_increase_label({ label: descriptor.label })}
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
        : m.settings_every_pair_must_be_host();
    }
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:"
        ? ""
        : m.settings_use_a_full_http_s();
    } catch {
      return m.settings_use_a_full_http_s();
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
        {props.descriptor.label}
        <Show when={props.descriptor.description}>
          {(description) => (
            <span class="block text-smallest text-on-surface-tertiary">{description()}</span>
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
          placeholder={built() || m.common_none()}
          value={draft()}
          aria-invalid={invalid() === "" ? undefined : "true"}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && dirty() && invalid() === "") save();
          }}
        />
        <Button size="sm" variant="primary" disabled={!dirty() || invalid() !== ""} onClick={save}>
          {m.common_save()}
        </Button>
        <Button size="sm" variant="secondary" disabled={stored() === ""} onClick={useBuilds}>
          {m.settings_use_this_builds()}
        </Button>
      </div>
      <p data-in-use={key.name} class="text-smallest text-on-surface-tertiary">
        <Show
          when={invalid() === ""}
          fallback={<span class="text-on-surface-error">{invalid()}</span>}
        >
          {stored() === ""
            ? m.settings_in_use_this_builds_value()
            : m.settings_in_use_your_override_this({
                built: built() || m.common_none(),
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
          aria-label={descriptor.label}
          checked={model.read(descriptor.key)}
          onChange={(next) => model.write(descriptor.key, next)}
        />
      );
    case "choice":
      if (descriptor.as === "select")
        return (
          <Select
            id={descriptor.key.name}
            size="sm"
            wrapperClass="w-64"
            value={model.read(descriptor.key)}
            onChange={(event) => model.write(descriptor.key, event.currentTarget.value)}
          >
            <For each={descriptor.options}>
              {(option) => <option value={option.value}>{option.label}</option>}
            </For>
          </Select>
        );
      return (
        <SegmentedControl
          label={descriptor.label}
          value={model.read(descriptor.key)}
          onChange={(next) => model.write(descriptor.key, next)}
          items={descriptor.options.map((option) => ({
            value: option.value,
            label: option.label,
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

type ServerChoice = "build" | "dev" | "production";

/**
 * The quick flip between the dev and production servers: writes the content
 * host, the catalogue and the browser's proxies together (or clears them back
 * to the build's), then reloads, since transfers and the catalogue are wired at boot. The fields
 * below stay for anything else, such as a localhost.
 */
function ServerPreset(props: { readonly model: SettingsModel }) {
  const { services } = useShell();
  const keys = shellKeys(services.settings);
  const choice = (): ServerChoice | undefined => {
    const contentHost = props.model.read(keys.contentHost).trim();
    const catalogueUrl = props.model.read(keys.catalogueUrl).trim();
    if (contentHost === "" && catalogueUrl === "") return "build";
    const resolved = {
      contentHost: contentHost || BUILD_ENDPOINTS.contentHost,
      catalogueUrl: catalogueUrl || BUILD_ENDPOINTS.catalogueUrl,
    };
    for (const channel of ["dev", "production"] as const) {
      const preset = CHANNEL_ENDPOINTS[channel];
      if (
        resolved.contentHost === preset.contentHost &&
        resolved.catalogueUrl === preset.catalogueUrl
      )
        return channel;
    }
    return undefined;
  };
  const pick = (next: ServerChoice): void => {
    if (next === choice()) return;
    const preset = next === "build" ? undefined : CHANNEL_ENDPOINTS[next];
    const value = (wanted: string | undefined, built: string | null): string =>
      wanted === undefined || wanted === built ? "" : wanted;
    void services
      .run(
        Effect.all([
          services.settings.set(
            keys.contentHost,
            value(preset?.contentHost, BUILD_ENDPOINTS.contentHost),
          ),
          services.settings.set(
            keys.catalogueUrl,
            value(preset?.catalogueUrl, BUILD_ENDPOINTS.catalogueUrl),
          ),
          // A build made without servers (a laptop with no .env) has no
          // proxies either, and the browser cannot reach WACS without them.
          services.settings.set(
            keys.webTransport,
            value(
              preset === undefined ? undefined : WEB_TRANSPORT_SPEC,
              BUILD_ENDPOINTS.webTransport,
            ),
          ),
        ]),
      )
      .then(() => globalThis.location.reload());
  };
  return (
    <div class="flex items-center gap-6 py-3" data-setting="network.servers">
      <div class="min-w-0 flex-1">
        <span class="block text-small text-on-surface-primary">{m.settings_servers()}</span>
        <span class="block text-smallest text-on-surface-tertiary">
          {choice() === undefined ? m.settings_servers_custom() : m.settings_servers_description()}
        </span>
      </div>
      <SegmentedControl
        size="sm"
        label={m.settings_servers()}
        value={choice()}
        onChange={pick}
        items={[
          { value: "build", label: m.settings_servers_build() },
          { value: "dev", label: m.settings_servers_dev() },
          { value: "production", label: m.settings_servers_production() },
        ]}
      />
    </div>
  );
}

function SettingRow(props: { readonly descriptor: AnyDescriptor; readonly model: SettingsModel }) {
  return (
    <div class="flex items-center gap-6 py-3" data-setting={props.descriptor.key.name}>
      <div class="min-w-0 flex-1">
        <label for={props.descriptor.key.name} class="block text-small text-on-surface-primary">
          {props.descriptor.label}
          <Show when={props.descriptor.description}>
            {(description) => (
              <span class="block text-smallest text-on-surface-tertiary">{description()}</span>
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
        <PanelHeader level={3} title={props.group.title()} subtitle={props.group.subtitle()} />
        <div class="divide-y divide-surface-border">
          <Show when={props.group.id === "network"}>
            <ServerPreset model={props.model} />
          </Show>
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
              {m.settings_screens_are_using_the_new()}
            </p>
            <Button size="sm" variant="secondary" onClick={() => globalThis.location.reload()}>
              {m.common_reload()}
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
        title={m.settings_diagnostics()}
        subtitle={m.settings_what_sefer_recorded_on_this()}
      />
      <div class="flex items-center gap-6 py-3">
        <p class="min-w-0 flex-1 text-smallest text-on-surface-tertiary">
          {m.settings_kept_for_seven_days_at({ size: 5 })}
        </p>
        <Button
          size="sm"
          variant="secondary"
          data-action="export-diagnostics"
          onClick={() => void exportDiagnostics(services, shell.project())}
        >
          {m.settings_export_diagnostics()}
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

      <Show when={services.hostInfo.kind() === "web"}>
        <DesktopDownloadCard />
      </Show>

      <CloudPanel root={shell.project()?.root} />

      <SourceTextsCard />

      <p class="text-smallest text-on-surface-tertiary">
        {m.settings_stored_in_file({
          file: `${services.hostInfo.paths().appData}/settings.json`,
        })}
      </p>
    </>
  );
}

export function SettingsPage(props: { readonly tab: SettingsTab | undefined }) {
  const shell = useShell();
  const { services } = shell;
  const tab = (): SettingsTab => props.tab ?? "preferences";
  const keys = shellKeys(services.settings);
  const descriptors = shellSettings(services.settings);
  const advancedVisible = createAdvancedVisible(services, keys);
  const model = createSettingsModel(services, keys);
  const nav = createSettingsNav();
  const navigate = useNavigate();

  return (
    <div class="flex items-start gap-8 p-6">
      <aside
        class="sticky top-6 max-h-[calc(100dvh-7.5rem)] w-64 shrink-0 self-start overflow-y-auto scrollbar-padded [--scrollbar-thumb:var(--on-surface-tertiary)]"
        data-settings-nav
      >
        <PanelHeader title={m.common_settings()} />
        <nav aria-label={m.settings_nav_label()} class="mt-3">
          <ul>
            <li>
              <SettingsNav
                nav={nav}
                showing={tab() === "preferences"}
                onPick={() =>
                  shell.slug() === ""
                    ? navigate({ to: "/settings", search: {} })
                    : navigate({
                        to: "/project/$slug/settings",
                        params: { slug: shell.slug() },
                        search: {},
                      })
                }
              />
            </li>
            <For each={SETTINGS_TABS}>
              {(entry) => (
                <li>
                  <Show
                    when={shell.slug() !== ""}
                    fallback={
                      <Link
                        to="/settings"
                        search={{ tab: entry.id }}
                        class={NAV_ROW}
                        aria-current={tab() === entry.id ? "page" : undefined}
                        data-settings-tab={entry.id}
                      >
                        {entry.label()}
                      </Link>
                    }
                  >
                    <Link
                      to="/project/$slug/settings"
                      params={{ slug: shell.slug() }}
                      search={{ tab: entry.id }}
                      class={NAV_ROW}
                      aria-current={tab() === entry.id ? "page" : undefined}
                      data-settings-tab={entry.id}
                    >
                      {entry.label()}
                    </Link>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </nav>
      </aside>

      <main class="min-w-0 max-w-4xl flex-1 space-y-5">
        <Show when={tab() === "tutorials"}>
          <TutorialsCard kind="tutorial" />
        </Show>

        <Show when={tab() === "workflows"}>
          <TutorialsCard kind="workflow" />
        </Show>

        {/* Kept mounted on the other tabs: the side menu lists its sections. */}
        <div class={tab() === "preferences" ? "space-y-5" : "hidden"} ref={nav.watch}>
          <PreferencesTab
            descriptors={descriptors}
            advancedVisible={advancedVisible()}
            model={model}
          />
        </div>
      </main>
    </div>
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
        {m.settings_and_god()} <span class="cm-diff-removed">{m.settings_spoke()}</span>{" "}
        {m.settings_all_these_words()}
      </p>
      <p class="cm-diff-now px-3 py-1">
        {m.settings_and_god()} <span class="cm-diff-added">{m.settings_said()}</span>{" "}
        {m.settings_all_these_words()}
      </p>
    </div>
  );
}

export type SettingsTab = "preferences" | "tutorials" | "workflows";
const SETTINGS_TABS: readonly {
  readonly id: Exclude<SettingsTab, "preferences">;
  readonly label: Message;
}[] = [
  { id: "tutorials", label: m.tour_tutorials },
  { id: "workflows", label: m.tour_workflows },
];

/** The `?tab=` both settings routes accept. */
export const settingsSearch = (
  search: Record<string, unknown>,
): { readonly tab?: Exclude<SettingsTab, "preferences"> } =>
  search["tab"] === "tutorials" || search["tab"] === "workflows" ? { tab: search["tab"] } : {};
