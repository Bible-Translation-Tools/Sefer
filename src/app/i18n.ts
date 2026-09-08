/**
 * Localization, as the one function every shell string goes through.
 *
 * `t` is deliberately an identity with interpolation: the point today is the
 * SEAM, not a catalogue. Every user-visible string in `src/app` and
 * `src/routes` is already wrapped, so switching to Lingui later is a build
 * step and a catalogue extraction rather than a sweep of every component.
 *
 * Why not just template literals: an extractor cannot find a message that was
 * assembled by concatenation, and a translator cannot reorder its parts. So
 * the message is always one literal with named `{placeholders}`, and the
 * values arrive separately.
 *
 * TODO(seam): replace the body with Lingui's `i18n._()` and load a catalogue
 * chosen from `HostInfo.locale()`. The signature below is the one Lingui's
 * macro produces, so callers do not change.
 */

export type Params = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * The message, with `{name}` replaced by `params.name`.
 *
 * An unknown placeholder is left verbatim rather than blanked: a visible
 * `{count}` in the UI is a bug report, and an empty string hides it.
 */
export const t = (message: string, params?: Params): string => {
  if (params === undefined) return message;
  return message.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
};
