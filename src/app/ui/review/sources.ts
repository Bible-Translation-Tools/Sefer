import type { Book } from "@wycliffeassociates/sefer-text/book";
import { Option, Result } from "effect";

import { m } from "#app/paraglide/messages";
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

const projectChoice = ({ services, project }: ChoiceContext): SourceChoice => ({
  id: "project",
  label: m.review_in_the_editor(),
  shortLabel: m.review_the_editor(),
  explainer:
    project === undefined ? m.common_no_project_is_open() : m.review_the_books_as_they_are(),
  available: project !== undefined,
  immediate: () =>
    project === undefined
      ? undefined
      : currentProjectSource(project, {
          label: m.review_in_the_editor(),
          edits: (before, after) => {
            const found = services.galley.mergeSplices(before, after, new Map(), "current");
            return Result.isSuccess(found) ? found.success : undefined;
          },
        }),
});

const diskChoice = (context: ChoiceContext): SourceChoice => {
  const { project } = context;
  return {
    id: "disk",
    label: m.review_on_disk(),
    shortLabel: m.review_the_file(),
    explainer: m.review_the_bytes_in_the_projects(),
    available: project !== undefined,
    immediate: () =>
      project === undefined
        ? undefined
        : savedSource(project, context.baselineOf, m.review_on_disk()),
  };
};

const recordedChoice = (context: ChoiceContext): SourceChoice => {
  const { project } = context;
  return {
    id: "recorded",
    label: m.review_the_last_recorded_version(),
    shortLabel: m.review_the_last_version(),
    explainer:
      context.recorded.head === undefined
        ? m.review_nothing_has_been_recorded_in()
        : m.review_the_books_as_the_last(),
    available: project !== undefined && context.recorded.head !== undefined,
    immediate: () =>
      project === undefined
        ? undefined
        : recordedSource(context.recorded, m.review_last_recorded()),
  };
};

const sharedChoice = (context: ChoiceContext): SourceChoice => {
  const { project } = context;
  return {
    id: "shared",
    label: context.sharedLabel ?? m.review_the_shared_project(),
    shortLabel: context.sharedLabel?.toLowerCase() ?? m.review_the_shared_project_2(),
    explainer:
      context.shared.head === undefined
        ? m.review_nothing_has_been_received_from()
        : (context.sharedExplainer ?? m.review_the_shared_projects_newest_version()),
    available: project !== undefined && context.shared.head !== undefined,
    immediate: () =>
      project === undefined
        ? undefined
        : sharedSource(context.shared, context.sharedLabel ?? m.review_the_shared_project()),
  };
};

const writerChoice = (context: ChoiceContext): SourceChoice => {
  const { project } = context;
  return {
    id: "writer",
    label: context.writer?.label ?? m.review_from_writer(),
    shortLabel: m.common_writer(),
    explainer:
      context.writer === undefined
        ? m.review_no_writer_project_this_project()
        : m.review_new_saves_in_writer_in(),
    available: project !== undefined && context.writer !== undefined,
    immediate: () =>
      project === undefined || context.writer === undefined
        ? undefined
        : sharedSource(context.writer.texts, context.writer.label),
  };
};

const zipChoice = (services: Services, web: boolean): SourceChoice => ({
  id: "zip",
  label: m.review_a_zip(),
  shortLabel: m.review_the_zip(),
  explainer: web
    ? m.review_a_zip_somebody_shared_it()
    : m.review_this_host_opens_folders_directly(),
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
});

const folderChoice = (services: Services, nativeFolder: boolean): SourceChoice => ({
  id: "folder",
  label: m.review_a_folder(),
  shortLabel: m.review_the_folder(),
  explainer: nativeFolder
    ? m.review_any_folder_of_books_on()
    : m.review_the_browser_copies_the_folders(),
  available: true,
  pick: async () => {
    if (nativeFolder) {
      const picked = await services.run(
        services.dialogs.pickFolder(m.review_select_a_folder_to_compare()),
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
});

export const sourceChoices = (context: ChoiceContext): readonly SourceChoice[] => {
  const { services } = context;
  const web = services.hostInfo.kind() === "web";
  const capabilities = services.hostInfo.capabilities();
  const nativeFolder = capabilities.nativeDisk && capabilities.dialogs;

  return [
    projectChoice(context),
    diskChoice(context),
    recordedChoice(context),
    sharedChoice(context),
    writerChoice(context),
    zipChoice(services, web),
    folderChoice(services, nativeFolder),
  ];
};
