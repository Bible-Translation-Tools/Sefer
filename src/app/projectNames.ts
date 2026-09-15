/**
 * The names a rename changed in THIS session, by project root.
 *
 * A rename writes a file — the burrito's `identification.name`, or
 * `.sefer/project.json` for a project that has no burrito — and every reader
 * that learns a name from disk therefore learns the new one on its next read.
 * Two readers do not read again:
 *
 *   * the open `Project` holds the metadata it decoded when it was opened, so
 *     `projectName(shell.project())` keeps answering the old name until the
 *     project is closed and reopened;
 *   * nothing at all reads `.sefer/project.json` mid-session.
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

/** The name this session gave the project, or undefined if it never renamed it. */
export const renamedName = (root: string | undefined): string | undefined =>
  root === undefined ? undefined : names()[root];
