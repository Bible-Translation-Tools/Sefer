/**
 * Two more verbs for the registry: save a copy of this project, and rename it.
 *
 * A separate file from `commands.ts` on purpose. The core set is registered
 * once, by the shell, against a `ShellBridge` of what every command may reach;
 * these two need something that is not on that list — a place to put a file the
 * person can find, and a way to ask for a name — so they take their own bridge
 * and register through the same open API (`registerCommand`, which returns its
 * own unregister). Nothing here is a second registry.
 *
 * Where it must be called from: today `YourProjects` calls it while the landing
 * is mounted, because the landing is what owns the rename dialog the command
 * opens. Its permanent home is `makeShell` in `src/app/ProjectContext.tsx`,
 * beside `onCleanup(registerShellCommands(bridge))` — at which point `ask` is
 * whatever surface the shell wants to raise for a name.
 *
 * The plain functions are exported beside the commands so a button does not
 * have to go through the palette to do the same thing: the kebab in the
 * projects table calls `exportProjectZip` directly.
 */

import { Effect, Result } from "effect";

import { registerCommand } from "./commands";
import { t } from "./i18n";
import type { Services } from "./services";
import { downloadBytes } from "./ui/landing/download";
import { rememberProject } from "./ui/landing/summaries";
import { toasts } from "./ui/primitives";

const lastSegment = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** An `AdminError` as one line, without leaning on `Error.message`. */
const describe = (failure: { readonly reason: string; readonly description?: string }): string =>
  failure.description ?? failure.reason;

/**
 * Saves the project at `root` as a zip.
 *
 * On the Web host that means a download: OPFS is Sefer's own storage, nothing
 * outside the page can see it, and the `Dialogs` port has no save picker to
 * name a real path with. On a host that HAS one, this is where
 * `ProjectAdmin.export(root, "usfm-zip", picked)` belongs instead — the bytes
 * are the same either way, and `archive` is the half both share.
 */
export const exportProjectZip = async (services: Services, root: string): Promise<void> => {
  const name = lastSegment(root) || "project";
  const notice = toasts.progress({ title: t("Preparing {name}", { name }) });
  const made = await services.run(Effect.result(services.admin.archive(root)));
  if (Result.isFailure(made)) {
    toasts.update(notice, {
      title: t("Could not export {name}", { name }),
      message: describe(made.failure),
      tone: "error",
      autoClose: false,
    });
    return;
  }
  downloadBytes(`${name}.zip`, made.success);
  toasts.update(notice, {
    title: t("Exported {name}", { name }),
    message: t("{size} KB", { size: Math.max(1, Math.round(made.success.length / 1024)) }),
    tone: "success",
  });
};

/**
 * Renames the project as people see it, and tells the index.
 *
 * `ProjectAdmin.rename` rewrites the burrito's `identification.name` (or
 * `.sefer/project.json` when there is no burrito) and does NOT move the
 * folder, so `shell.recentProjects` — which is keyed by root — has nothing to
 * correct. The index does: it is where the name in the projects table comes
 * from, and it is re-read rather than patched because a burrito rename may
 * land in a different locale than the one we displayed.
 */
export const renameProject = async (
  services: Services,
  root: string,
  name: string,
  lastOpened?: string,
): Promise<boolean> => {
  const done = await services.run(
    Effect.result(
      Effect.gen(function* () {
        yield* services.admin.rename(root, name);
        yield* rememberProject(services.projectsRoot, root, lastOpened);
      }),
    ),
  );
  if (Result.isFailure(done)) {
    toasts.error({ title: t("Could not rename"), message: describe(done.failure) });
    return false;
  }
  toasts.success({ title: t("Renamed to {name}", { name }) });
  return true;
};

export interface ProjectCommandsBridge {
  readonly services: Services;
  /** The open project's root, or undefined — both commands act on it. */
  readonly root: () => string | undefined;
  /** Raises whatever asks for a new name; the landing opens its dialog. */
  readonly ask: (root: string) => void;
}

/** Registers `project.export` and `project.rename`; returns the unregister. */
export const registerProjectCommands = (bridge: ProjectCommandsBridge): (() => void) => {
  const open = (): boolean => bridge.root() !== undefined;
  const unregister = [
    registerCommand({
      id: "project.export",
      title: t("Export project as zip"),
      when: open,
      run: () => {
        const root = bridge.root();
        if (root === undefined) return;
        return exportProjectZip(bridge.services, root);
      },
    }),
    registerCommand({
      id: "project.rename",
      title: t("Rename project…"),
      when: open,
      run: () => {
        const root = bridge.root();
        if (root !== undefined) bridge.ask(root);
      },
    }),
  ];
  return () => {
    for (const off of unregister) off();
  };
};
