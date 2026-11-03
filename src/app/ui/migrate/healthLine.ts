import { m } from "#app/paraglide/messages";
import type { Health } from "#core/migrate/check";

export const healthLine = (health: Health): string => {
  const counts = m.migrate_chapters_ch_verses_v({
    chapters: health.chapters,
    verses: health.verses,
  });
  const errors = health.diagnostics.errors;
  return errors === 0 ? counts : `${counts} · ${m.migrate_count_errors({ count: errors })}`;
};
