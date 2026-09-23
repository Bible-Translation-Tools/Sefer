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

import { Effect, Option, Result } from "effect";

import type { AdminError } from "#core/admin/projectAdmin";
import { lastSegment } from "#core/fileSystem/path";

import { registerCommand } from "./commands";
import { describe } from "./describe";
import { t } from "./i18n";
import { noteRenamed } from "./projectNames";
import type { Services } from "./services";
import { downloadBytes } from "./ui/landing/download";
import { rememberProject } from "./ui/landing/summaries";
import { toasts } from "./ui/primitives";

/** The one filter list both hosts show for a project archive. */
const ZIP_FILTERS = [{ name: "Zip archive", extensions: ["zip"] }] as const;

/**
 * Saves the project at `root` as a zip.
 *
 * Two endings, one set of bytes. On a host with real disk the person names a
 * file and `ProjectAdmin.export(root, "usfm-zip", picked)` writes it through
 * the `FileSystem` port — the same atomic write everything else uses. On the
 * Web the bytes go to a download instead: OPFS is Sefer's own storage, nothing
 * outside the page can see it, and `Dialogs.pickSaveFile` answers `None`
 * because a browser has no path to give back.
 *
 * `capabilities().nativeDisk` picks between them, not a host name — the
 * question is "can a file be put somewhere the person will find it", and that
 * is what the capability means.
 */
export const exportProjectZip = async (services: Services, root: string): Promise<void> => {
  const name = lastSegment(root) || "project";
  const fileName = `${name}.zip`;

  // Asked BEFORE the archive is built, deliberately: a cancelled dialog should
  // not have cost a zip of the whole project first.
  const destination = services.hostInfo.capabilities().nativeDisk
    ? await services.run(
        services.dialogs.pickSaveFile(t("Save {name}", { name: fileName }), fileName, ZIP_FILTERS),
      )
    : Option.none<string>();
  if (services.hostInfo.capabilities().nativeDisk && Option.isNone(destination)) return;

  // One job, two shapes of answer: `export` returns the path it wrote,
  // `archive` returns the bytes that still need a home.
  const job: Effect.Effect<string | Uint8Array, AdminError> = Option.isNone(destination)
    ? services.admin.archive(root)
    : services.admin.export(root, "usfm-zip", destination.value);

  const notice = toasts.progress({ title: t("Preparing {name}", { name }) });
  const written = await services.run(Effect.result(job));
  if (Result.isFailure(written)) {
    toasts.update(notice, {
      title: t("Could not export {name}", { name }),
      message: describe(written.failure),
      tone: "error",
      autoClose: false,
    });
    return;
  }

  // `export` answers the path it wrote; `archive` answers the bytes, which
  // still have to be handed somewhere the person can reach them.
  if (typeof written.success === "string") {
    toasts.update(notice, {
      title: t("Exported {name}", { name }),
      message: written.success,
      tone: "success",
    });
    return;
  }
  downloadBytes(fileName, written.success);
  toasts.update(notice, {
    title: t("Exported {name}", { name }),
    message: t("{size} KB", { size: Math.max(1, Math.round(written.success.length / 1024)) }),
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
 *
 * `noteRenamed` is the third reader, and without it a rename would show a
 * green toast and change nothing on screen: the OPEN project holds the
 * metadata it decoded when it was opened, and nothing re-reads a burrito
 * mid-session. The overlay makes the sidebar header move with the table.
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
  noteRenamed(root, name);
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
