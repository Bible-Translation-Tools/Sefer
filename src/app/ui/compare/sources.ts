/**
 * How the SHELL gets a `CompareSource` — the host half of the compare port.
 *
 * `src/core/compare` says what a side of a comparison must answer; this table
 * says how a reader picks one on this host. They are separate on purpose: core
 * cannot open a file picker, and the screen should not learn what a zip is.
 *
 * Adding a source kind (a git checkpoint, another local project, a remote) is
 * one entry here plus one file in `src/core/compare` — `ComparePanel` renders
 * whatever this list holds and nothing in it is spelled out twice.
 */

import { Option } from "effect";

import { currentProjectSource, folderSource, type CompareSource } from "../../../core/compare";
import type { Project } from "../../../core/project/project";
import { t } from "../../i18n";
import type { Services } from "../../services";

/** Which side of the comparison a kind may be chosen for. */
export type Side = "left" | "right";

export interface SourceChoice {
  readonly id: string;
  /** The name in the picker: "This project", "A zip", "A folder". */
  readonly label: string;
  /**
   * The same thing named so it can be said inside a sentence or on a button:
   * "this project", "the zip", "the folder". The screen writes "Take the
   * zip's", never "Take right" — a reader choosing between two copies of their
   * own work is not reading a coordinate system.
   */
  readonly shortLabel: string;
  /** The one line under it, or the reason this host cannot offer it. */
  readonly explainer: string;
  readonly sides: readonly Side[];
  readonly available: boolean;
  /**
   * The source, for a kind that needs no picker — the open project is the only
   * one today. A kind with an `immediate` needs no Choose button, which is the
   * whole difference between the two sides of the screen.
   */
  readonly immediate?: () => CompareSource | undefined;
  /**
   * Produces the source, or `undefined` if the reader closed the picker.
   * Rejects with whatever the host failed with; the panel prints it.
   */
  readonly pick?: () => Promise<CompareSource | undefined>;
}

/** Where a picked zip or folder is unpacked, out of the way of the projects. */
const scratchRoot = (services: Services): string => `${services.hostInfo.paths().temp}/compare`;

/**
 * The choices, for a given host and open project.
 *
 * A zip is not a source kind in core — it is a folder that had to be unpacked
 * first — so both of the "another…" entries below end in `folderSource`.
 */
export const sourceChoices = (
  services: Services,
  project: Project | undefined,
): readonly SourceChoice[] => {
  const web = services.hostInfo.kind() === "web";
  const capabilities = services.hostInfo.capabilities();
  const nativeFolder = capabilities.nativeDisk && capabilities.dialogs;

  return [
    {
      id: "project",
      label: t("This project"),
      shortLabel: t("this project"),
      explainer:
        project === undefined
          ? t("No project is open.")
          : t("The books as they are right now, including unsaved edits."),
      sides: ["left"],
      available: project !== undefined,
      immediate: () => (project === undefined ? undefined : currentProjectSource(project)),
    },
    {
      id: "zip",
      label: t("A zip"),
      shortLabel: t("the zip"),
      explainer: web
        ? t("A .zip somebody shared. It is unpacked here, in the page, and only read.")
        : t("This host opens folders directly; unzip it first."),
      sides: ["right"],
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
      sides: ["right"],
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
 * one renderer of a tagged failure, and the two copies that used to live here
 * and in the cloud screen had already drifted apart.
 */
export { describe } from "../../describe";
