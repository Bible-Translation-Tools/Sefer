/** Text in several languages, keyed by locale (`en`, `es-419`). */
export type LocalizedText = Readonly<Record<string, string>>;

/**
 * A localized string, in the first locale that has one.
 *
 * `preferred` is tried in order — the reader's locale, then the project's — and
 * a locale matches on its language subtag too, so a reader on `en-GB` still
 * gets the `en` name. The last resort is any value at all: "a name in some
 * language" beats "no name".
 */
export const localized = (
  values: LocalizedText | undefined,
  preferred: readonly (string | undefined)[],
): string => {
  if (values === undefined) return "";
  for (const locale of preferred) {
    if (locale === undefined || locale === "") continue;
    const exact = values[locale];
    if (exact !== undefined && exact !== "") return exact;
    const base = locale.split("-")[0] ?? "";
    const loose = base === "" ? undefined : values[base];
    if (loose !== undefined && loose !== "") return loose;
  }
  for (const value of Object.values(values)) if (value !== "") return value;
  return "";
};
