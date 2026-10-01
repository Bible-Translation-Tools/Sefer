/**
 * The Proofreading card in Settings: every Sous setting, generated from
 * kitchen's list (`SOUS_SETTINGS`).
 *
 *   Checks
 *     What a mark touches
 *     Flags a punctuation mark or digit right next to something it is rarely…
 *     [on]  Default: on  [reset]
 *
 * Grouped by kitchen's `group`, and each row is kitchen's label, its one plain
 * sentence ABOVE the control (written for readers who are not linguists), the
 * control its `kind` calls for, the default, and a reset. Sefer writes no copy
 * for a setting: one kitchen adds appears here with its own words.
 *
 * A write stores the change in Settings; `ProjectContext` hears it, hands the
 * engine the whole set and re-judges the project once.
 */

import { Dynamic } from "@solidjs/web";
import { Effect, Fiber, Result, Stream } from "effect";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import { For, Show, createSignal, onCleanup } from "solid-js";

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

/** A share is stored out of 10,000 and shown as a percent. */
const percent = (bp: number): number => bp / 100;

/** How a value reads beside "Default:". */
const shown = (key: SousSettingKey, value: boolean | number): string => {
  const kind = SOUS_SETTINGS[key].kind;
  if (typeof value === "boolean") return value ? t("on") : t("off");
  if (kind === "share-bp") return `${percent(value).toLocaleString("en")}%`;
  return value.toLocaleString("en");
};

// SAFETY: `SOUS_GROUPS` satisfies `Record<SousSettingGroup, …>`, so its keys
// are exactly the groups, in the order it declares them.
const GROUPS = Object.keys(SOUS_GROUPS) as readonly SousSettingGroup[];

export interface SousSettingsPanelProps {
  /** Inside a dialog (Findings' settings): no card around it, the dialog is one. */
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

  /** A number box that commits on change, and snaps back when the value does not fit. */
  const numberBox = (setting: SousSettingKey) => {
    const spec = SOUS_SETTINGS[setting];
    const share = spec.kind === "share-bp";
    const display = (): number => {
      const value = values()[setting];
      return typeof value === "number" ? (share ? percent(value) : value) : 0;
    };
    return (
      <span class="flex items-center gap-1">
        <Input
          id={`sous-${setting}`}
          type="number"
          size="sm"
          wrapperClass="w-28"
          class="tabular-nums"
          min={spec.min === undefined ? undefined : share ? percent(spec.min) : spec.min}
          max={spec.max === undefined ? undefined : share ? percent(spec.max) : spec.max}
          step={share ? 0.01 : spec.kind === "decimal" ? 0.1 : 1}
          value={display()}
          onChange={(event) => {
            const typed = Number(event.currentTarget.value);
            const value = share ? Math.round(typed * 100) : typed;
            if (event.currentTarget.value.trim() === "" || !fits(setting, value)) {
              event.currentTarget.value = String(display());
              return;
            }
            set(setting, value);
          }}
        />
        <Show when={share}>
          <span class="text-small text-on-surface-tertiary">%</span>
        </Show>
      </span>
    );
  };

  const control = (setting: SousSettingKey) => {
    const value = (): boolean | number => values()[setting];
    return SOUS_SETTINGS[setting].kind === "switch" ? (
      <Switch
        id={`sous-${setting}`}
        aria-label={t(SOUS_SETTINGS[setting].label)}
        checked={value() === true}
        onChange={(next) => set(setting, next)}
      />
    ) : (
      numberBox(setting)
    );
  };

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
          <section class="space-y-1" data-sous-group={group}>
            <h4 class="text-small font-semibold text-on-surface-primary">
              {t(SOUS_GROUPS[group].title)}
            </h4>
            <p class="text-smallest text-on-surface-tertiary">{t(SOUS_GROUPS[group].subtitle)}</p>
            <div class="divide-y divide-surface-border">
              <For
                each={SOUS_SETTING_KEYS.filter((setting) => SOUS_SETTINGS[setting].group === group)}
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
                      {control(setting)}
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
                        disabled={!changed(setting)}
                        onClick={() => set(setting, undefined)}
                      />
                    </div>
                  </div>
                )}
              </For>
            </div>
          </section>
        )}
      </For>
      <Show when={problem() !== ""}>
        <p class="text-small text-on-surface-error">{problem()}</p>
      </Show>
    </Dynamic>
  );
}
