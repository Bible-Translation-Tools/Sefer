import type { Health } from "#core/migrate/check";

import { t } from "../../i18n";

/** "5 ch · 105 v · 2 errors": a Book census row, said in one line. */
export const healthLine = (health: Health): string => {
  const counts = t("{chapters} ch · {verses} v", {
    chapters: health.chapters,
    verses: health.verses,
  });
  const errors = health.diagnostics.errors;
  return errors === 0 ? counts : `${counts} · ${t("{count} errors", { count: errors })}`;
};
