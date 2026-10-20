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
