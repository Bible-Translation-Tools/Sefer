import { Effect } from "effect";

import { m } from "#app/paraglide/messages";
import type { Finding } from "#core/findings/finding";
import { SOUS_SETTINGS } from "#core/galley";

import type { Shell } from "./ProjectContext";
import { shellKeys } from "./settings";
import { checkSwitchOf, withSetting } from "./sousSettings";
import { toasts } from "./ui/primitives";

const QUOTE_MAX = 32;

const unsaved = (): void => {
  toasts.error({
    title: m.findings_could_not_save_that(),
    message: m.findings_this_projects_list_of_findings(),
  });
};

export const flaggedText = (shell: Shell, finding: Finding): string => {
  const text = shell.project()?.book(finding.bookId)?.source().text ?? "";
  const site = text.slice(finding.from, finding.to).trim();
  return site.length > QUOTE_MAX ? `${site.slice(0, QUOTE_MAX)}…` : site;
};

export const checkLabel = (finding: Finding): string | undefined => {
  const setting = checkSwitchOf(finding.code);
  return setting === undefined ? undefined : SOUS_SETTINGS[setting].label;
};

export const fineHere = (shell: Shell, finding: Finding): void => {
  const id = finding.suppression?.here;
  if (id === undefined) return;
  void shell.suppress(finding, "here").then((saved) =>
    !saved
      ? unsaved()
      : toasts.info({
          title: m.findings_marked_fine_here(),
          message: m.findings_hidden_on_this_device_it(),
          action: { label: m.common_undo(), onPress: () => void shell.unsuppress(id) },
        }),
  );
};

export const allow = (shell: Shell, finding: Finding): void => {
  const id = finding.suppression?.everywhere;
  if (id === undefined) return;
  const quoted = flaggedText(shell, finding);
  void shell.suppress(finding, "everywhere").then((saved) =>
    !saved
      ? unsaved()
      : toasts.info({
          title: m.findings_always_allowing_text({ text: quoted }),
          message: m.findings_in_this_project_on_this(),
          action: { label: m.common_undo(), onPress: () => void shell.unsuppress(id) },
        }),
  );
};

export const turnOff = (shell: Shell, finding: Finding): void => {
  const services = shell.services;
  const setting = checkSwitchOf(finding.code);
  if (setting === undefined) return;
  const key = shellKeys(services.settings).sousSettings;
  const before = services.settings.get(key);
  void services.run(Effect.ignore(services.settings.set(key, withSetting(before, setting, false))));
  toasts.info({
    title: m.findings_turned_off_check({ check: SOUS_SETTINGS[setting].label }),
    message: m.findings_for_every_project_turn_it(),
    action: {
      label: m.common_undo(),
      onPress: () => void services.run(Effect.ignore(services.settings.set(key, before))),
    },
  });
};

export const bringBack = (shell: Shell, finding: Finding): void => {
  const keys = finding.suppression;
  const rung = shell.suppressedBy(finding);
  if (keys === undefined || rung === undefined) return;
  const ids = [keys.here, ...(keys.everywhere === undefined ? [] : [keys.everywhere])];
  void ids
    .reduce<Promise<boolean>>(
      (done, id) => done.then((ok) => (ok ? shell.unsuppress(id) : false)),
      Promise.resolve(true),
    )
    .then((saved) =>
      !saved
        ? unsaved()
        : toasts.info({
            title:
              rung === "here" ? m.findings_shown_again() : m.findings_no_longer_always_allowed(),
            action: { label: m.common_undo(), onPress: () => void shell.suppress(finding, rung) },
          }),
    );
};
