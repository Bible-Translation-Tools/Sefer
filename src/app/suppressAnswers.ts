/**
 * The three answers to a Sous finding, and taking one back: the same from a
 * Findings card (`ui/panels/SuppressActions.tsx`) and from the editor's popup
 * (`ui/BookEditor.tsx`). Each says what it did in a toast with Undo.
 *
 *   fineHere      this text at this place
 *   allow         this exact claim anywhere in the project
 *   turnOff       the whole check, a proofreading setting (every project)
 */

import { Effect } from "effect";

import type { Finding } from "#core/findings/finding";
import { SOUS_SETTINGS } from "#core/galley";

import { t } from "./i18n";
import type { Shell } from "./ProjectContext";
import { shellKeys } from "./settings";
import { checkSwitchOf, withSetting } from "./sousSettings";
import { toasts } from "./ui/primitives";

/** Long enough to recognise a word pair; a whole verse quoted in a menu is noise. */
const QUOTE_MAX = 32;

/** The file could not be read when the project opened, so nothing is saved over it. */
const unsaved = (): void => {
  toasts.error({
    title: t("Could not save that"),
    message: t(
      "This project's list of findings marked fine could not be read, so Sefer leaves it alone rather than replace it.",
    ),
  });
};

/** The flagged text, from the book as it is now; quoted in "Always allow". */
export const flaggedText = (shell: Shell, finding: Finding): string => {
  const text = shell.project()?.book(finding.bookId)?.source().text ?? "";
  const site = text.slice(finding.from, finding.to).trim();
  return site.length > QUOTE_MAX ? `${site.slice(0, QUOTE_MAX)}…` : site;
};

/** The check a finding came from, as the proofreading settings name it. */
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
          title: t("Marked fine here"),
          message: t("Hidden on this device. It comes back if this text changes."),
          action: { label: t("Undo"), onPress: () => void shell.unsuppress(id) },
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
          title: t("Always allowing “{text}”", { text: quoted }),
          message: t("In this project, on this device."),
          action: { label: t("Undo"), onPress: () => void shell.unsuppress(id) },
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
    title: t("Turned off “{check}”", { check: SOUS_SETTINGS[setting].label }),
    message: t("For every project. Turn it back on in the proofreading settings."),
    action: {
      label: t("Undo"),
      onPress: () => void services.run(Effect.ignore(services.settings.set(key, before))),
    },
  });
};

/** Takes back whichever rungs hide a finding: one hidden here AND allowed everywhere needs both. */
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
            title: rung === "here" ? t("Shown again") : t("No longer always allowed"),
            action: { label: t("Undo"), onPress: () => void shell.suppress(finding, rung) },
          }),
    );
};
