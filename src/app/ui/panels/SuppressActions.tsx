import CheckCheck from "lucide-solid/icons/check-check";
import Ellipsis from "lucide-solid/icons/ellipsis";
import { Show } from "solid-js";

import type { Finding } from "#core/findings/finding";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { checkSwitchOf } from "../../sousSettings";
import {
  allow,
  bringBack,
  checkLabel,
  fineHere,
  flaggedText,
  turnOff,
} from "../../suppressAnswers";
import { Button, IconButton, Menu, MenuItem } from "../primitives";

export function SuppressActions(props: { readonly finding: Finding }) {
  const shell = useShell();

  const flagged = (): string => flaggedText(shell, props.finding);
  const check = (): string => checkLabel(props.finding) ?? "";

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
          onClick={() => bringBack(shell, props.finding)}
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
              onClick={() => fineHere(shell, props.finding)}
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
                  <MenuItem
                    onSelect={() => allow(shell, props.finding)}
                    data-testid="suppress-allow"
                  >
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
                  <MenuItem
                    onSelect={() => turnOff(shell, props.finding)}
                    data-testid="suppress-turn-off"
                  >
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
