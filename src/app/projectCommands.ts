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

const ZIP_FILTERS = [{ name: "Zip archive", extensions: ["zip"] }] as const;

export const exportProjectZip = async (services: Services, root: string): Promise<void> => {
  const name = lastSegment(root) || "project";
  const fileName = `${name}.zip`;

  const destination = services.hostInfo.capabilities().nativeDisk
    ? await services.run(
        services.dialogs.pickSaveFile(t("Save {name}", { name: fileName }), fileName, ZIP_FILTERS),
      )
    : Option.none<string>();
  if (services.hostInfo.capabilities().nativeDisk && Option.isNone(destination)) return;

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
  readonly root: () => string | undefined;
  readonly ask: (root: string) => void;
}

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
