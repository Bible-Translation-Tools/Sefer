/**
 * The empty state: what `/` draws when nothing is installed on this device.
 *
 * A SKELETON of the workspace, and the one place that knows the device is
 * empty — `/` decides, once, and nothing else in the chrome asks. It is built
 * from the real pieces in their ordinary no-project state rather than from
 * look-alikes: the rail already disables what needs an open project, and the
 * sidebar with no project and no recents shows its empty message and the way
 * to the projects page. The main area is deliberately blank.
 *
 * Keeping this skeleton and the real workspace in one shape is a chore, and a
 * known one: when the workspace's layout changes, change this with it.
 */

import { ProjectSidebar } from "./ProjectSidebar";

export function EmptyWorkspace() {
  return (
    <div data-testid="empty-workspace" class="flex h-full">
      <div class="w-80 shrink-0">
        <ProjectSidebar />
      </div>
      <main aria-hidden="true" class="h-full min-w-0 flex-1" />
    </div>
  );
}
