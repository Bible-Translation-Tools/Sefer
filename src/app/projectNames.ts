/**
 * The names chosen on this device, by project root: a rename made this
 * session, and the one a project open reads from `.sefer/project.json`.
 *
 * A rename writes that file, and every reader that learns a name from disk
 * learns the new one on its next read. The open project's header does not
 * read disk: `projectName(shell.project())` answers from the metadata the
 * Project decoded at open, which a device-local name never touches.
 *
 * Renaming then showed a green toast and changed nothing on screen. This is
 * the smallest honest fix: one module-level signal, written by the one
 * function that performs a rename (`projectCommands.renameProject`) and read
 * by the surfaces that display a project's name. It is a session overlay, not
 * a cache — nothing is invalidated, because the disk has already been told and
 * the next boot reads the same answer from there.
 */

import { createSignal } from "solid-js";

const [names, setNames] = createSignal<Readonly<Record<string, string>>>(
  {},
  { name: "renamedProjects" },
);

/** Records what a project is called from now on. Called after the write lands. */
export const noteRenamed = (root: string, name: string): void => {
  setNames((held) => ({ ...held, [root]: name }));
};

/** The name chosen on this device, or undefined when none was. */
export const renamedName = (root: string | undefined): string | undefined =>
  root === undefined ? undefined : names()[root];
