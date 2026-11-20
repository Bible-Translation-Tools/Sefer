import { createFileRoute } from "@tanstack/solid-router";

import { m } from "#app/paraglide/messages";
import { SettingsPage, settingsSearch } from "#app/ui/settings/SettingsPage";
import { ShellGate } from "#app/ui/ShellGate";

/**
 * Settings with no project open (Will, 2026-11-18): the preferences are this
 * device's, so reaching them must not need a project. With one open, Settings
 * is `/project/$slug/settings`.
 */
export const Route = createFileRoute("/_app/settings")({
  validateSearch: settingsSearch,
  head: () => ({ meta: [{ title: m.page_title({ page: m.common_settings() }) }] }),
  component: () => {
    const search = Route.useSearch();
    return <ShellGate>{() => <SettingsPage tab={search().tab} />}</ShellGate>;
  },
});
