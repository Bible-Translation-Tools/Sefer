/**
 * What a reader can say about a Sous finding that is not a problem, narrowest
 * first. "Fine here" is on the line; the two wider answers sit behind More,
 * each with a line saying what it will do
 * (`planning/items/2026-10-06-project-state-and-suppressions.mdx`).
 *
 *   Fine here                 this text at this place
 *   Always allow "…"          this exact claim anywhere; the check still watches the rest
 *   Turn off this check       the whole check, a proofreading setting
 *
 * Each says so in a toast with Undo.
 */

import { Effect } from "effect";
import CheckCheck from "lucide-solid/icons/check-check";
import Ellipsis from "lucide-solid/icons/ellipsis";
import { Show } from "solid-js";

import type { Finding } from "#core/findings/finding";
import { SOUS_SETTINGS } from "#core/galley";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import { checkSwitchOf, withSetting } from "../../sousSettings";
import { Button, IconButton, Menu, MenuItem, toasts } from "../primitives";

/** Long enough to recognise a word pair; a whole verse quoted in a menu is noise. */
const QUOTE_MAX = 32;

export function SuppressActions(props: { readonly finding: Finding }) {
  const shell = useShell();
  const services = shell.services;

  /** The flagged text, from the book as it is now; quoted in "Always allow". */
  const flagged = (): string => {
    const text = shell.project()?.book(props.finding.bookId)?.source().text ?? "";
    const site = text.slice(props.finding.from, props.finding.to).trim();
    return site.length > QUOTE_MAX ? `${site.slice(0, QUOTE_MAX)}…` : site;
  };

  const check = (): string => SOUS_SETTINGS[checkSwitchOf(props.finding.code) ?? "presence"].label;

  const fineHere = (): void => {
    const id = props.finding.suppression?.here;
    if (id === undefined) return;
    void shell.suppress(props.finding, "here").then(() =>
      toasts.info({
        title: t("Marked fine here"),
        message: t("Hidden on this device. It comes back if this text changes."),
        action: { label: t("Undo"), onPress: () => void shell.unsuppress(id) },
      }),
    );
  };

  const allow = (): void => {
    const id = props.finding.suppression?.everywhere;
    if (id === undefined) return;
    const quoted = flagged();
    void shell.suppress(props.finding, "everywhere").then(() =>
      toasts.info({
        title: t("Always allowing “{text}”", { text: quoted }),
        message: t("In this project, on this device."),
        action: { label: t("Undo"), onPress: () => void shell.unsuppress(id) },
      }),
    );
  };

  const turnOff = (): void => {
    const setting = checkSwitchOf(props.finding.code);
    if (setting === undefined) return;
    const key = shellKeys(services.settings).sousSettings;
    const before = services.settings.get(key);
    const label = SOUS_SETTINGS[setting].label;
    void services.run(
      Effect.ignore(services.settings.set(key, withSetting(before, setting, false))),
    );
    toasts.info({
      title: t("Turned off “{check}”", { check: label }),
      message: t("For every project. Turn it back on in the proofreading settings."),
      action: {
        label: t("Undo"),
        onPress: () => void services.run(Effect.ignore(services.settings.set(key, before))),
      },
    });
  };

  const bringBack = (): void => {
    const keys = props.finding.suppression;
    const rung = shell.suppressedBy(props.finding);
    const id = rung === "here" ? keys?.here : keys?.everywhere;
    if (rung === undefined || id === undefined) return;
    void shell.unsuppress(id).then(() =>
      toasts.info({
        title: rung === "here" ? t("Shown again") : t("No longer always allowed"),
        action: { label: t("Undo"), onPress: () => void shell.suppress(props.finding, rung) },
      }),
    );
  };

  /** On a finding the reader already hid: one door back, saying what it undoes. */
  const hidden = () => shell.suppressedBy(props.finding);

  return (
    <Show
      when={hidden() === undefined}
      fallback={
        <Button
          size="sm"
          variant="tertiary"
          title={
            hidden() === "everywhere"
              ? t("Allowed everywhere in this project: bringing it back shows every one.")
              : t("Marked fine here.")
          }
          onClick={bringBack}
        >
          {hidden() === "everywhere" ? t("Stop allowing") : t("Show again")}
        </Button>
      }
    >
      <Show when={props.finding.suppression}>
        {(keys) => (
          <>
            <Button
              size="sm"
              variant="tertiary"
              icon={<CheckCheck />}
              data-tour="fine-here"
              title={t("Hide this one. It comes back if this text changes.")}
              onClick={fineHere}
            >
              {t("Fine here")}
            </Button>
            <Show
              when={
                keys().everywhere !== undefined || checkSwitchOf(props.finding.code) !== undefined
              }
            >
              <Menu
                label={t("More ways to answer this finding")}
                side="bottom"
                align="end"
                class="w-80"
                trigger={
                  <IconButton
                    label={t("More")}
                    size="sm"
                    icon={<Ellipsis />}
                    data-tour="finding-more"
                  />
                }
              >
                <Show when={keys().everywhere !== undefined}>
                  <MenuItem onSelect={allow}>
                    <span class="flex flex-col gap-0.5">
                      <span>{t("Always allow “{text}”", { text: flagged() })}</span>
                      <span class="text-smallest font-normal text-on-surface-tertiary">
                        {t(
                          "Never flag this in this project. Other “{check}” findings still show.",
                          {
                            check: check(),
                          },
                        )}
                      </span>
                    </span>
                  </MenuItem>
                </Show>
                <Show when={checkSwitchOf(props.finding.code) !== undefined}>
                  <MenuItem onSelect={turnOff}>
                    <span class="flex flex-col gap-0.5">
                      <span>{t("Turn off “{check}”", { check: check() })}</span>
                      <span class="text-smallest font-normal text-on-surface-tertiary">
                        {t(
                          "Stop this check in every project. Turn it back on in the proofreading settings.",
                        )}
                      </span>
                    </span>
                  </MenuItem>
                </Show>
              </Menu>
            </Show>
          </>
        )}
      </Show>
    </Show>
  );
}
