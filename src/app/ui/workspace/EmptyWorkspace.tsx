/**
 * The first-run shell's main area: deliberately empty.
 *
 * Shown on `/` only when nothing is installed on this device
 * (`shell.firstRun`). Everything right of the sidebar is hidden; the one live
 * control is the sidebar's project button, and the rail and sidebar read the
 * same flag to grey themselves out.
 */

export function EmptyWorkspace() {
  return <main data-testid="empty-workspace" aria-hidden="true" class="h-full" />;
}
