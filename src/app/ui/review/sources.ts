/**
 * How the SHELL gets a `CompareSource` — the host half of the compare port.
 *
 * `src/core/compare` says what a side of a review must answer; this table says
 * how a reader picks one on this host. They are separate on purpose: core
 * cannot open a file picker, and the screen should not learn what a zip is.
 *
 * Every entry may sit on EITHER side. That is the whole shape of `/review`:
 * the left side happens to default to the editor and the right to the file on
 * disk, because that is the comparison a reader wants nine times in ten, but
 * nothing in the screen or in core knows that. A zip against a zip is a legal
 * pairing and produces a read-only review, which is the honest answer rather
 * than a disabled option with no reason attached.
 *
 * Adding a source kind (a git checkpoint, another local project, a remote) is
 * one entry here plus one file in `src/core/compare`.
 */

import { Option } from "effect";

import type { Book } from "../../../core/book/book";
import {
  currentProjectSource,
  folderSource,
  recordedSource,
  savedSource,
  type CompareSource,
  type RecordedTexts,
} from "../../../core/compare";
import type { Project } from "../../../core/project/project";
import type { Baseline } from "../../../core/save/baseline";
import { t } from "../../i18n";
import type { Services } from "../../services";

export interface SourceChoice {
  readonly id: string;
  /** The name in the picker: "In the editor", "On disk", "A zip". */
  readonly label: string;
  /**
   * The same thing named so it can be said inside a sentence or on a button:
   * "the editor", "the file", "the zip". The screen writes "Take the file's",
   * never "Take right" — a reader choosing between two copies of their own work
   * is not reading a coordinate system.
   */
  readonly shortLabel: string;
  /** The one line under it, or the reason this host cannot offer it. */
  readonly explainer: string;
  readonly available: boolean;
  /**
   * The source, for a kind that needs no picker. A kind with an `immediate`
   * needs no Choose button, which is the whole difference between a side that
   * is already there and a side somebody has to go and find.
   *
   * It is called on every comparison rather than once: the project and the disk
   * sources read live (see `pastSources.ts`), and minting a fresh one each time
   * is what keeps a comparison describing the project as it is now.
   */
  readonly immediate?: () => CompareSource | undefined;
  /**
   * Produces the source, or `undefined` if the reader closed the picker.
   * Rejects with whatever the host failed with; the panel prints it.
   */
  readonly pick?: () => Promise<CompareSource | undefined>;
}

/** Where a picked zip or folder is unpacked, out of the way of the projects. */
const scratchRoot = (services: Services): string => `${services.hostInfo.paths().temp}/review`;

export interface ChoiceContext {
  readonly services: Services;
  readonly project: Project | undefined;
  /** `SaveCoordinator.baseline`, for the file-on-disk side. */
  readonly baselineOf: (book: Book) => Option.Option<Baseline>;
  /** The blobs at HEAD, for the last-recorded side. */
  readonly recorded: RecordedTexts;
}

/**
 * The choices, for a given host and open project.
 *
 * A zip is not a source kind in core — it is a folder that had to be unpacked
 * first — so both of the "another…" entries below end in `folderSource`.
 */
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
        project === undefined ? undefined : currentProjectSource(project, t("In the editor")),
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
      id: "zip",
      label: t("A zip"),
      shortLabel: t("the zip"),
      explainer: web
        ? t("A .zip somebody shared. It is unpacked here, in the page, and only read.")
        : t("This host opens folders directly; unzip it first."),
      available: web,
      pick: async () => {
        const intake = await import("../../../platform/web/intake");
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
        const intake = await import("../../../platform/web/intake");
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

/**
 * A rejection as one line.
 *
 * Re-exported rather than written a third time: `src/app/describe.ts` is the
 * one renderer of a tagged failure.
 */
