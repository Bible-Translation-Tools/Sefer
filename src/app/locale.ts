import { createSignal } from "solid-js";

import {
  baseLocale,
  getTextDirection,
  isLocale,
  locales,
  overwriteGetLocale,
  type Locale,
} from "./paraglide/runtime";

/**
 * The interface language: which catalog `m.*` reads, `<html lang dir>`, and
 * the locale every `Intl` formatter is given. One Solid signal, so a change
 * is a remount of the screens under `LocaleScope`, never a page reload: the
 * open project, its books and their undo history live outside that scope
 * (Will, 2026-10-22: "don't want to lose undo history cause someone decided
 * to change a lang or accidentally did").
 *
 * The setting (`ui.locale`) holds a locale tag or "" for automatic: the best
 * match for the browser's languages, else English. A tag Sefer has no catalog
 * for counts as automatic.
 */

/** The first of `preferred` Sefer has a catalog for, by full tag and then by language (`es-MX` → `es`). */
const bestLocale = (preferred: readonly string[]): Locale => {
  for (const tag of preferred) if (isLocale(tag)) return tag;
  for (const tag of preferred) {
    const language = tag.split("-")[0]?.toLowerCase();
    if (isLocale(language)) return language;
  }
  return baseLocale;
};

const browserLocale = (): Locale =>
  bestLocale(globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? baseLocale]);

const initial = browserLocale();
const [current, setCurrent] = createSignal<Locale>(initial, { name: "uiLocale" });

/** The interface language now. Pass it to every `Intl` formatter and `toLocale…` call. */
export const uiLocale = current;

// Paraglide calls this from inside each `m.*` call, which runs in JSX or a
// tracked scope, so the read is tracked where it matters.
// oxlint-disable-next-line solid/reactivity
overwriteGetLocale(current);

/** What the setting resolves to: a supported tag as is, anything else as automatic. */
const resolveLocale = (setting: string): Locale => (isLocale(setting) ? setting : browserLocale());

/** The automatic choice, for the setting's own label: "Automatic (Español)". */
export const automaticLocale = browserLocale;

const markDocument = (locale: Locale): void => {
  const root = globalThis.document?.documentElement;
  if (root === undefined) return;
  root.lang = locale;
  root.dir = getTextDirection(locale);
};

markDocument(initial);

/** Applies a setting value: the signal, then `<html lang dir>`. Call it from an effect or a handler, never a component body. */
export const applyLocale = (setting: string): void => {
  const next = resolveLocale(setting);
  setCurrent(next);
  markDocument(next);
};

/** Every language Sefer ships, each named in itself ("Español", "فارسی"). */
export const shippedLocales = (): readonly { readonly tag: Locale; readonly name: string }[] =>
  locales.map((tag) => ({ tag, name: nativeName(tag) }));

export const nativeName = (tag: string): string => {
  try {
    const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? tag;
    return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
  } catch {
    return tag;
  }
};
