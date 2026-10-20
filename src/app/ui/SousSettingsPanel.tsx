import { Dynamic } from "@solidjs/web";
import { Effect, Fiber, Result, Stream } from "effect";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import { For, Show, createSignal, onCleanup, untrack } from "solid-js";

import {
  SOUS_SETTING_KEYS,
  SOUS_SETTINGS,
  type SousSettingGroup,
  type SousSettingKey,
} from "#core/galley";

import { t } from "../i18n";
import { useServices } from "../ProjectContext";
import { shellKeys } from "../settings";
import { fits, SOUS_GROUPS, sousValues, withSetting, type SousOverrides } from "../sousSettings";
import { Button, Card, IconButton, Input, PanelHeader, Switch } from "./primitives";

const percent = (basisPoints: number): number => basisPoints / 100;

const stepOf = (kind: string): number => {
  if (kind === "share-bp") return 0.01;
  return kind === "decimal" ? 0.1 : 1;
};

const shown = (key: SousSettingKey, value: boolean | number): string => {
  const kind = SOUS_SETTINGS[key].kind;
  if (typeof value === "boolean") return value ? t("on") : t("off");
  if (kind === "share-bp") return `${percent(value).toLocaleString("en")}%`;
  return value.toLocaleString("en");
};

// SAFETY: `SOUS_GROUPS` satisfies `Record<SousSettingGroup, …>`, so its keys are exactly the groups, in the order it declares them.
const GROUPS = Object.keys(SOUS_GROUPS) as readonly SousSettingGroup[];

type SousValues = () => ReturnType<typeof sousValues>;
type SousSet = (setting: SousSettingKey, value: boolean | number | undefined) => void;

interface SousControlProps {
  readonly setting: SousSettingKey;
  readonly values: SousValues;
  readonly onSet: SousSet;
}

function SousNumberBox(props: SousControlProps) {
  const setting = untrack(() => props.setting);
  const spec = SOUS_SETTINGS[setting];
  const share = spec.kind === "share-bp";
  const shownBound = (bound: number | undefined): number | undefined =>
    bound === undefined || !share ? bound : percent(bound);
  const step = stepOf(spec.kind);
  const display = (): number => {
    const value = props.values()[setting];
    if (typeof value !== "number") return 0;
    return share ? percent(value) : value;
  };
  return (
    <span class="flex items-center gap-1">
      <Input
        id={`sous-${setting}`}
        type="number"
        size="sm"
        wrapperClass="w-28"
        class="tabular-nums"
        min={shownBound(spec.min)}
        max={shownBound(spec.max)}
        step={step}
        value={display()}
        onChange={(event) => {
          const typed = Number(event.currentTarget.value);
          const value = share ? Math.round(typed * 100) : typed;
          if (event.currentTarget.value.trim() === "" || !fits(setting, value)) {
            event.currentTarget.value = String(display());
            return;
          }
          props.onSet(setting, value);
        }}
      />
      <Show when={share}>
        <span class="text-small text-on-surface-tertiary">%</span>
      </Show>
    </span>
  );
}

function SousControl(props: SousControlProps) {
  const value = (): boolean | number => props.values()[props.setting];
  return (
    <Show
      when={SOUS_SETTINGS[props.setting].kind === "switch"}
      fallback={<SousNumberBox setting={props.setting} values={props.values} onSet={props.onSet} />}
    >
      <Switch
        id={`sous-${props.setting}`}
        aria-label={t(SOUS_SETTINGS[props.setting].label)}
        checked={value() === true}
        onChange={(next) => props.onSet(props.setting, next)}
      />
    </Show>
  );
}

interface SousGroupSectionProps {
  readonly group: SousSettingGroup;
  readonly values: SousValues;
  readonly changed: (setting: SousSettingKey) => boolean;
  readonly onSet: SousSet;
}

function SousGroupSection(props: SousGroupSectionProps) {
  return (
    <section class="space-y-1" data-sous-group={props.group}>
      <h4 class="text-small font-semibold text-on-surface-primary">
        {t(SOUS_GROUPS[props.group].title)}
      </h4>
      <p class="text-smallest text-on-surface-tertiary">{t(SOUS_GROUPS[props.group].subtitle)}</p>
      <div class="divide-y divide-surface-border">
        <For
          each={SOUS_SETTING_KEYS.filter((setting) => SOUS_SETTINGS[setting].group === props.group)}
        >
          {(setting) => (
            <div class="space-y-2 py-3" data-setting={`sous.${setting}`}>
              <label for={`sous-${setting}`} class="block text-small text-on-surface-primary">
                {t(SOUS_SETTINGS[setting].label)}
                <span class="block text-smallest text-on-surface-tertiary">
                  {t(SOUS_SETTINGS[setting].description)}
                </span>
              </label>
              <div class="flex flex-wrap items-center gap-controls">
                <SousControl setting={setting} values={props.values} onSet={props.onSet} />
                <span class="text-smallest text-on-surface-tertiary">
                  {t("Default: {value}", {
                    value: shown(setting, SOUS_SETTINGS[setting].default),
                  })}
                </span>
                <IconButton
                  label={t("Reset {label} to its default", {
                    label: t(SOUS_SETTINGS[setting].label),
                  })}
                  size="sm"
                  icon={<RotateCcw />}
                  disabled={!props.changed(setting)}
                  onClick={() => props.onSet(setting, undefined)}
                />
              </div>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

export interface SousSettingsPanelProps {
  readonly bare?: boolean;
}

export function SousSettingsPanel(props: SousSettingsPanelProps) {
  const services = useServices();
  const key = shellKeys(services.settings).sousSettings;
  const [overrides, setOverrides] = createSignal<SousOverrides>(services.settings.get(key), {
    name: "sousOverrides",
  });
  const [problem, setProblem] = createSignal("", { name: "sousSettingsProblem" });
  const watching = services.runtime.runFork(
    Stream.runForEach(services.settings.changes(key), (next) =>
      Effect.sync(() => setOverrides(next)),
    ),
  );
  onCleanup(() => {
    Effect.runFork(Fiber.interrupt(watching));
  });

  const values = () => sousValues(overrides());

  const write = (next: SousOverrides): void => {
    void services.run(Effect.result(services.settings.set(key, next))).then((result) => {
      setProblem(
        Result.isFailure(result)
          ? t("{key}: {reason}", { key: result.failure.key, reason: result.failure.reason })
          : "",
      );
    });
  };

  const set = (setting: SousSettingKey, value: boolean | number | undefined): void =>
    write(withSetting(overrides(), setting, value));

  const changed = (setting: SousSettingKey): boolean =>
    values()[setting] !== SOUS_SETTINGS[setting].default;

  return (
    <Dynamic
      component={props.bare === true ? "div" : Card}
      class="space-y-4"
      data-settings-group="proofreading"
    >
      <PanelHeader
        level={3}
        title={t("Proofreading")}
        subtitle={t(
          "What the proofreading checks look for. They compare each place with the rest of this project, so they find what is unusual here, not what is wrong.",
        )}
        actions={
          <Button
            size="sm"
            variant="secondary"
            icon={<RotateCcw />}
            disabled={Object.keys(overrides()).length === 0}
            onClick={() => write({})}
          >
            {t("Reset all")}
          </Button>
        }
      />
      <For each={GROUPS}>
        {(group) => (
          <SousGroupSection group={group} values={values} changed={changed} onSet={set} />
        )}
      </For>
      <Show when={problem() !== ""}>
        <p class="text-small text-on-surface-error">{problem()}</p>
      </Show>
    </Dynamic>
  );
}
