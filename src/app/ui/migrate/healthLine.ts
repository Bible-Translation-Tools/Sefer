import type { Health } from "#core/migrate/check";

import { t } from "../../i18n";

export const healthLine = (health: Health): string => {
  const counts = t("{chapters} ch · {verses} v", {
    chapters: health.chapters,
    verses: health.verses,
  });
  const errors = health.diagnostics.errors;
  return errors === 0 ? counts : `${counts} · ${t("{count} errors", { count: errors })}`;
};
