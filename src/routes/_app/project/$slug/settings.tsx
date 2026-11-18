import { createFileRoute } from "@tanstack/solid-router";

import { m } from "#app/paraglide/messages";
import { SettingsPage, settingsSearch } from "#app/ui/settings/SettingsPage";
import { ShellGate } from "#app/ui/ShellGate";

/** Settings with a project open: its own cards show too. `/settings` is the same page without one. */
export const Route = createFileRoute("/_app/project/$slug/settings")({
  validateSearch: settingsSearch,
  head: () => ({ meta: [{ title: m.page_title({ page: m.common_settings() }) }] }),
  component: () => {
    const search = Route.useSearch();
    return <ShellGate>{() => <SettingsPage tab={search().tab} />}</ShellGate>;
  },
});
