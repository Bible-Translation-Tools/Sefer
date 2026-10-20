import type { Book } from "@sefer/text/book";
import { Option, Result } from "effect";

import {
  currentProjectSource,
  folderSource,
  recordedSource,
  savedSource,
  sharedSource,
  type CompareSource,
  type RecordedTexts,
} from "#core/compare";
import type { Project } from "#core/project/project";
import type { Baseline } from "#core/save/baseline";

import { t } from "../../i18n";
import type { Services } from "../../services";

export interface SourceChoice {
  readonly id: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly explainer: string;
  readonly available: boolean;
  readonly immediate?: () => CompareSource | undefined;
  readonly pick?: () => Promise<CompareSource | undefined>;
}

const scratchRoot = (services: Services): string => `${services.hostInfo.paths().temp}/review`;

export interface ChoiceContext {
  readonly services: Services;
  readonly project: Project | undefined;
  readonly baselineOf: (book: Book) => Option.Option<Baseline>;
  readonly recorded: RecordedTexts;
  readonly shared: RecordedTexts;
  readonly sharedLabel?: string | undefined;
  readonly sharedExplainer?: string | undefined;
  readonly writer?: { readonly texts: RecordedTexts; readonly label: string } | undefined;
}

export const sourceChoices = (context: ChoiceContext): readonly SourceChoice[] => {
  const { services, project } = context;
  const web = services.hostInfo.kind() === "web";
  const capabilities = services.hostInfo.capabilities();
  const nativeFolder = capabilities.nativeDisk && capabilities.dialogs;

  return [
    {
      id: "project",
      label: t("In the editor"),
      shortLabel: t("the editor"),
      explainer:
        project === undefined
          ? t("No project is open.")
          : t("The books as they are right now, including unsaved edits."),
      available: project !== undefined,
      immediate: () =>
        project === undefined
          ? undefined
          : currentProjectSource(project, {
              label: t("In the editor"),
              edits: (before, after) => {
                const found = services.galley.mergeSplices(before, after, new Map(), "current");
                return Result.isSuccess(found) ? found.success : undefined;
              },
            }),
    },
    {
      id: "disk",
      label: t("On disk"),
      shortLabel: t("the file"),
      explainer: t("The bytes in the project's files — what was loaded, or last recorded."),
      available: project !== undefined,
      immediate: () =>
        project === undefined ? undefined : savedSource(project, context.baselineOf, t("On disk")),
    },
    {
      id: "recorded",
      label: t("The last recorded version"),
      shortLabel: t("the last version"),
      explainer:
        context.recorded.head === undefined
          ? t("Nothing has been recorded in this project yet.")
          : t("The books as the last commit holds them."),
      available: project !== undefined && context.recorded.head !== undefined,
      immediate: () =>
        project === undefined ? undefined : recordedSource(context.recorded, t("Last recorded")),
    },
    {
      id: "shared",
      label: context.sharedLabel ?? t("The shared project"),
      shortLabel: context.sharedLabel?.toLowerCase() ?? t("the shared project"),
      explainer:
        context.shared.head === undefined
          ? t("Nothing has been received from a shared project yet.")
          : (context.sharedExplainer ??
            t("The shared project's newest version, as the last check brought it here.")),
      available: project !== undefined && context.shared.head !== undefined,
      immediate: () =>
        project === undefined
          ? undefined
          : sharedSource(context.shared, context.sharedLabel ?? t("The shared project")),
    },
    {
      id: "writer",
      label: context.writer?.label ?? t("From Writer"),
      shortLabel: t("Writer"),
      explainer:
        context.writer === undefined
          ? t("No Writer project this project follows has new work.")
          : t("New saves in Writer, in the verses they changed since this project took them."),
      available: project !== undefined && context.writer !== undefined,
      immediate: () =>
        project === undefined || context.writer === undefined
          ? undefined
          : sharedSource(context.writer.texts, context.writer.label),
    },
    {
      id: "zip",
      label: t("A zip"),
      shortLabel: t("the zip"),
      explainer: web
        ? t("A .zip somebody shared. It is unpacked here, in the page, and only read.")
        : t("This host opens folders directly; unzip it first."),
      available: web,
      pick: async () => {
        const intake = await import("#platform/web/intake");
        const taken = await services.run(
          intake.pickInto(services.fileSystem, scratchRoot(services), "zip"),
        );
        return taken === undefined
          ? undefined
          : folderSource(services.fileSystem, taken.root, taken.name);
      },
    },
    {
      id: "folder",
      label: t("A folder"),
      shortLabel: t("the folder"),
      explainer: nativeFolder
        ? t("Any folder of books on this disk. It is only read.")
        : t("The browser copies the folder's files in so Sefer can read them."),
      available: true,
      pick: async () => {
        if (nativeFolder) {
          const picked = await services.run(
            services.dialogs.pickFolder(t("Select a folder to compare")),
          );
          const root = Option.getOrUndefined(picked);
          return root === undefined ? undefined : folderSource(services.fileSystem, root);
        }
        const intake = await import("#platform/web/intake");
        const taken = await services.run(
          intake.pickInto(services.fileSystem, scratchRoot(services), "folder"),
        );
        return taken === undefined
          ? undefined
          : folderSource(services.fileSystem, taken.root, taken.name);
      },
    },
  ];
};
